/**
 * FIRMS (Fire Information for Resource Management System) API
 * Fetches active fire / hotspot data from NASA VIIRS
 * Proxy: /api/firms -> firms.modaps.eosdis.nasa.gov
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
  // FIRMS area API: world or bbox "minLat,minLon,maxLat,maxLon"
  const bbox = '-37,-18,37,52'; // Africa
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
