// NASA FIRMS VIIRS fire hotspot data.
// Primary: backend-compacted `/api/firms/fires7day` feed — the server fetches + caches the
// raw NOAA-21 WFS GeoJSON (50MB+ per region) and returns a small gzip-compressed tuple array.
// Fallback 1: raw WFS GeoJSON directly from the browser (2 parallel, very large requests).
// Fallback 2: CSV Area API (NOAA-20) when WFS also fails.

const FIRMS_KEY = import.meta.env.VITE_FIRMS_MAP_KEY || '';
const API_BASE  = '/api/firms';

const WFS_CACHE_TTL_MS = 15 * 60 * 1000;
const SESSION_CACHE_KEY = 'aaqe-firms7day-v1';
const LOCAL_CACHE_KEY = 'aaqe-firms7day-v1-ls';
let wfsCache: { data: FIRMSFirePoint[]; ts: number } | null = null;
let wfsInflight: Promise<FIRMSFirePoint[]> | null = null;
const fireReadyListeners = new Set<(points: FIRMSFirePoint[]) => void>();

function readStoredFireCache(storage: Storage, key: string): FIRMSFirePoint[] | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts: number; data: FIRMSFirePoint[] };
    if (!parsed?.data?.length || Date.now() - parsed.ts > WFS_CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeStoredFireCache(storage: Storage, key: string, data: FIRMSFirePoint[]) {
  if (data.length === 0) return;
  try {
    storage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    /* quota / private mode */
  }
}

function readSessionFireCache(): FIRMSFirePoint[] | null {
  return readStoredFireCache(sessionStorage, SESSION_CACHE_KEY);
}

function readLocalFireCache(): FIRMSFirePoint[] | null {
  return readStoredFireCache(localStorage, LOCAL_CACHE_KEY);
}

function writeSessionFireCache(data: FIRMSFirePoint[]) {
  writeStoredFireCache(sessionStorage, SESSION_CACHE_KEY, data);
  writeStoredFireCache(localStorage, LOCAL_CACHE_KEY, data);
}

function notifyFireReady(points: FIRMSFirePoint[]) {
  if (points.length === 0) return;
  for (const listener of fireReadyListeners) listener(points);
}

export function subscribeFirePoints(listener: (points: FIRMSFirePoint[]) => void): () => void {
  fireReadyListeners.add(listener);
  const cached = peekFirePoints();
  if (cached?.length) listener(cached);
  return () => {
    fireReadyListeners.delete(listener);
  };
}

/** Instant read of cached fire points (memory → session → localStorage) — no network. */
export function peekFirePoints(): FIRMSFirePoint[] | null {
  if (wfsCache && Date.now() - wfsCache.ts < WFS_CACHE_TTL_MS) return wfsCache.data;
  const sessionHit = readSessionFireCache();
  if (sessionHit) {
    wfsCache = { data: sessionHit, ts: Date.now() };
    return sessionHit;
  }
  const localHit = readLocalFireCache();
  if (localHit) {
    wfsCache = { data: localHit, ts: Date.now() };
    return localHit;
  }
  return null;
}

function commitFireCache(data: FIRMSFirePoint[]): FIRMSFirePoint[] {
  if (data.length > 0) {
    wfsCache = { data, ts: Date.now() };
    writeSessionFireCache(data);
    notifyFireReady(data);
  }
  return data;
}

/** Warm the fire cache as soon as the app or dashboard opens. */
export function prefetchFires(): Promise<FIRMSFirePoint[]> {
  return getNOAA21VIIRS7DayFromWFS();
}

/** Idempotent — safe to call from App mount and dashboard hooks. */
export function ensureFiresPrefetched(): Promise<FIRMSFirePoint[]> {
  const cached = peekFirePoints();
  if (cached?.length) {
    void getNOAA21VIIRS7DayFromWFS();
    return Promise.resolve(cached);
  }
  return prefetchFires();
}

export interface FIRMSFirePoint {
  latitude: number;
  longitude: number;
  bright_ti4: number;
  bright_ti5?: number;
  scan: number;
  track: number;
  acq_date: string;
  acq_time: string;
  satellite: string;
  instrument: string;
  confidence: string;
  version?: string;
  frp?: number;
  daynight: string;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].toLowerCase().split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    const row: Record<string, string> = {};
    headers.forEach((h, j) => { row[h] = values[j]?.trim() ?? ''; });
    return row;
  });
}

