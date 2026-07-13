/**
 * OpenAQ public historical archive (AWS Open Data — s3://openaq-data-archive).
 *
 * This bucket is free, anonymous, and unlimited (no API key, no rate limit) —
 * see https://registry.opendata.aws/openaq/ and https://docs.openaq.org/aws/about.
 * Each object holds one station's full-day measurements across all parameters:
 *   records/csv.gz/locationid={id}/year={yyyy}/month={mm}/location-{id}-{yyyymmdd}.csv.gz
 *
 * We download each day once, cache the raw file + a small processed PM2.5 summary
 * to disk, and never re-fetch it again. Files are published ~72h after the end of
 * the day (in the station's local time), so anything more recent must come from
 * the live OpenAQ API instead — see ARCHIVE_LAG_DAYS below.
 */
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const gunzipAsync = promisify(zlib.gunzip);

const ARCHIVE_BASE = 'https://openaq-data-archive.s3.amazonaws.com';
const ARCHIVE_CACHE_DIR = process.env.OPENAQ_ARCHIVE_CACHE_DIR || path.join(process.cwd(), '.cache', 'openaq');
const ARCHIVE_LAG_DAYS = Number(process.env.OPENAQ_ARCHIVE_LAG_DAYS || 3);
const ARCHIVE_CONCURRENCY = Number(process.env.OPENAQ_ARCHIVE_CONCURRENCY || 16);
const MAX_ARCHIVE_DAYS = 3660; // ~10 years safety cap per request
const PM25_PARAMETER = 'pm25';
const DAY_MAP_DIR = path.join(ARCHIVE_CACHE_DIR, 'day-maps');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dateParts(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { y, m, d };
}

function roundPm25(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return Math.round(Number(value) * 100) / 100;
}

// Some upstream providers (notably AirNow-fed stations) encode missing/invalid readings
// as sentinel fill values like -999 or -9999 instead of omitting the row. A little
// negative noise near zero is real (sensor calibration drift), but anything this far
// negative — or implausibly high — is a placeholder, not a measurement.
const MIN_VALID_PM25 = -100;
const MAX_VALID_PM25 = 3000;
function isPlausiblePm25(value) {
  return Number.isFinite(value) && value >= MIN_VALID_PM25 && value <= MAX_VALID_PM25;
}

/** Last date (YYYY-MM-DD, UTC) guaranteed to already be published in the archive. */
export function archiveCutoffDate(lagDays = ARCHIVE_LAG_DAYS) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - lagDays);
  return d.toISOString().slice(0, 10);
}

