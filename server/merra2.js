// Fetches MERRA2 CNN PM2.5 grid from NASA GES DISC (NetCDF download + Python extract).
// OPeNDAP ASCII subsets for the full Africa extent return HTTP 400; NetCDF is reliable.
// Falls back to a synthetic sample grid when credentials are missing or download fails.
// Set EARTHDATA_USERNAME + EARTHDATA_PASSWORD (or EARTHDATA_TOKEN) in .env for real data.

import { execFile } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { getEarthdataBearerToken } from './earthdataAuth.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gridWorkerScript = path.join(__dirname, 'merra2GridWorker.py');

/** Dashboard focus — smaller OPeNDAP subset loads ~15× faster than global. */
export const AFRICA_BOUNDS = { south: -35, west: -25, north: 38, east: 55 };
const GLOBAL_WIDTH = 576;  // 0.625° lon resolution
const GLOBAL_HEIGHT = 361; // 0.5° lat resolution
const NO_DATA = -9999;

const gridCache = new Map();
/** Bump when grid response shape/bounds logic changes (clears stale in-memory entries after deploy). */
const GRID_CACHE_VERSION = 'africa-v2-netcdf';

function latToRowIndex(lat) {
  const row = Math.round(((90 - lat) / 180) * (GLOBAL_HEIGHT - 1));
  return Math.max(0, Math.min(GLOBAL_HEIGHT - 1, row));
}

function lonToColIndex(lon) {
  const col = Math.round(((lon - -180) / 360) * (GLOBAL_WIDTH - 1));
  return Math.max(0, Math.min(GLOBAL_WIDTH - 1, col));
}

function getAfricaIndices() {
  const latMin = latToRowIndex(AFRICA_BOUNDS.north);
  const latMax = latToRowIndex(AFRICA_BOUNDS.south);
  const lonMin = lonToColIndex(AFRICA_BOUNDS.west);
  const lonMax = lonToColIndex(AFRICA_BOUNDS.east);
  return { latMin, latMax, lonMin, lonMax };
}

function sampleGrid(date, fallbackReason = 'fallback_unknown') {
  const { latMin, latMax, lonMin, lonMax } = getAfricaIndices();
  const width = lonMax - lonMin + 1;
  const height = latMax - latMin + 1;
  const { south, west, north, east } = AFRICA_BOUNDS;
  const values = [];
  let min = Infinity;
  let max = -Infinity;

  for (let row = 0; row < height; row++) {
    const lat = north - (row / Math.max(1, height - 1)) * (north - south);
    for (let col = 0; col < width; col++) {
      const lon = west + (col / Math.max(1, width - 1)) * (east - west);
      const tropics = Math.exp(-Math.pow(lat / 28, 2));
      const plume1 = Math.exp(-Math.pow((lon - 80) / 35, 2)) * Math.exp(-Math.pow((lat - 25) / 12, 2));
      const plume2 = Math.exp(-Math.pow((lon - 20) / 20, 2)) * Math.exp(-Math.pow((lat - 0) / 15, 2));
      const base = 5 + 8 * tropics;
      let v = base + 65 * plume1 + 35 * plume2 + 3 * Math.sin((lat + lon) * 0.05);
      v = Math.round(Math.max(2, Math.min(110, v)) * 10) / 10;
      values.push(v);
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  return {
    date,
    units: 'µg/m³',
    bounds: { ...AFRICA_BOUNDS },
    width,
    height,
    noDataValue: NO_DATA,
    min,
    max,
    values,
    source: 'sample',
    fallbackReason,
  };
}

function parseOpendapAscii(text, width, height) {
  const values = [];
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    for (const n of line.trim().split(/[\s,]+/).map(Number).filter((n) => !isNaN(n))) {
      values.push(n);
    }
  }
  return values.length >= width * height ? values.slice(0, width * height) : null;
}

function parseOpendapAsciiAll(text) {
  const values = [];
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    for (const n of line.trim().split(/[\s,]+/).map(Number).filter((n) => !isNaN(n))) {
      values.push(n);
    }
  }
  return values;
}

async function fetchOpendapAscii(dataUrl, subset, bearerToken) {
  const asciiUrl = `${dataUrl}.ascii?${subset}`;
  return fetch(asciiUrl, {
    headers: bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {},
    redirect: 'follow',
  });
}