export async function getNOAA20VIIRS7DayDataset(): Promise<FIRMSFirePoint[]> {
  if (!FIRMS_KEY) { console.warn('[FIRMS] No VITE_FIRMS_MAP_KEY in .env'); return []; }
  const source = 'VIIRS_NOAA20_NRT';
  const bbox = '-18,-35,51.5,37.3'; // Africa: west,south,east,north
  const results: FIRMSFirePoint[] = [];
  try {
    for (let day = 1; day <= 7; day++) {
      const res = await fetch(`${API_BASE}/api/area/csv/${FIRMS_KEY}/${source}/${bbox}/${day}`);
      if (!res.ok) {
        console.warn(`[FIRMS] Day ${day} unavailable (${res.status}); skipping.`);
        continue;
      }
      for (const r of parseCSV(await res.text())) {
        const lat = parseFloat(r.latitude), lng = parseFloat(r.longitude);
        if (isNaN(lat) || isNaN(lng)) continue;
        results.push({
          latitude: lat, longitude: lng,
          bright_ti4: parseFloat(r.bright_ti4) || 0,
          bright_ti5: r.bright_ti5 ? parseFloat(r.bright_ti5) : undefined,
          scan: parseFloat(r.scan) || 0, track: parseFloat(r.track) || 0,
          acq_date: r.acq_date || '', acq_time: r.acq_time || '',
          satellite: r.satellite || 'NOAA-20', instrument: r.instrument || 'VIIRS',
          confidence: r.confidence || '', version: r.version || '2.0NRT',
          frp: r.frp ? parseFloat(r.frp) : undefined, daynight: r.daynight || '',
        });
      }
    }
    return results;
  } catch (err) {
    console.error('[FIRMS] Error:', err);
    return [];
  }
}

interface WFSFireFeature {
  type: 'Feature';
  properties: {
    latitude?: number; longitude?: number; brightness?: number; brightness_2?: number;
    scan?: number; track?: number; acq_date?: string; acq_time?: number | string;
    confidence?: string; frp?: number; daynight?: string;
  };
  geometry?: { type: 'Point'; coordinates: [number, number] };
}

function wfsFeatureToFirePoint(f: WFSFireFeature): FIRMSFirePoint | null {
  const lon = f.geometry?.coordinates?.[0] ?? f.properties.longitude;
  const lat = f.geometry?.coordinates?.[1] ?? f.properties.latitude;
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return null;
  const acqTime = f.properties.acq_time;
  const acqTimeStr = typeof acqTime === 'number'
    ? String(Math.floor(acqTime)).padStart(4, '0')
    : (acqTime as string) ?? '';
  return {
    latitude: lat, longitude: lon,
    bright_ti4: f.properties.brightness ?? 0,
    bright_ti5: f.properties.brightness_2,
    scan: f.properties.scan ?? 0, track: f.properties.track ?? 0,
    acq_date: f.properties.acq_date ?? '', acq_time: acqTimeStr,
    satellite: 'NOAA-21', instrument: 'VIIRS',
    confidence: String(f.properties.confidence ?? ''),
    version: '2.0NRT', frp: f.properties.frp, daynight: f.properties.daynight ?? 'D',
  };
}

/** Field order used by the backend's compact `/api/firms/fires7day` tuple feed. */
const COMPACT_FIELDS = [
  'latitude', 'longitude', 'brightness', 'brightness_2', 'scan', 'track',
  'acq_date', 'acq_time', 'confidence', 'frp', 'daynight',
] as const;

type CompactTuple = [
  number, number, number, number | null, number, number,
  string, string, string, number | null, string,
];

