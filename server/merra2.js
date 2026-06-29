// Fetches MERRA2 CNN PM2.5 grid from NASA GES DISC OPeNDAP.
// Falls back to a synthetic sample grid when credentials are missing or the API is unreachable.
// Set EARTHDATA_USERNAME + EARTHDATA_PASSWORD (or EARTHDATA_TOKEN) in .env for real data.

import { getEarthdataBearerToken } from './earthdataAuth.js';

/** Dashboard focus — smaller OPeNDAP subset loads ~15× faster than global. */
export const AFRICA_BOUNDS = { south: -35, west: -25, north: 38, east: 55 };
const GLOBAL_WIDTH = 576;  // 0.625° lon resolution
const GLOBAL_HEIGHT = 361; // 0.5° lat resolution
const NO_DATA = -9999;

const gridCache = new Map();
/** Bump when grid response shape/bounds logic changes (clears stale in-memory entries after deploy). */
const GRID_CACHE_VERSION = 'africa-v1';

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

async function fetchOpendapAscii(dataUrl, subset, bearerToken) {
  const asciiUrl = `${dataUrl}.ascii?${subset}`;
  return fetch(asciiUrl, {
    headers: bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {},
    redirect: 'follow',
  });
}

export async function fetchMerra2Grid(date) {
  const cacheKey = `${GRID_CACHE_VERSION}:${date}`;
  if (gridCache.has(cacheKey)) {
    return gridCache.get(cacheKey);
  }

  let bearerToken = await getEarthdataBearerToken();

  const y = date.slice(0, 4);
  const m = date.slice(5, 7);
  const d = date.slice(8, 10);
  const granuleFile = `MERRA2_HAQAST_CNN_L4_V1.${y}${m}${d}.nc4`;
  const baseUrl = `https://acdisc.gesdisc.eosdis.nasa.gov/opendap/HAQAST/MERRA2_CNN_HAQAST_PM25.1/${y}/${granuleFile}`;

  const cmrUrl = `https://cmr.earthdata.nasa.gov/search/granules.umm_json?provider=GES_DISC&short_name=MERRA2_CNN_HAQAST_PM25&temporal=${date}T00:00:00Z,${date}T23:59:59Z&page_size=1`;
  let cmrRes;
  try {
    cmrRes = await fetch(cmrUrl);
  } catch (e) {
    console.warn('[MERRA2] CMR fetch failed:', e.message);
    return sampleGrid(date, 'cmr_network_error');
  }
  if (!cmrRes.ok) return sampleGrid(date, `cmr_http_${cmrRes.status}`);

  const cmrJson = await cmrRes.json();
  const items = cmrJson?.items ?? [];
  if (items.length === 0) {
    console.warn('[MERRA2] No granule for date:', date);
    return sampleGrid(date, 'no_granule_for_date');
  }

  const opendapUrl = items[0]?.umm?.RelatedUrls?.find((u) => u.Subtype === 'OPENDAP DATA')?.URL;
  const dataUrl = opendapUrl || baseUrl;
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
    units: 'µg/m³',
    bounds: { ...AFRICA_BOUNDS },
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