export const MERRA2_GRID = {
  globalWidth: GLOBAL_WIDTH,
  globalHeight: GLOBAL_HEIGHT,
  lonStep: 360 / GLOBAL_WIDTH,
  latStep: 180 / (GLOBAL_HEIGHT - 1),
  noData: NO_DATA,
  variable: 'MERRA2_CNN_Surface_PM25',
  hoursPerDay: 24,
};

export function getAfricaGridIndices() {
  return getAfricaIndices();
}

export function merra2RowToLat(row) {
  return 90 - row * MERRA2_GRID.latStep;
}

export function merra2ColToLon(col) {
  return -180 + col * MERRA2_GRID.lonStep;
}

export function africaNativeBounds() {
  const { latMin, latMax, lonMin, lonMax } = getAfricaIndices();
  const halfLat = MERRA2_GRID.latStep / 2;
  const halfLon = MERRA2_GRID.lonStep / 2;
  return {
    north: merra2RowToLat(latMin) + halfLat,
    south: merra2RowToLat(latMax) - halfLat,
    west: merra2ColToLon(lonMin) - halfLon,
    east: merra2ColToLon(lonMax) + halfLon,
  };
}

function granulePaths(date) {
  const y = date.slice(0, 4);
  const m = date.slice(5, 7);
  const d = date.slice(8, 10);
  const granuleFile = `MERRA2_HAQAST_CNN_L4_V1.${y}${m}${d}.nc4`;
  const downloadUrl = `https://data.gesdisc.earthdata.nasa.gov/data/HAQAST/MERRA2_CNN_HAQAST_PM25.1/${y}/${granuleFile}`;
  const opendapUrl = `https://acdisc.gesdisc.eosdis.nasa.gov/opendap/HAQAST/MERRA2_CNN_HAQAST_PM25.1/${y}/${granuleFile}`;
  return { y, granuleFile, downloadUrl, opendapUrl };
}

/** Resolve HTTPS download + OPeNDAP URLs for a daily NetCDF granule. */
export async function resolveMerra2Granule(date) {
  const paths = granulePaths(date);
  const cmrUrl = `https://cmr.earthdata.nasa.gov/search/granules.umm_json?provider=GES_DISC&short_name=MERRA2_CNN_HAQAST_PM25&temporal=${date}T00:00:00Z,${date}T23:59:59Z&page_size=1`;
  let downloadUrl = paths.downloadUrl;
  let opendapUrl = paths.opendapUrl;

  try {
    const cmrRes = await fetch(cmrUrl);
    if (cmrRes.ok) {
      const cmrJson = await cmrRes.json();
      const item = cmrJson?.items?.[0];
      if (item) {
        const related = item?.umm?.RelatedUrls ?? [];
        const opendap = related.find((u) => u.Subtype === 'OPENDAP DATA')?.URL;
        const https = related.find((u) => u.Subtype === 'GET DATA VIA HTTPS')?.URL;
        if (opendap) opendapUrl = opendap;
        if (https) downloadUrl = https;
      }
    }
  } catch (e) {
    console.warn('[MERRA2] CMR granule lookup failed:', e.message);
  }

  return {
    date,
    granuleFile: paths.granuleFile,
    downloadUrl,
    opendapUrl,
  };
}

/** Stream daily NetCDF granule to client (Earthdata auth stays server-side). */
export async function fetchMerra2NetcdfBuffer(date) {
  const granule = await resolveMerra2Granule(date);
  let bearerToken = await getEarthdataBearerToken();

  async function download(token) {
    return fetch(granule.downloadUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      redirect: 'follow',
    });
  }

  let res;
  try {
    res = await download(bearerToken);
    if (res.status === 401 && bearerToken) {
      bearerToken = await getEarthdataBearerToken({ forceRefresh: true });
      if (bearerToken) res = await download(bearerToken);
    }
  } catch (e) {
    const err = new Error(`NetCDF download network error: ${e.message}`);
    err.status = 502;
    throw err;
  }

  if (!res.ok) {
    const err = new Error(`NetCDF download failed (${res.status})`);
    err.status = res.status === 401 ? 401 : 502;
    throw err;
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return { ...granule, buffer, byteLength: buffer.length };
}