function compactTupleToFirePoint(t: CompactTuple): FIRMSFirePoint | null {
  const [latitude, longitude, brightness, brightness_2, scan, track, acq_date, acq_time, confidence, frp, daynight] = t;
  if (latitude == null || longitude == null || isNaN(latitude) || isNaN(longitude)) return null;
  return {
    latitude, longitude, bright_ti4: brightness ?? 0,
    bright_ti5: brightness_2 ?? undefined,
    scan: scan ?? 0, track: track ?? 0,
    acq_date: acq_date ?? '', acq_time: acq_time ?? '',
    satellite: 'NOAA-21', instrument: 'VIIRS',
    confidence: confidence ?? '', version: '2.0NRT',
    frp: frp ?? undefined, daynight: daynight || 'D',
  };
}

/**
 * Fetches the compact, server-minified 7-day Africa fire feed. The backend fetches +
 * caches the raw WFS GeoJSON (which is 50MB+ per region) and serves back a gzip-compressed
 * array of numeric tuples instead, avoiding that huge download/parse in the browser.
 */
async function fetchNOAA21VIIRS7DayFromWFS(): Promise<FIRMSFirePoint[]> {
  try {
    const res = await fetch(`${API_BASE}/fires7day`);
    if (!res.ok) throw new Error(`FIRMS compact feed ${res.status}: ${res.statusText}`);
    const data = (await res.json()) as { fields?: string[]; points?: CompactTuple[] };
    const fields = data.fields ?? [];
    const sameOrder = fields.length === COMPACT_FIELDS.length && fields.every((f, i) => f === COMPACT_FIELDS[i]);
    if (!sameOrder) console.warn('[FIRMS] Compact feed field order changed unexpectedly.');
    const points = data.points ?? [];
    const results: FIRMSFirePoint[] = [];
    for (const t of points) {
      const pt = compactTupleToFirePoint(t);
      if (pt) results.push(pt);
    }
    return results;
  } catch (err) {
    console.warn('[FIRMS] Compact feed failed, falling back to raw WFS:', err);
    return fetchNOAA21VIIRS7DayFromRawWFS();
  }
}

async function fetchNOAA21VIIRS7DayFromRawWFS(): Promise<FIRMSFirePoint[]> {
  if (!FIRMS_KEY) { console.warn('[FIRMS] No VITE_FIRMS_MAP_KEY in .env'); return []; }
  const layer = 'ms:fires_noaa21_7days';
  const params = new URLSearchParams({
    SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature',
    TYPENAME: layer, OUTPUTFORMAT: 'application/json',
  });
  const regions = ['Northern_and_Central_Africa', 'Southern_Africa'] as const;
  const urls = regions.map((r) => `${API_BASE}/mapserver/wfs/${r}/${FIRMS_KEY}/?${params}`);
  try {
    const responses = await Promise.all(urls.map((u) => fetch(u)));
    const results: FIRMSFirePoint[] = [];
    for (const res of responses) {
      if (!res.ok) throw new Error(`FIRMS WFS ${res.status}: ${res.statusText}`);
      const data = (await res.json()) as { features?: WFSFireFeature[] };
      for (const f of data.features ?? []) {
        const pt = wfsFeatureToFirePoint(f);
        if (pt) results.push(pt);
      }
    }
    return results;
  } catch (err) {
    console.warn('[FIRMS WFS] Failed, falling back to CSV API:', err);
    return getNOAA20VIIRS7DayDataset();
  }
}

/** Cached wrapper — avoids refetching on every layer switch. */
export async function getNOAA21VIIRS7DayFromWFS(): Promise<FIRMSFirePoint[]> {
  const now = Date.now();
  if (wfsCache && now - wfsCache.ts < WFS_CACHE_TTL_MS) return wfsCache.data;

  const sessionHit = readSessionFireCache();
  const storedHit = sessionHit ?? readLocalFireCache();
  if (storedHit) {
    wfsCache = { data: storedHit, ts: Date.now() };
    if (!wfsInflight) {
      wfsInflight = fetchNOAA21VIIRS7DayFromWFS()
        .then(commitFireCache)
        .finally(() => { wfsInflight = null; });
    }
    return storedHit;
  }

  if (wfsInflight) return wfsInflight;

  wfsInflight = fetchNOAA21VIIRS7DayFromWFS()
    .then(commitFireCache)
    .finally(() => { wfsInflight = null; });
  return wfsInflight;
}
