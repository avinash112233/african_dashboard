// NASA FIRMS VIIRS fire hotspot data.
// Primary: WFS shapefile-backed NOAA-21 7-day regional layers (fast, 2 parallel requests).
// Fallback: CSV Area API (NOAA-20) when WFS returns an error.

const FIRMS_KEY = import.meta.env.VITE_FIRMS_MAP_KEY || '';
const API_BASE  = '/api/firms';

const WFS_CACHE_TTL_MS = 15 * 60 * 1000;
let wfsCache: { data: FIRMSFirePoint[]; ts: number } | null = null;
let wfsInflight: Promise<FIRMSFirePoint[]> | null = null;

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
      if (!res.ok) throw new Error(`FIRMS API ${res.status}: ${res.statusText}`);
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

async function fetchNOAA21VIIRS7DayFromWFS(): Promise<FIRMSFirePoint[]> {
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
  if (wfsInflight) return wfsInflight;
  wfsInflight = fetchNOAA21VIIRS7DayFromWFS()
    .then((data) => { wfsCache = { data, ts: Date.now() }; return data; })
    .finally(() => { wfsInflight = null; });
  return wfsInflight;
}