function sampleDailyCube(date, fallbackReason = 'fallback_unknown') {
  const hours = MERRA2_GRID.hoursPerDay;
  const single = sampleGrid(date, fallbackReason);
  const cellCount = single.width * single.height;
  const values = [];
  const hourMin = [];
  const hourMax = [];

  for (let h = 0; h < hours; h++) {
    const factor = 0.82 + 0.28 * Math.sin(((h - 6) / 24) * Math.PI * 2);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < cellCount; i++) {
      const v = Math.round(single.values[i] * factor * 10) / 10;
      values.push(v);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    hourMin.push(min);
    hourMax.push(max);
  }

  return {
    date,
    hours,
    units: single.units,
    bounds: africaNativeBounds(),
    width: single.width,
    height: single.height,
    noDataValue: single.noDataValue,
    hourMin,
    hourMax,
    values,
    source: 'sample',
    fallbackReason,
  };
}

function normalizeHourSlice(raw) {
  const out = [];
  let min = Infinity;
  let max = -Infinity;
  for (const v of raw) {
    const num = typeof v === 'number' && !isNaN(v) && v !== NO_DATA ? Math.round(v * 10) / 10 : NO_DATA;
    out.push(num);
    if (num !== NO_DATA) {
      if (num < min) min = num;
      if (num > max) max = num;
    }
  }
  return {
    values: out,
    min: min === Infinity ? 0 : min,
    max: max === -Infinity ? 50 : max,
  };
}

/** All 24 UTC hourly slices for Africa (client caches + hour slider). */
export async function fetchMerra2DailyCube(date) {
  const cacheKey = `${GRID_CACHE_VERSION}:cube:${date}`;
  if (gridCache.has(cacheKey)) {
    return gridCache.get(cacheKey);
  }

  try {
    const result = await extractDailyCubeFromNetcdf(date);
    gridCache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.warn('[MERRA2] NetCDF daily cube extract failed:', e.message);
    return sampleDailyCube(date, e.fallbackReason ?? 'netcdf_extract_error');
  }
}

async function runGridWorker(args) {
  const runners = [process.env.PYTHON, 'python3', 'python'].filter(Boolean);
  let lastErr;
  for (const bin of runners) {
    try {
      const { stdout } = await execFileAsync(bin, [gridWorkerScript, ...args], {
        env: process.env,
        maxBuffer: 30 * 1024 * 1024,
      });
      return JSON.parse(stdout);
    } catch (err) {
      lastErr = err;
      if (err?.code === 'ENOENT') continue;
      const stderr = err?.stderr?.toString?.().trim();
      const msg = stderr || err?.message || 'MERRA2 grid worker failed';
      const workerErr = new Error(msg);
      workerErr.fallbackReason = 'netcdf_parse_error';
      throw workerErr;
    }
  }
  const err = new Error(lastErr?.message || 'Python not found for MERRA2 grid worker');
  err.fallbackReason = 'python_not_found';
  throw err;
}

