/**
 * NASA FIRMS VIIRS (NOAA-21) fire hotspots — server-side fetch + compaction.
 *
 * Primary source: the FIRMS "Area" CSV API with a single bounding box covering
 * all of Africa. This replaced the old per-region MapServer WFS calls
 * (`Northern_and_Central_Africa` + `Southern_Africa`) because NASA's WFS
 * endpoint for `Southern_Africa` fails with a persistent HTTP 500 — that
 * silently dropped every fire hotspot south of the Sahel from the map. The
 * Area API has no such per-region bug and returns the whole continent in one
 * request. Its per-call day range is capped at 5, so we issue two
 * back-to-back (non-overlapping) 5-day windows to cover a full 7+ day feed.
 *
 * Fallback: if the Area API is unreachable, we fall back to the legacy
 * per-region WFS fetch (best-effort — a region-specific outage there would
 * again mean partial coverage, but it's better than nothing).
 *
 * Either way we strip the result down to plain numeric tuples (no repeated
 * "type":"Feature"/"properties"/key-name boilerplate), cache it in memory,
 * and serve the compact form (gzip-compressed by the `compression`
 * middleware) to the client.
 */

const FIRMS_KEY = process.env.FIRMS_MAP_KEY || process.env.VITE_FIRMS_MAP_KEY || '';
const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov';

// west,south,east,north — covers the African continent + Madagascar.
const AFRICA_BBOX = '-20,-37,52,38';
const AREA_SOURCE = 'VIIRS_NOAA21_NRT';
const AREA_MAX_DAY_RANGE = 5;

const WFS_LAYER = 'ms:fires_noaa21_7days';
const WFS_REGIONS = ['Northern_and_Central_Africa', 'Southern_Africa'];

const CACHE_TTL_MS = 15 * 60 * 1000;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 600;

/** Field order for the compact tuple representation returned to clients. */
export const FIRMS_FIELDS = [
  'latitude',
  'longitude',
  'brightness',
  'brightness_2',
  'scan',
  'track',
  'acq_date',
  'acq_time',
  'confidence',
  'frp',
  'daynight',
];

let cache = null; // { ts, points }
let inflight = null;

function round(value, dp) {
  if (value == null || Number.isNaN(value)) return null;
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY_ATTEMPTS) {
        console.warn(`[FIRMS] ${label} attempt ${attempt} failed (${err.message}); retrying…`);
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastErr;
}

// ── Primary: Area CSV API (single bbox, whole continent) ────────────────────

function isoDateNDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function buildAreaUrl(dayRange, dateStr) {
  const datePart = dateStr ? `/${dateStr}` : '';
  return `${FIRMS_BASE}/api/area/csv/${FIRMS_KEY}/${AREA_SOURCE}/${AFRICA_BBOX}/${dayRange}${datePart}`;
}

function parseAreaCsv(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].toLowerCase().split(',').map((h) => h.trim());
  const idx = {};
  headers.forEach((h, i) => { idx[h] = i; });
  const need = (col) => idx[col];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const lat = parseFloat(cols[need('latitude')]);
    const lon = parseFloat(cols[need('longitude')]);
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    const acqTimeRaw = idx.acq_time != null ? cols[idx.acq_time] : '';
    const bright = idx.bright_ti4 != null ? parseFloat(cols[idx.bright_ti4]) : NaN;
    const bright2 = idx.bright_ti5 != null ? parseFloat(cols[idx.bright_ti5]) : NaN;
    const frp = idx.frp != null ? parseFloat(cols[idx.frp]) : NaN;
    out.push([
      round(lat, 5),
      round(lon, 5),
      Number.isFinite(bright) ? bright : 0,
      Number.isFinite(bright2) ? bright2 : null,
      idx.scan != null ? parseFloat(cols[idx.scan]) || 0 : 0,
      idx.track != null ? parseFloat(cols[idx.track]) || 0 : 0,
      idx.acq_date != null ? cols[idx.acq_date] ?? '' : '',
      String(acqTimeRaw ?? '').padStart(4, '0'),
      String(idx.confidence != null ? cols[idx.confidence] ?? '' : ''),
      Number.isFinite(frp) ? frp : null,
      idx.daynight != null ? cols[idx.daynight] ?? 'D' : 'D',
    ]);
  }
  return out;
}

async function fetchAreaWindow(dayRange, dateStr) {
  const res = await fetch(buildAreaUrl(dayRange, dateStr));
  if (!res.ok) {
    throw new Error(`FIRMS area API (${dateStr ?? 'recent'}) ${res.status}: ${res.statusText}`);
  }
  const text = await res.text();
  return parseAreaCsv(text);
}

