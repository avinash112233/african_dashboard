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

const workerScript = path.join(__dirname, 'washuStationsWorker.py');

const STATIONS_CACHE_TTL_MS = 30 * 60 * 1000;
const TIMESERIES_CACHE_TTL_MS = 30 * 60 * 1000;
const LATEST_DATE_CACHE_TTL_MS = 60 * 60 * 1000;

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
    const message = payload?.error || stderr || err?.message || 'Unexpected WashU station API error.';
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

export async function getWashUStationsForDate(dateStr) {
  const cached = getFresh(stationsByDateCache, dateStr, STATIONS_CACHE_TTL_MS);
  if (cached) return cached;

  const out = await runWorker(['stations', '--date', dateStr]);
  const stations = out?.stations ?? [];
  stationsByDateCache.set(dateStr, { ts: Date.now(), data: stations });
  return stations;
}

export async function getWashUStationTimeseries({ sitename, start, end, granularity = 'monthly' }) {
  const cacheKey = `${sitename}|${granularity}|${start}|${end}`;
  const cached = getFresh(timeseriesCache, cacheKey, TIMESERIES_CACHE_TTL_MS);
  if (cached) return cached;

  const out = await runWorker([
    'station-timeseries',
    '--sitename',
    String(sitename ?? ''),
    '--start',
    String(start ?? ''),
    '--end',
    String(end ?? ''),
    '--granularity',
    String(granularity ?? 'monthly'),
  ]);
  timeseriesCache.set(cacheKey, { ts: Date.now(), data: out });
  return out;
}

export async function getWashUStationList() {
  const out = await runWorker(['station-list']);
  return out?.stations ?? [];
}

export async function getWashULatestStationDate() {
  if (latestDateCache && Date.now() - latestDateCache.ts <= LATEST_DATE_CACHE_TTL_MS) {
    return latestDateCache.data;
  }
  const out = await runWorker(['latest-date']);
  latestDateCache = { ts: Date.now(), data: out };
  return out;
}

export function toWashUStationHttpError(err) {
  if (err?.status) return err;
  if (typeof err === 'string') return new HttpError(500, err);
  return new HttpError(500, err?.message || 'Unexpected WashU station API error.');
}