export function nextDayStr(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function archiveKey(locationId, dateStr) {
  const { y, m, d } = dateParts(dateStr);
  return `records/csv.gz/locationid=${locationId}/year=${y}/month=${pad2(m)}/location-${locationId}-${y}${pad2(m)}${pad2(d)}.csv.gz`;
}

function rawFilePath(locationId, dateStr) {
  const { y, m, d } = dateParts(dateStr);
  return path.join(ARCHIVE_CACHE_DIR, 'raw', String(locationId), String(y), pad2(m), `${y}${pad2(m)}${pad2(d)}.csv.gz`);
}

function missingMarkerPath(locationId, dateStr) {
  return `${rawFilePath(locationId, dateStr)}.missing`;
}

function processedFilePath(locationId, dateStr) {
  const { y, m, d } = dateParts(dateStr);
  return path.join(ARCHIVE_CACHE_DIR, 'processed', String(locationId), String(y), pad2(m), `${y}${pad2(m)}${pad2(d)}.json`);
}

function ensureDirFor(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

/** Minimal CSV parser (handles quoted fields) — sufficient for the archive's simple schema. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else if (c === '\r') {
      // skip
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function downloadDayFile(locationId, dateStr) {
  const rawPath = rawFilePath(locationId, dateStr);
  if (existsSync(rawPath)) return readFileSync(rawPath);
  if (existsSync(missingMarkerPath(locationId, dateStr))) return null;

  const url = `${ARCHIVE_BASE}/${archiveKey(locationId, dateStr)}`;
  const res = await fetch(url);
  if (res.status === 404) {
    ensureDirFor(missingMarkerPath(locationId, dateStr));
    writeFileSync(missingMarkerPath(locationId, dateStr), '1');
    return null;
  }
  if (!res.ok) {
    throw new Error(`OpenAQ archive download failed (${res.status}) for location ${locationId} ${dateStr}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  ensureDirFor(rawPath);
  writeFileSync(rawPath, buf);
  return buf;
}

async function computeDayPm25(locationId, dateStr) {
  const processedPath = processedFilePath(locationId, dateStr);
  if (existsSync(processedPath)) {
    try {
      return JSON.parse(readFileSync(processedPath, 'utf8'));
    } catch {
      // fall through and recompute
    }
  }

  const gz = await downloadDayFile(locationId, dateStr);
  let result;
  if (!gz) {
    result = { date: dateStr, locationId, missing: true, mean: null, min: null, max: null, count: 0 };
  } else {
    const csvText = (await gunzipAsync(gz)).toString('utf8');
    const rows = parseCsv(csvText);
    const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
    const paramIdx = header.indexOf('parameter');
    const valueIdx = header.indexOf('value');
    const sensorIdx = header.findIndex((h) => h === 'sensors_id' || h === 'sensor_id');

    const values = [];
    let sensorId = null;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || paramIdx < 0 || valueIdx < 0 || r.length <= Math.max(paramIdx, valueIdx)) continue;
      const parameter = (r[paramIdx] ?? '').trim().toLowerCase();
      if (parameter !== PM25_PARAMETER) continue;
      const value = Number(r[valueIdx]);
      if (!isPlausiblePm25(value)) continue;
      values.push(value);
      if (sensorId == null && sensorIdx >= 0) sensorId = Number(r[sensorIdx]) || null;
    }

    if (values.length === 0) {
      result = { date: dateStr, locationId, missing: true, mean: null, min: null, max: null, count: 0 };
    } else {
      const mean = roundPm25(values.reduce((a, b) => a + b, 0) / values.length);
      result = {
        date: dateStr,
        locationId,
        sensorId,
        missing: false,
        mean,
        min: roundPm25(Math.min(...values)),
        max: roundPm25(Math.max(...values)),
        count: values.length,
      };
    }
  }

  ensureDirFor(processedPath);
  writeFileSync(processedPath, JSON.stringify(result));
  return result;
}

function* iterDates(start, end) {
  let cur = new Date(`${start}T00:00:00Z`);
  const endD = new Date(`${end}T00:00:00Z`);
  while (cur <= endD) {
    yield cur.toISOString().slice(0, 10);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

async function poolMap(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index;
      index += 1;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/** One location, a date range — used for the per-station history chart. */
export async function getArchiveDailySeries({ locationId, start, end }) {
  const dates = [...iterDates(start, end)];
  if (dates.length === 0) return [];
  if (dates.length > MAX_ARCHIVE_DAYS) {
    throw new Error(`Archive range too large (${dates.length} days). Please narrow the date range.`);
  }
  const results = await poolMap(dates, ARCHIVE_CONCURRENCY, (d) => computeDayPm25(locationId, d));
  return results.filter((r) => r && !r.missing && r.mean != null);
}

function dayMapPath(dateStr) {
  return path.join(DAY_MAP_DIR, `${dateStr}.json`);
}

/**
 * Compact per-day lookup: locationId → { mean, missing }.
 * Avoids re-hitting S3 for every station when the user revisits a date.
 */
export function loadDayPm25Map(dateStr) {
  const p = dayMapPath(dateStr);
  if (!existsSync(p)) return null;
  try {
    const json = JSON.parse(readFileSync(p, 'utf8'));
    return json?.byLocationId && typeof json.byLocationId === 'object' ? json : null;
  } catch {
    return null;
  }
}

export function saveDayPm25Map(dateStr, byLocationId) {
  ensureDirFor(dayMapPath(dateStr));
  writeFileSync(
    dayMapPath(dateStr),
    JSON.stringify({
      date: dateStr,
      savedAt: new Date().toISOString(),
      byLocationId,
    })
  );
}

/** Many locations, one specific day — used for the map "daily" (historical) view. Pure S3, no API key. */
export async function getArchiveDayForLocations(locations, dateStr, { onBatch } = {}) {
  const results = new Array(locations.length);
  let index = 0;
  const limit = Math.min(ARCHIVE_CONCURRENCY, locations.length || 1);
  let completed = 0;

  async function worker() {
    while (index < locations.length) {
      const i = index;
      index += 1;
      const loc = locations[i];
      try {
        const day = await computeDayPm25(loc.locationId, dateStr);
        results[i] = { loc, day };
      } catch {
        results[i] = { loc, day: null };
      }
      completed += 1;
      if (onBatch && (completed % 25 === 0 || completed === locations.length)) {
        onBatch(results, completed, locations.length);
        // Yield so HTTP responses / UI polls can flush while archive fills.
        await new Promise((r) => setImmediate(r));
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

/** Roll up per-day archive results into the daily/monthly/yearly points shape the frontend expects. */
export function aggregateDailyToResolution(dailyPoints, resolution) {
  if (resolution === 'daily') {
    return dailyPoints.map((p) => ({ date: p.date, datetime: `${p.date}T12:00:00Z`, pm25: p.mean }));
  }
  const groups = new Map();
  for (const p of dailyPoints) {
    const key = resolution === 'yearly' ? p.date.slice(0, 4) : p.date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p.mean);
  }
  return [...groups.entries()]
    .map(([key, values]) => ({
      date: key,
      datetime: resolution === 'yearly' ? `${key}-01-01T00:00:00Z` : `${key}-01T00:00:00Z`,
      pm25: roundPm25(values.reduce((a, b) => a + b, 0) / values.length),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getOpenAqArchiveInfo() {
  return {
    bucket: 'openaq-data-archive',
    registry: 'https://registry.opendata.aws/openaq/',
    docs: 'https://docs.openaq.org/aws/about',
    lagDays: ARCHIVE_LAG_DAYS,
    cutoffDate: archiveCutoffDate(),
    cacheDir: ARCHIVE_CACHE_DIR,
    usesApiKey: false,
    note:
      'Historical PM2.5 is downloaded once per station/day from the free, anonymous OpenAQ S3 archive ' +
      'and cached to disk permanently. It is never re-fetched, and it never counts against the OPENAQ_API_KEY rate limit.',
  };
}
