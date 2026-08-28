import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const workerScript = path.join(
  __dirname,
  'merra2StationsWorker.py'
);

const STATIONS_CACHE_TTL_MS = 30 * 60 * 1000;
const TIMESERIES_CACHE_TTL_MS = 30 * 60 * 1000;
const LATEST_DATE_CACHE_TTL_MS = 60 * 60 * 1000;

/** In-memory cache — avoids repeated Python subprocess + parquet reads. */
const stationsByDateCache = new Map();
const timeseriesCache = new Map();
let latestDateCache = null;

function getFresh(cache, key, ttlMs) {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.ts > ttlMs) return null;
  return hit.data;
}

async function runWorker(args) {
  try {
    const { stdout } = await execFileAsync('python', [workerScript, ...args], {
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (err) {
    const stderr = err?.stderr?.toString?.().trim();
    const stdout = err?.stdout?.toString?.().trim();
    const payload = stdout ? safeJson(stdout) : null;
    const message = payload?.error || stderr || err?.message || 'Unexpected MERRA2 station API error.';
    const code = Number(err?.code);
    const status = mapWorkerExitCodeToHttpStatus(code, message);
    throw new HttpError(status, message);
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function mapWorkerExitCodeToHttpStatus(code, message) {
  if (!Number.isFinite(code)) return 500;
  if (code === 2) return 400;
  if (code === 4 || code === 6) return 404;
  if (/Invalid\s/.test(message)) return 400;
  return 500;
}

async function resolveLatestArchiveDate() {
  try {
    const latest = await getLatestStationDate();
    return latest?.latestDate ?? null;
  } catch {
    return null;
  }
}

async function clampDateToArchive(dateStr) {
  const latest = await resolveLatestArchiveDate();
  if (!latest || dateStr <= latest) return dateStr;
  console.warn(`[MERRA2] Clamped ${dateStr} → ${latest} (latest parquet date)`);
  return latest;
}

async function clampRangeToArchive(start, end) {
  const latest = await resolveLatestArchiveDate();
  if (!latest) return { start, end };
  let clampedStart = start > latest ? latest : start;
  let clampedEnd = end > latest ? latest : end;
  if (clampedStart > clampedEnd) clampedStart = clampedEnd;
  if (clampedStart !== start || clampedEnd !== end) {
    console.warn(
      `[MERRA2] Clamped range ${start}–${end} → ${clampedStart}–${clampedEnd} (latest parquet date)`
    );
  }
  return { start: clampedStart, end: clampedEnd };
}

export async function getStationsForDate(dateStr) {
  const clampedDate = await clampDateToArchive(dateStr);
  const cached = getFresh(stationsByDateCache, clampedDate, STATIONS_CACHE_TTL_MS);
  if (cached) {
    return { date: clampedDate, requestedDate: dateStr, stations: cached, clamped: clampedDate !== dateStr };
  }

  const out = await runWorker(['stations', '--date', clampedDate]);
  const stations = out?.stations ?? [];
  stationsByDateCache.set(clampedDate, { ts: Date.now(), data: stations });
  return { date: clampedDate, requestedDate: dateStr, stations, clamped: clampedDate !== dateStr };
}

export async function getStationTimeseries({ sitename, start, end }) {
  const { start: clampedStart, end: clampedEnd } = await clampRangeToArchive(start, end);
  const cacheKey = `${sitename}|${clampedStart}|${clampedEnd}`;
  const cached = getFresh(timeseriesCache, cacheKey, TIMESERIES_CACHE_TTL_MS);
  if (cached) {
    return {
      ...cached,
      start: clampedStart,
      end: clampedEnd,
      requestedStart: start,
      requestedEnd: end,
      clamped: clampedStart !== start || clampedEnd !== end,
    };
  }

  const out = await runWorker([
    'station-timeseries',
    '--sitename',
    String(sitename ?? ''),
    '--start',
    String(clampedStart ?? ''),
    '--end',
    String(clampedEnd ?? ''),
  ]);
  const payload = {
    ...out,
    start: clampedStart,
    end: clampedEnd,
    requestedStart: start,
    requestedEnd: end,
    clamped: clampedStart !== start || clampedEnd !== end,
  };
  timeseriesCache.set(cacheKey, { ts: Date.now(), data: payload });
  return payload;
}

export async function getStationList() {
  const out = await runWorker(['station-list']);
  return out?.stations ?? [];
}

export async function getLatestStationDate() {
  if (latestDateCache && Date.now() - latestDateCache.ts <= LATEST_DATE_CACHE_TTL_MS) {
    return latestDateCache.data;
  }
  const out = await runWorker(['latest-date']);
  latestDateCache = { ts: Date.now(), data: out };
  return out;
}

export function toHttpError(err) {
  if (err?.status) return err;
  if (typeof err === 'string') return new HttpError(500, err);
  return new HttpError(500, err?.message || 'Unexpected MERRA2 station API error.');
}

