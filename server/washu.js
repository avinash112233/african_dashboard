import { execFile } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AFRICA_BOUNDS } from './merra2.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerScript = path.join(__dirname, 'washuWorker.py');

const S3_BUCKET = process.env.WASHU_S3_BUCKET || 'satpmdata';
const S3_PREFIX = (process.env.WASHU_S3_PREFIX || 'V6GL03/FineResolution/AF').replace(/\/$/, '');
const CACHE_DIR = process.env.WASHU_CACHE_DIR || path.join(process.cwd(), '.cache', 'washu');
const NO_DATA = -9999;

const gridCache = new Map();
const GRID_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function s3Url(key) {
  return `https://${S3_BUCKET}.s3.amazonaws.com/${key}`;
}

function ncRelativePath(period, year, month) {
  const y = String(year).padStart(4, '0');
  if (period === 'annual') {
    return `${S3_PREFIX}/Annual/V6GL03.CNNPM25.AF.${y}01-${y}12.nc`;
  }
  const m = String(month).padStart(2, '0');
  const ym = `${y}${m}`;
  return `${S3_PREFIX}/Monthly/${year}/V6GL03.CNNPM25.AF.${ym}-${ym}.nc`;
}

function localCachePath(relativeKey) {
  return path.join(CACHE_DIR, relativeKey.replace(/\//g, path.sep));
}

function processedGridPath(cacheKey) {
  return path.join(CACHE_DIR, 'processed', `${cacheKey.replace(/:/g, '_')}.json`);
}

function readProcessedGrid(cacheKey, ncPath) {
  const processedPath = processedGridPath(cacheKey);
  if (!existsSync(processedPath)) return null;
  try {
    const ncStat = statSync(ncPath);
    const processedStat = statSync(processedPath);
    if (processedStat.mtimeMs < ncStat.mtimeMs) return null;
    return JSON.parse(readFileSync(processedPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeProcessedGrid(cacheKey, grid) {
  const processedPath = processedGridPath(cacheKey);
  mkdirSync(path.dirname(processedPath), { recursive: true });
  writeFileSync(processedPath, JSON.stringify(grid));
}

function enrichGridMeta(grid, relativeKey) {
  return {
    ...grid,
    dataSource: {
      product: 'V6.GL.03 CNNPM25',
      institution: 'WashU ACAG (Washington University in St. Louis)',
      registry: 'https://registry.opendata.aws/surface-pm2-5-v6gl/',
      s3Bucket: S3_BUCKET,
      s3Key: relativeKey,
      variable: 'PM25',
      nativeResolution: grid.nativeResolution ?? '0.01°',
      coverage: 'Africa regional NetCDF (FineResolution/AF)',
    },
  };
}

async function ensureCached(relativeKey) {
  const localPath = localCachePath(relativeKey);
  if (existsSync(localPath)) return localPath;

  mkdirSync(path.dirname(localPath), { recursive: true });
  const url = s3Url(relativeKey);
  const res = await fetch(url);
  if (!res.ok) {
    throw new HttpError(res.status === 404 ? 404 : 502, `SatPM download failed (${res.status}) for ${relativeKey}`);
  }
  if (!res.body) {
    throw new HttpError(502, `SatPM download returned empty body for ${relativeKey}`);
  }

  await pipeline(res.body, createWriteStream(localPath));
  return localPath;
}

async function runWorker(args) {
  const runners = ['python3', 'python'];
  let lastErr;
  for (const bin of runners) {
    try {
      const { stdout } = await execFileAsync(bin, [workerScript, ...args], {
        env: process.env,
        maxBuffer: 30 * 1024 * 1024,
      });
      return JSON.parse(stdout);
    } catch (err) {
      lastErr = err;
      if (err?.code === 'ENOENT') continue;
      break;
    }
  }
  const err = lastErr;
  const stderr = err?.stderr?.toString?.().trim();
  const stdout = err?.stdout?.toString?.().trim();
  let payload = null;
  try {
    payload = stdout ? JSON.parse(stdout) : null;
  } catch {
    payload = null;
  }
  const message = payload?.error || stderr || err?.message || 'WashU worker failed';
  const code = Number(err?.code);
  const status = code === 2 || /Invalid/.test(message) ? 400 : code === 4 ? 404 : 500;
  throw new HttpError(status, message);
}

function sampleGrid(period, year, month, fallbackReason = 'fallback_unknown') {
  const width = 78;
  const height = 73;
  const { south, west, north, east } = AFRICA_BOUNDS;
  const values = [];
  let min = Infinity;
  let max = -Infinity;

  for (let row = 0; row < height; row++) {
    const lat = north - (row / Math.max(1, height - 1)) * (north - south);
    for (let col = 0; col < width; col++) {
      const lon = west + (col / Math.max(1, width - 1)) * (east - west);
      const urban = Math.exp(-Math.pow((lon - 28) / 18, 2)) * Math.exp(-Math.pow((lat - -26) / 10, 2));
      const sahel = Math.exp(-Math.pow((lat - 12) / 8, 2)) * Math.exp(-Math.pow((lon - 2) / 25, 2));
      const base = 8 + 6 * Math.sin((lat + lon) * 0.04);
      let v = base + 55 * urban + 28 * sahel + (period === 'annual' ? 4 : 0);
      v = Math.round(Math.max(3, Math.min(120, v)) * 10) / 10;
      values.push(v);
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  const periodLabel = period === 'annual' ? String(year) : `${year}-${String(month).padStart(2, '0')}`;

  return {
    period,
    year,
    month: period === 'monthly' ? month : null,
    periodLabel,
    units: 'µg/m³',
    bounds: { ...AFRICA_BOUNDS },
    width,
    height,
    noDataValue: NO_DATA,
    min,
    max,
    values,
    nativeResolution: '0.01° (sample)',
    source: 'sample',
    fallbackReason,
  };
}

function normalizePeriod(period) {
  const p = String(period || 'monthly').toLowerCase();
  if (p !== 'monthly' && p !== 'annual') {
    throw new HttpError(400, 'Invalid period. Expected monthly or annual.');
  }
  return p;
}

function normalizeYearMonth(yearRaw, monthRaw, period) {
  const year = Math.max(1998, Math.min(2025, Number(yearRaw) || new Date().getFullYear()));
  const month = period === 'monthly' ? Math.max(1, Math.min(12, Number(monthRaw) || 1)) : null;
  return { year, month };
}

function* iterMonths(startYear, startMonth, endYear, endMonth) {
  let y = startYear;
  let m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    yield { year: y, month: m };
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
}

async function ensureMonthlyFilesCached(startYear, startMonth, endYear, endMonth) {
  const months = [...iterMonths(startYear, startMonth, endYear, endMonth)];
  if (months.length > 48) {
    throw new HttpError(400, 'Date range too large. Please select 48 months or fewer.');
  }
  for (const { year, month } of months) {
    const relativeKey = ncRelativePath('monthly', year, month);
    await ensureCached(relativeKey);
  }
  return months.length;
}

export async function fetchWashUGrid({ period, year, month }) {
  const normalizedPeriod = normalizePeriod(period);
  const { year: y, month: m } = normalizeYearMonth(year, month, normalizedPeriod);
  const cacheKey = `${normalizedPeriod}:${y}:${m ?? 'all'}`;
  const hit = gridCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < GRID_CACHE_TTL_MS) {
    return hit.data;
  }

  const relativeKey = ncRelativePath(normalizedPeriod, y, m ?? 1);

  try {
    const localPath = await ensureCached(relativeKey);
    const cachedProcessed = readProcessedGrid(cacheKey, localPath);
    if (cachedProcessed) {
      const grid = enrichGridMeta(cachedProcessed, relativeKey);
      gridCache.set(cacheKey, { ts: Date.now(), data: grid });
      return grid;
    }

    const t0 = Date.now();
    const raw = await runWorker([
      'grid',
      '--path',
      localPath,
      '--period',
      normalizedPeriod,
      '--year',
      String(y),
      '--month',
      String(m ?? 1),
    ]);
    const grid = enrichGridMeta(
      { ...raw, processingMs: Date.now() - t0 },
      relativeKey
    );
    writeProcessedGrid(cacheKey, grid);
    gridCache.set(cacheKey, { ts: Date.now(), data: grid });
    return grid;
  } catch (err) {
    console.warn('[WashU] Grid fetch failed:', err.message);
    const reason = err instanceof HttpError ? err.message : 'worker_or_download_error';
    return sampleGrid(normalizedPeriod, y, m ?? 1, reason);
  }
}

export async function fetchWashUTimeseries({ lat, lon, startYear, startMonth, endYear, endMonth }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new HttpError(400, 'Invalid lat/lon.');
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new HttpError(400, 'lat/lon out of range.');
  }

  let startY = Math.max(1998, Number(startYear) || 1998);
  let endY = Math.max(startY, Number(endYear) || startY);
  let startM = Math.max(1, Math.min(12, Number(startMonth) || 1));
  let endM = Math.max(1, Math.min(12, Number(endMonth) || 12));

  if (startY > endY || (startY === endY && startM > endM)) {
    [startY, endY] = [endY, startY];
    [startM, endM] = [endM, startM];
  }

  const monthCount = await ensureMonthlyFilesCached(startY, startM, endY, endM);

  const result = await runWorker([
    'timeseries',
    '--cache-dir',
    CACHE_DIR,
    '--prefix',
    S3_PREFIX,
    '--lat',
    String(lat),
    '--lon',
    String(lon),
    '--start-year',
    String(startY),
    '--start-month',
    String(startM),
    '--end-year',
    String(endY),
    '--end-month',
    String(endM),
  ]);

  return { ...result, monthCount, pointsReturned: result.points?.length ?? 0 };
}

export function getWashUConfig() {
  return {
    bucket: S3_BUCKET,
    prefix: S3_PREFIX,
    cacheDir: CACHE_DIR,
    product: 'V6.GL.03 CNNPM25 Africa fine resolution',
    periods: ['monthly', 'annual'],
    coverage: '1998–2023 (Africa regional files)',
  };
}
