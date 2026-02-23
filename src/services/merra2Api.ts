/**
 * MERRA2_CNN_HAQAST_PM25 – bias-corrected global hourly surface PM2.5
 * Fetches Africa subset via /api/merra2/pm25/grid backend (proxied to GES DISC OPeNDAP or sample)
 * Dataset: https://www.earthdata.nasa.gov/data/catalog/ges-disc-merra2-cnn-haqast-pm25-1
 * Coverage: 2000-01-01 to 2024-12-31
 */

/** Africa bounding box for subset */
const AFRICA_BBOX = { latMin: -35, latMax: 37, lonMin: -18, lonMax: 51 };

/** Grid response contract for canvas overlay (GET /api/merra2/pm25/grid) */
export interface MERRA2PM25GridResponse {
  date: string;
  units: string;
  bounds: { south: number; west: number; north: number; east: number };
  width: number;
  height: number;
  noDataValue: number;
  min: number;
  max: number;
  values: number[];
  /** 'gesdisc' = real NASA data from backend; 'sample' = static fallback */
  source: 'gesdisc' | 'sample';
}

/**
 * Fetch MERRA2 PM2.5 grid for Africa (canvas overlay format).
 * Returns bounds, dimensions, and flattened values array (row-major).
 * In dev: tries backend (npm run api); falls back to sample if backend down or date out of range.
 * In prod: always uses sample data (no backend available on static hosts).
 */
export async function getMERRA2PM25Grid(date: string): Promise<MERRA2PM25GridResponse> {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '';
  const apiUrl = `${base}/api/merra2/pm25/grid?date=${encodeURIComponent(date)}`;
  const sampleUrl = `${base}/merra2-sample-grid.json`;

  const loadSample = async (): Promise<MERRA2PM25GridResponse> => {
    const res = await fetch(sampleUrl);
    if (!res.ok) throw new Error('MERRA2 PM2.5 sample unavailable');
    const data = (await res.json()) as Omit<MERRA2PM25GridResponse, 'source'>;
    if (!data.values || !data.bounds) throw new Error('Invalid sample grid');
    return { ...data, source: 'sample' };
  };

  if (import.meta.env.PROD) return loadSample();

  try {
    const res = await fetch(apiUrl);
    if (res.ok) {
      const data = (await res.json()) as Omit<MERRA2PM25GridResponse, 'source'>;
      if (data.values && data.bounds) return { ...data, source: 'gesdisc' };
    }
  } catch {
    /* backend down or network error – fall through to sample */
  }
  return loadSample();
}

export { AFRICA_BBOX };
