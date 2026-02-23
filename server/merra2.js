/**
 * MERRA2 PM2.5 Grid API – fetches real data from GES DISC OPeNDAP
 * Requires EARTHDATA_USERNAME and EARTHDATA_PASSWORD in env (or .env)
 * Falls back to sample data if fetch fails.
 */

const AFRICA = { south: -35, west: -18, north: 37, east: 51 };
const WIDTH = 70;
const HEIGHT = 73;

/** Generate sample grid (fallback when GES DISC unavailable) */
function sampleGrid(date) {
  const { south, west, north, east } = AFRICA;
  const values = [];
  let min = Infinity, max = -Infinity;
  for (let row = 0; row < HEIGHT; row++) {
    const lat = north - (row / (HEIGHT - 1)) * (north - south);
    for (let col = 0; col < WIDTH; col++) {
      const lon = west + (col / (WIDTH - 1)) * (east - west);
      const sahel = lat > 10 && lat < 20 ? 1.2 : 1;
      const noise = 0.7 + Math.sin(lat * 0.15) * 0.3 + Math.cos(lon * 0.12) * 0.2;
      let v = Math.max(4, Math.min(80, 15 * sahel * noise + 5));
      if (lon < -5 || lon > 45) v *= 0.6;
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
    width: WIDTH,
    height: HEIGHT,
    noDataValue: -9999,
    min,
    max,
    values,
    source: 'sample',
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

/** Build OPeNDAP subset indices for Africa and MERRA-2 0.5°x0.625° grid */
function getAfricaIndices() {
  // MERRA-2: lat 361 pts (-90 to 90), lon 576 pts (-180 to 179.375)
  const latIdx = (lat) => Math.round((90 - lat) / 0.5);
  const lonIdx = (lon) => Math.round((lon + 180) / 0.625);
  const latMin = Math.max(0, latIdx(AFRICA.north));
  const latMax = Math.min(360, latIdx(AFRICA.south));
  const lonMin = Math.max(0, lonIdx(AFRICA.west));
  const lonMax = Math.min(575, lonIdx(AFRICA.east));
  return { latMin, latMax, lonMin, lonMax };
}

/** Fetch real MERRA2 PM2.5 grid from GES DISC */
export async function fetchMerra2Grid(date) {
  const username = process.env.EARTHDATA_USERNAME;
  const password = process.env.EARTHDATA_PASSWORD;
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
    return sampleGrid(date);
  }
  if (!cmrRes.ok) return sampleGrid(date);

  const cmrJson = await cmrRes.json();
  const items = cmrJson?.items || [];
  if (items.length === 0) {
    console.warn('[MERRA2] No granule for date:', date);
    return sampleGrid(date);
  }

  const opendapUrl = items[0]?.umm?.RelatedUrls?.find((u) => u.Subtype === 'OPENDAP DATA')?.URL;
  const dataUrl = opendapUrl || baseUrl;

  const { latMin, latMax, lonMin, lonMax } = getAfricaIndices();
  // One timestep (noon = index 12), Africa subset
  const subset = `MERRA2_CNN_Surface_PM25[12:12][${latMin}:${latMax}][${lonMin}:${lonMax}]`;
  const asciiUrl = `${dataUrl}.ascii?${subset}`;

  const headers = {};
  if (useAuth) {
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
    return sampleGrid(date);
  }

  if (!res.ok) {
    console.warn('[MERRA2] OPeNDAP returned', res.status, res.statusText);
    if (res.status === 401 && !useAuth) {
      console.warn('[MERRA2] Set EARTHDATA_USERNAME and EARTHDATA_PASSWORD for real data.');
    }
    return sampleGrid(date);
  }

  const text = await res.text();
  const nLat = latMax - latMin + 1;
  const nLon = lonMax - lonMin + 1;
  const values = parseOpendapAscii(text, nLon, nLat);
  if (!values || values.length === 0) {
    console.warn('[MERRA2] Could not parse OPeNDAP ASCII');
    return sampleGrid(date);
  }

  // Downsample to our grid size if needed
  const outValues = [];
  let min = Infinity, max = -Infinity;
  const noData = -9999;
  for (let row = 0; row < HEIGHT; row++) {
    const sr = Math.floor((row / (HEIGHT - 1)) * (nLat - 1));
    for (let col = 0; col < WIDTH; col++) {
      const sc = Math.floor((col / (WIDTH - 1)) * (nLon - 1));
      const idx = sr * nLon + sc;
      const v = values[idx];
      const num = typeof v === 'number' && !isNaN(v) && v !== noData ? Math.round(v * 10) / 10 : noData;
      outValues.push(num);
      if (num !== noData) {
        if (num < min) min = num;
        if (num > max) max = num;
      }
    }
  }

  return {
    date,
    units: 'µg/m³',
    bounds: { ...AFRICA },
    width: WIDTH,
    height: HEIGHT,
    noDataValue: noData,
    min: min === Infinity ? 0 : min,
    max: max === -Infinity ? 50 : max,
    values: outValues,
    source: 'gesdisc',
  };
}