/** Two contiguous 5-day windows = 10 days of coverage (comfortably >= 7). */
async function fetchAllFromArea() {
  const windows = [
    { dayRange: AREA_MAX_DAY_RANGE, date: undefined }, // today-4 .. today
    { dayRange: AREA_MAX_DAY_RANGE, date: isoDateNDaysAgo(9) }, // today-9 .. today-5
  ];
  const settled = await Promise.allSettled(
    windows.map((w, i) => withRetry(() => fetchAreaWindow(w.dayRange, w.date), `area window ${i}`))
  );
  const chunks = [];
  const failures = [];
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') chunks.push(result.value);
    else failures.push(`window${i}: ${result.reason?.message || result.reason}`);
  });
  const points = chunks.flat();
  if (points.length === 0) {
    throw new Error(`FIRMS area API failed for all windows — ${failures.join('; ')}`);
  }
  if (failures.length > 0) {
    console.warn(`[FIRMS] Area API partial failure (serving other window): ${failures.join('; ')}`);
  }
  return points;
}

// ── Fallback: legacy per-region MapServer WFS ────────────────────────────────

function buildWfsUrl(region) {
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAME: WFS_LAYER,
    OUTPUTFORMAT: 'application/json',
  });
  return `${FIRMS_BASE}/mapserver/wfs/${region}/${FIRMS_KEY}/?${params}`;
}

async function fetchWfsRegion(region) {
  const res = await fetch(buildWfsUrl(region));
  if (!res.ok) throw new Error(`FIRMS WFS ${region} ${res.status}: ${res.statusText}`);
  const data = await res.json();
  const out = [];
  for (const feature of data.features ?? []) {
    const p = feature.properties || {};
    const lon = feature.geometry?.coordinates?.[0] ?? p.longitude;
    const lat = feature.geometry?.coordinates?.[1] ?? p.latitude;
    if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) continue;
    const acqTime = p.acq_time;
    const acqTimeStr =
      typeof acqTime === 'number' ? String(Math.floor(acqTime)).padStart(4, '0') : String(acqTime ?? '');
    out.push([
      round(lat, 5),
      round(lon, 5),
      p.brightness ?? 0,
      p.brightness_2 ?? null,
      p.scan ?? 0,
      p.track ?? 0,
      p.acq_date ?? '',
      acqTimeStr,
      String(p.confidence ?? ''),
      p.frp ?? null,
      p.daynight ?? 'D',
    ]);
  }
  return out;
}

async function fetchAllFromWfsRegions() {
  const settled = await Promise.allSettled(
    WFS_REGIONS.map((region) => withRetry(() => fetchWfsRegion(region), `WFS ${region}`))
  );
  const chunks = [];
  const failures = [];
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') chunks.push(result.value);
    else failures.push(`${WFS_REGIONS[i]}: ${result.reason?.message || result.reason}`);
  });
  const points = chunks.flat();
  if (points.length === 0 && failures.length > 0) {
    throw new Error(`All FIRMS WFS regions failed — ${failures.join('; ')}`);
  }
  if (failures.length > 0) {
    console.warn(`[FIRMS] WFS fallback partial failure (serving other regions): ${failures.join('; ')}`);
  }
  return points;
}

async function fetchAllPoints() {
  try {
    return await fetchAllFromArea();
  } catch (err) {
    console.warn(`[FIRMS] Area API failed entirely, falling back to per-region WFS: ${err.message}`);
    return fetchAllFromWfsRegions();
  }
}

/** Fetches (with in-memory caching) the compact multi-day Africa fire point list. */
export async function getFires7Day() {
  if (!FIRMS_KEY) {
    const err = new Error('FIRMS_MAP_KEY (or VITE_FIRMS_MAP_KEY) is not set');
    err.status = 503;
    throw err;
  }

  const now = Date.now();
  const fresh = cache && now - cache.ts < CACHE_TTL_MS;
  if (fresh) return cache;

  // Stale-while-revalidate: return last good cache immediately, refresh in background.
  if (cache && !inflight) {
    inflight = fetchAllPoints()
      .then((points) => {
        cache = { ts: Date.now(), points };
        return cache;
      })
      .catch((err) => {
        console.warn('[FIRMS] Background refresh failed, keeping stale cache:', err.message);
        return cache;
      })
      .finally(() => {
        inflight = null;
      });
    return cache;
  }

  if (inflight) return inflight;

  inflight = fetchAllPoints()
    .then((points) => {
      cache = { ts: Date.now(), points };
      return cache;
    })
    .catch((err) => {
      if (cache) {
        console.warn('[FIRMS] Refresh failed, serving stale cache:', err.message);
        return cache;
      }
      throw err;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** One-time warm at boot so the first real request doesn't pay the ~10s+ upstream latency. */
export function startFirmsCacheWarmer() {
  if (!FIRMS_KEY) return;
  getFires7Day()
    .then((c) => console.log(`[FIRMS] Cache warmed: ${c.points.length} fire points.`))
    .catch((err) => console.warn('[FIRMS] Cache warm failed:', err.message));
}