async function extractDailyCubeFromNetcdf(date) {
  let buffer;
  try {
    ({ buffer } = await fetchMerra2NetcdfBuffer(date));
  } catch (e) {
    const err = new Error(e.message || 'NetCDF download failed');
    err.fallbackReason =
      e.status === 401 ? 'earthdata_401_unauthorized' : 'netcdf_download_error';
    throw err;
  }

  const tmpPath = path.join(tmpdir(), `merra2-${date}-${Date.now()}.nc4`);
  try {
    await writeFile(tmpPath, buffer);
    const payload = await runGridWorker(['daily-cube', '--date', date, '--path', tmpPath]);
    if (payload?.error) {
      const err = new Error(payload.error);
      err.fallbackReason = 'netcdf_parse_error';
      throw err;
    }
    return payload;
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

/**
 * Wire format for /api/merra2/pm25/daily-cube.bin — dramatically smaller than JSON.
 * Layout: [u32 LE headerLen][headerLen bytes UTF-8 JSON, padded to even length][Int16 LE values].
 * Values are quantized ×BIN_SCALE (matches the 1-decimal rounding already applied server-side),
 * with BIN_NODATA_CODE (Int16 min, never a valid PM2.5 reading) marking missing cells.
 * A daily Africa cube that costs ~570KB gzipped as JSON packs down to ~100-150KB this way.
 */
export const MERRA2_BIN_SCALE = 10;
export const MERRA2_BIN_NODATA_CODE = -32768;

export function encodeMerra2DailyCubeBinary(cube) {
  const scale = MERRA2_BIN_SCALE;
  const header = {
    date: cube.date,
    hours: cube.hours,
    units: cube.units,
    bounds: cube.bounds,
    width: cube.width,
    height: cube.height,
    noDataValue: cube.noDataValue,
    hourMin: cube.hourMin,
    hourMax: cube.hourMax,
    source: cube.source,
    fallbackReason: cube.fallbackReason,
    scale,
    noDataCode: MERRA2_BIN_NODATA_CODE,
  };
  let headerJson = Buffer.from(JSON.stringify(header), 'utf8');
  if (headerJson.length % 2 !== 0) {
    // Keep the binary body Int16-aligned so the client can view it without copying.
    headerJson = Buffer.concat([headerJson, Buffer.from(' ')]);
  }

  const cellCount = cube.values.length;
  const body = Buffer.alloc(cellCount * 2);
  for (let i = 0; i < cellCount; i++) {
    const v = cube.values[i];
    let code;
    if (v == null || Number.isNaN(v) || v === cube.noDataValue) {
      code = MERRA2_BIN_NODATA_CODE;
    } else {
      code = Math.round(v * scale);
      if (code > 32767) code = 32767;
      else if (code < -32767) code = -32767; // -32768 stays reserved for "no data"
    }
    body.writeInt16LE(code, i * 2);
  }

  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(headerJson.length, 0);
  return Buffer.concat([lenBuf, headerJson, body]);
}

export async function fetchMerra2Grid(date) {
  const cacheKey = `${GRID_CACHE_VERSION}:${date}`;
  if (gridCache.has(cacheKey)) {
    return gridCache.get(cacheKey);
  }

  let bearerToken = await getEarthdataBearerToken();

  let dataUrl;
  try {
    const granule = await resolveMerra2Granule(date);
    dataUrl = granule.opendapUrl;
  } catch (e) {
    console.warn('[MERRA2] Granule resolve failed:', e.message);
    return sampleGrid(date, 'granule_resolve_error');
  }
  const { latMin, latMax, lonMin, lonMax } = getAfricaIndices();

  // Noon timestep (index 12), Africa extent only
  const subset = `MERRA2_CNN_Surface_PM25[12:12][${latMin}:${latMax}][${lonMin}:${lonMax}]`;

  let res;
  try {
    res = await fetchOpendapAscii(dataUrl, subset, bearerToken);
    if (res.status === 401 && bearerToken) {
      bearerToken = await getEarthdataBearerToken({ forceRefresh: true });
      if (bearerToken) res = await fetchOpendapAscii(dataUrl, subset, bearerToken);
    }
  } catch (e) {
    console.warn('[MERRA2] OPeNDAP fetch failed:', e.message);
    return sampleGrid(date, 'opendap_network_error');
  }

  if (!res.ok) {
    console.warn('[MERRA2] OPeNDAP returned', res.status, res.statusText);
    if (res.status === 401 && !bearerToken) {
      console.warn('[MERRA2] Set EARTHDATA_USERNAME/PASSWORD in .env, then restart backend.');
    } else if (res.status === 401) {
      console.warn(
        '[MERRA2] Earthdata token rejected. Verify username/password and enable '
        + '"NASA GES DISC DATA ARCHIVE" + "Hyrax in the Cloud" on https://urs.earthdata.nasa.gov'
      );
    }
    return sampleGrid(date, res.status === 401 ? 'opendap_401_unauthorized' : `opendap_http_${res.status}`);
  }

  const text = await res.text();
  const nLat = latMax - latMin + 1;
  const nLon = lonMax - lonMin + 1;
  const values = parseOpendapAscii(text, nLon, nLat);
  if (!values || values.length === 0) {
    console.warn('[MERRA2] Could not parse OPeNDAP ASCII response');
    return sampleGrid(date, 'opendap_parse_error');
  }

  const outValues = [];
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    const num = typeof v === 'number' && !isNaN(v) && v !== NO_DATA ? Math.round(v * 10) / 10 : NO_DATA;
    outValues.push(num);
    if (num !== NO_DATA) {
      if (num < min) min = num;
      if (num > max) max = num;
    }
  }

  const result = {
    date,
    hour: 12,
    units: 'µg/m³',
    bounds: africaNativeBounds(),
    width: nLon,
    height: nLat,
    noDataValue: NO_DATA,
    min: min === Infinity ? 0 : min,
    max: max === -Infinity ? 50 : max,
    values: outValues,
    source: 'gesdisc',
  };

  gridCache.set(cacheKey, result);
  return result;
}
