/**
 * MERRA2 PM2.5 Grid API – fetches real data from GES DISC OPeNDAP
 * Requires EARTHDATA_USERNAME and EARTHDATA_PASSWORD in env (or .env)
 * Falls back to sample data if fetch fails.
 */

const GLOBAL = { south: -90, west: -180, north: 90, east: 180 };
const GLOBAL_WIDTH = 576; // 0.625 deg
const GLOBAL_HEIGHT = 361; // 0.5 deg

/** Generate sample grid (fallback when GES DISC unavailable) */
function sampleGrid(date, fallbackReason = 'fallback_unknown') {
  const { south, west, north, east } = GLOBAL;
  const values = [];
  let min = Infinity, max = -Infinity;
  for (let row = 0; row < GLOBAL_HEIGHT; row++) {
    const lat = north - (row / (GLOBAL_HEIGHT - 1)) * (north - south);
    for (let col = 0; col < GLOBAL_WIDTH; col++) {
      const lon = west + (col / (GLOBAL_WIDTH - 1)) * (east - west);
      const tropics = Math.exp(-Math.pow(lat / 28, 2));
      const plume1 = Math.exp(-Math.pow((lon - 80) / 35, 2)) * Math.exp(-Math.pow((lat - 25) / 12, 2));
      const plume2 = Math.exp(-Math.pow((lon - 20) / 20, 2)) * Math.exp(-Math.pow((lat - 0) / 15, 2));
      const base = 5 + 8 * tropics;
      let v = base + 65 * plume1 + 35 * plume2 + 3 * Math.sin((lat + lon) * 0.05);
      v = Math.max(2, Math.min(110, v));
      v = Math.round(v * 10) / 10;
      values.push(v);
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return {
    date,
    units: 'µg/m³',
    bounds: { south, west, north, east },
    width: GLOBAL_WIDTH,
    height: GLOBAL_HEIGHT,
    noDataValue: -9999,
    min,
    max,
    values,
    source: 'sample',
    fallbackReason,
  };
}

/** Parse OPeNDAP ASCII response into flat values array */
function parseOpendapAscii(text, width, height) {
  const values = [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const nums = line.trim().split(/[\s,]+/).map(Number).filter((n) => !isNaN(n));
    for (const n of nums) values.push(n);
  }
  if (values.length >= width * height) return values.slice(0, width * height);
  return null;
}

/** Build OPeNDAP subset indices for global MERRA-2 0.5°x0.625° grid */
function getGlobalIndices() {
  // MERRA-2: lat 361 pts (-90 to 90), lon 576 pts (-180 to 179.375)
  return { latMin: 0, latMax: 360, lonMin: 0, lonMax: 575 };
}

/** Fetch real MERRA2 PM2.5 grid from GES DISC */
export async function fetchMerra2Grid(date) {
  const username = process.env.EARTHDATA_USERNAME;
  const password = process.env.EARTHDATA_PASSWORD;
  const token = process.env.EARTHDATA_TOKEN;
  const useAuth = username && password;

  const y = date.slice(0, 4);
  const m = date.slice(5, 7);
  const d = date.slice(8, 10);
  const granuleFile = `MERRA2_HAQAST_CNN_L4_V1.${y}${m}${d}.nc4`;
  const baseUrl = `https://acdisc.gesdisc.eosdis.nasa.gov/opendap/HAQAST/MERRA2_CNN_HAQAST_PM25.1/${y}/${granuleFile}`;

  // CMR check – verify granule exists
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
  const items = cmrJson?.items || [];
  if (items.length === 0) {
    console.warn('[MERRA2] No granule for date:', date);
    return sampleGrid(date, 'no_granule_for_date');
  }

  const opendapUrl = items[0]?.umm?.RelatedUrls?.find((u) => u.Subtype === 'OPENDAP DATA')?.URL;
  const dataUrl = opendapUrl || baseUrl;

  const { latMin, latMax, lonMin, lonMax } = getGlobalIndices();
  // One timestep (noon = index 12), global subset
  const subset = `MERRA2_CNN_Surface_PM25[12:12][${latMin}:${latMax}][${lonMin}:${lonMax}]`;
  const asciiUrl = `${dataUrl}.ascii?${subset}`;

  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${String(token).trim()}`;
  } else if (useAuth) {
    headers.Authorization = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  }

  let res;
  try {
    res = await fetch(asciiUrl, {
      headers,
      redirect: 'follow',
    });
  } catch (e) {
    console.warn('[MERRA2] OPeNDAP fetch failed:', e.message);
    return sampleGrid(date, 'opendap_network_error');
  }

  if (!res.ok) {
    console.warn('[MERRA2] OPeNDAP returned', res.status, res.statusText);
    if (res.status === 401 && !useAuth && !token) {
      console.warn('[MERRA2] Set EARTHDATA_USERNAME/EARTHDATA_PASSWORD or EARTHDATA_TOKEN for real data.');
    }
    return sampleGrid(date, res.status === 401 ? 'opendap_401_unauthorized' : `opendap_http_${res.status}`);
  }

  const text = await res.text();
  const nLat = latMax - latMin + 1;
  const nLon = lonMax - lonMin + 1;
  const values = parseOpendapAscii(text, nLon, nLat);
  if (!values || values.length === 0) {
    console.warn('[MERRA2] Could not parse OPeNDAP ASCII');
    return sampleGrid(date, 'opendap_parse_error');
  }

  // Keep full global resolution
  const outValues = [];
  let min = Infinity, max = -Infinity;
  const noData = -9999;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const num = typeof v === 'number' && !isNaN(v) && v !== noData ? Math.round(v * 10) / 10 : noData;
    outValues.push(num);
    if (num !== noData) {
      if (num < min) min = num;
      if (num > max) max = num;
    }
  }

  return {
    date,
    units: 'µg/m³',
    bounds: { ...GLOBAL },
    width: nLon,
    height: nLat,
    noDataValue: noData,
    min: min === Infinity ? 0 : min,
    max: max === -Infinity ? 50 : max,
    values: outValues,
    source: 'gesdisc',
  };
}
