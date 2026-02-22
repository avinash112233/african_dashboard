/**
 * FIRMS (Fire Information for Resource Management System) API
 * Fetches active fire / hotspot data from NASA VIIRS
 * Proxy: /api/firms -> firms.modaps.eosdis.nasa.gov
 *
 * Two data sources:
 * - WFS (shapefile-backed): VIIRS NOAA-21 7d for Northern_and_Central_Africa + Southern_Africa (faster, 2 requests)
 * - CSV Area API: VIIRS NOAA-20, bbox-based (legacy)
 */

const FIRMS_KEY = import.meta.env.VITE_FIRMS_MAP_KEY || '';
const API_BASE = '/api/firms';

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
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = values[j]?.trim() ?? '';
    });
    rows.push(row);
  }
  return rows;
}

export async function getNOAA20VIIRS7DayDataset(): Promise<FIRMSFirePoint[]> {
  if (!FIRMS_KEY) {
    console.warn('[FIRMS] No VITE_FIRMS_MAP_KEY in .env');
    return [];
  }
  const results: FIRMSFirePoint[] = [];
  const source = 'VIIRS_NOAA20_NRT';
  // FIRMS area API: bbox format is west,south,east,north (NOT minLat,minLon,maxLat,maxLon)
  // Africa-only: Cape Verde (-18°W) to Cape Hafun (51.5°E), Cape Agulhas (-35°S) to Tunisia (37.3°N)
  const bbox = '-18,-35,51.5,37.3';
  try {
    for (let day = 1; day <= 7; day++) {
      const url = `${API_BASE}/api/area/csv/${FIRMS_KEY}/${source}/${bbox}/${day}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`FIRMS API ${res.status}: ${res.statusText}`);
      const text = await res.text();
      const rows = parseCSV(text);
      for (const r of rows) {
        const lat = parseFloat(r.latitude);
        const lng = parseFloat(r.longitude);
        if (isNaN(lat) || isNaN(lng)) continue;
        results.push({
          latitude: lat,
          longitude: lng,
          bright_ti4: parseFloat(r.bright_ti4) || 0,
          bright_ti5: r.bright_ti5 ? parseFloat(r.bright_ti5) : undefined,
          scan: parseFloat(r.scan) || 0,
          track: parseFloat(r.track) || 0,
          acq_date: r.acq_date || '',
          acq_time: r.acq_time || '',
          satellite: r.satellite || 'NOAA-20',
          instrument: r.instrument || 'VIIRS',
          confidence: r.confidence || '',
          version: r.version || '2.0NRT',
          frp: r.frp ? parseFloat(r.frp) : undefined,
          daynight: r.daynight || '',
        });
      }
    }
    return results;
  } catch (err) {
    console.error('[FIRMS] Error:', err);
    return [];
  }
}

/** WFS GeoJSON feature from fires_noaa21_7days layer */
interface WFSFireFeature {
  type: 'Feature';
  properties: {
    latitude?: number;
    longitude?: number;
    brightness?: number;
    brightness_2?: number;
    scan?: number;
    track?: number;
    acq_date?: string;
    acq_time?: number | string;
    confidence?: string;
    frp?: number;
    daynight?: string;
  };
  geometry?: { type: 'Point'; coordinates: [number, number] };
}

function wfsFeatureToFirePoint(f: WFSFireFeature): FIRMSFirePoint | null {
  const lon = f.geometry?.coordinates?.[0] ?? f.properties.longitude;
  const lat = f.geometry?.coordinates?.[1] ?? f.properties.latitude;
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return null;
  const acqTime = f.properties.acq_time;
  const acqTimeStr =
    typeof acqTime === 'number'
      ? String(Math.floor(acqTime)).padStart(4, '0')
      : (acqTime as string) ?? '';
  return {
    latitude: lat,
    longitude: lon,
    bright_ti4: f.properties.brightness ?? 0,
    bright_ti5: f.properties.brightness_2,
    scan: f.properties.scan ?? 0,
    track: f.properties.track ?? 0,
    acq_date: f.properties.acq_date ?? '',
    acq_time: acqTimeStr,
    satellite: 'NOAA-21',
    instrument: 'VIIRS',
    confidence: String(f.properties.confidence ?? ''),
    version: '2.0NRT',
    frp: f.properties.frp,
    daynight: f.properties.daynight ?? 'D',
  };
}

/**
 * Fetch VIIRS NOAA-21 7-day fire hotspots from WFS (regional shapefile-backed data).
 * Uses Northern_and_Central_Africa + Southern_Africa layers for faster loading.
 */
export async function getNOAA21VIIRS7DayFromWFS(): Promise<FIRMSFirePoint[]> {
  if (!FIRMS_KEY) {
    console.warn('[FIRMS] No VITE_FIRMS_MAP_KEY in .env');
    return [];
  }
  const layer = 'fires_noaa21_7days';
  const base = `${API_BASE}/mapserver/wfs`;
  const regions = ['Northern_and_Central_Africa', 'Southern_Africa'] as const;
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAME: layer,
    OUTPUTFORMAT: 'application/json',
  });

  const urls = regions.map(
    (r) => `${base}/${r}/${FIRMS_KEY}/?${params.toString()}`
  );

  try {
    const responses = await Promise.all(urls.map((u) => fetch(u)));
    const results: FIRMSFirePoint[] = [];
    for (const res of responses) {
      if (!res.ok) throw new Error(`FIRMS WFS ${res.status}: ${res.statusText}`);
      const data = (await res.json()) as { features?: WFSFireFeature[] };
      const features = data.features ?? [];
      for (const f of features) {
        const pt = wfsFeatureToFirePoint(f);
        if (pt) results.push(pt);
      }
    }
    return results;
  } catch (err) {
    console.error('[FIRMS WFS] Error:', err);
    return [];
  }
}
