/**
 * MERRA2_CNN_HAQAST_PM25 – bias-corrected global hourly surface PM2.5
 * Fetches global grid via /api/merra2/pm25/grid backend (proxied to GES DISC OPeNDAP or sample)
 * Dataset: https://www.earthdata.nasa.gov/data/catalog/ges-disc-merra2-cnn-haqast-pm25-1
 * Coverage: 2000-01-01 to 2024-12-31
 */

/** Global bounds for MERRA2 grid */
const GLOBAL_BBOX = { latMin: -90, latMax: 90, lonMin: -180, lonMax: 180 };
const GLOBAL_WIDTH = 576;
const GLOBAL_HEIGHT = 361;

function buildGlobalFallbackGrid(date: string, fallbackReason: string = 'frontend_fallback'): MERRA2PM25GridResponse {
  const values: number[] = [];
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let row = 0; row < GLOBAL_HEIGHT; row++) {
    const lat = GLOBAL_BBOX.latMax - (row / (GLOBAL_HEIGHT - 1)) * (GLOBAL_BBOX.latMax - GLOBAL_BBOX.latMin);
    for (let col = 0; col < GLOBAL_WIDTH; col++) {
      const lon = GLOBAL_BBOX.lonMin + (col / (GLOBAL_WIDTH - 1)) * (GLOBAL_BBOX.lonMax - GLOBAL_BBOX.lonMin);

      // Synthetic-but-plausible global PM2.5 hotspots so fallback looks like a real heatmap.
      const tropics = Math.exp(-Math.pow(lat / 28, 2));
      const southAsia = Math.exp(-Math.pow((lon - 80) / 30, 2)) * Math.exp(-Math.pow((lat - 24) / 10, 2));
      const westAfrica = Math.exp(-Math.pow((lon - 10) / 25, 2)) * Math.exp(-Math.pow((lat - 8) / 14, 2));
      const eastChina = Math.exp(-Math.pow((lon - 112) / 18, 2)) * Math.exp(-Math.pow((lat - 33) / 10, 2));
      const biomassBelt = Math.exp(-Math.pow((lat + 5) / 16, 2)) * Math.exp(-Math.pow((lon + 55) / 70, 2));
      const baseline = 4 + 7 * tropics + 2 * Math.cos((lat + lon) * 0.05);

      let v =
        baseline +
        55 * southAsia +
        28 * westAfrica +
        30 * eastChina +
        20 * biomassBelt;

      v = Math.max(1, Math.min(115, v));
      v = Math.round(v * 10) / 10;
      values.push(v);
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  return {
    date,
    units: 'µg/m³',
    bounds: {
      south: GLOBAL_BBOX.latMin,
      west: GLOBAL_BBOX.lonMin,
      north: GLOBAL_BBOX.latMax,
      east: GLOBAL_BBOX.lonMax,
    },
    width: GLOBAL_WIDTH,
    height: GLOBAL_HEIGHT,
    noDataValue: -9999,
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 100,
    values,
    source: 'sample',
    fallbackReason,
  };
}

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
  /** Optional detail when source=sample (e.g. auth failure, network error) */
  fallbackReason?: string;
}

/**
 * Fetch MERRA2 PM2.5 global grid (canvas overlay format).
 * Returns bounds, dimensions, and flattened values array (row-major).
 * In dev: tries backend (npm run api); falls back to sample if backend down or date out of range.
 * In prod: always uses sample data (no backend available on static hosts).
 */
export async function getMERRA2PM25Grid(date: string): Promise<MERRA2PM25GridResponse> {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '';
  const apiUrl = `${base}/api/merra2/pm25/grid?date=${encodeURIComponent(date)}`;
  const loadSample = async (): Promise<MERRA2PM25GridResponse> => {
    return buildGlobalFallbackGrid(date, 'frontend_backend_unreachable');
  };

  if (import.meta.env.PROD) return loadSample();

  try {
    const res = await fetch(apiUrl);
    if (res.ok) {
      const data = (await res.json()) as Partial<MERRA2PM25GridResponse>;
      if (data.values && data.bounds) {
        const source = data.source === 'gesdisc' || data.source === 'sample' ? data.source : 'gesdisc';
        return { ...(data as Omit<MERRA2PM25GridResponse, 'source'>), source };
      }
    }
  } catch {
    /* backend down or network error – fall through to sample */
  }
  return loadSample();
}

export { GLOBAL_BBOX };
