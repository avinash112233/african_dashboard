import dayjs from 'dayjs';

/** Same path as `aeronet_aq` `GEOJSON_AAQE` — use Vite/Express `/api/aeronet` proxy in dev and when API is routed in prod. */
const PROXY_AAQE_BASE = '/api/aeronet/data_push/AQI/output_AAQE_geoJSON/';
const DIRECT_AAQE_BASE = 'https://aeronet.gsfc.nasa.gov/data_push/AQI/output_AAQE_geoJSON/';

/**
 * Base URL for `YYYYMMDD_forecast.geojson` (must include trailing slash).
 * Set `VITE_AAQE_FORECAST_BASE_URL` to match reference app direct NASA URLs when CORS allows.
 */
export function getAaqeForecastBaseUrl(): string {
  const raw = import.meta.env.VITE_AAQE_FORECAST_BASE_URL?.trim();
  if (raw) return raw.endsWith('/') ? raw : `${raw}/`;
  if (import.meta.env.VITE_AAQE_USE_DIRECT_NASA === 'true') return DIRECT_AAQE_BASE;
  return PROXY_AAQE_BASE;
}

const TIME_CODES = ['130', '430', '730', '1030', '1330', '1630', '1930', '2230'] as const;
const TIME_NUMS = [130, 430, 730, 1030, 1330, 1630, 1930, 2230];

/** Closest 3-hourly slot to current UTC (same grid as `aeronet_aq` SidePanel `timeArr`). */
export function getDefaultAaqeTimeCodeFromUtc(now = new Date()): string {
  const t = now.getUTCHours() * 100 + now.getUTCMinutes();
  let bestI = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < TIME_NUMS.length; i++) {
    const d = Math.abs(TIME_NUMS[i] - t);
    if (d < bestDiff) {
      bestDiff = d;
      bestI = i;
    }
  }
  return TIME_CODES[bestI];
}

export interface AAQEForecastProperties {
  Station?: string;
  Site_Name?: string;
  UTC_DATE?: string;
  DAILY_AQI?: number;
  [key: string]: string | number | undefined;
}

export interface AAQEForecastPoint {
  latitude: number;
  longitude: number;
  properties: AAQEForecastProperties;
}

interface AAQEGeoJSONFeature {
  type: 'Feature';
  geometry?: {
    type?: string;
    coordinates?: [number, number];
  };
  properties?: AAQEForecastProperties;
}

interface AAQEGeoJSON {
  type: 'FeatureCollection';
  features?: AAQEGeoJSONFeature[];
}

function toYmdCompact(date: string): string {
  return date.replaceAll('-', '');
}

const PROBE_TIMEOUT_MS = 8000;

/** Module-level caches so repeated calls for the same dates are instant. */
const initDateCache = new Map<string, string | null>(); // requested → resolved initDate
const geojsonCache  = new Map<string, AAQEForecastPoint[]>(); // initDate → parsed points

function toNumber(value: string | number | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export type AaqeDisplayType = 'DAILY_AQI' | 'AQI' | 'PM';

export interface AaqeForecastDayOption {
  iso: string;
  label: string;
  dayIndex: number;
}

/** Model-init file days (init, init+1, init+2) — used internally when resolving GeoJSON. */
export function getAaqeForecastDaysFromInit(initIso: string): AaqeForecastDayOption[] {
  const base = dayjs(initIso, 'YYYY-MM-DD');
  return [0, 1, 2].map((dayIndex) => {
    const d = base.add(dayIndex, 'day');
    return {
      dayIndex,
      iso: d.format('YYYY-MM-DD'),
      label: d.format('MM/DD/YYYY'),
    };
  });
}

/** Forecast dropdown: selected date + next 2 days (3 options). Default index 1 = day after selected. */
export function getAaqeForecastDaysAfterSelected(selectedIso: string): AaqeForecastDayOption[] {
  const base = dayjs(selectedIso, 'YYYY-MM-DD');
  return [0, 1, 2].map((offset, dayIndex) => {
    const d = base.add(offset, 'day');
    return {
      dayIndex,
      iso: d.format('YYYY-MM-DD'),
      label: d.format('MM/DD/YYYY'),
    };
  });
}

/** Match NASA aqforecast / SiteManager: Daily AQI, 3-hour AQI, or PM at time slot. */
export function getAaqeDisplayValues(
  properties: AAQEForecastProperties,
  displayType: AaqeDisplayType,
  timeCode: string
): { aqi: number | null; pm: number | null; valueForColor: number | null } {
  if (displayType === 'DAILY_AQI') {
    const aqi = toNumber(properties.DAILY_AQI);
    const pm =
      toNumber(properties.PM_DAILY) ??
      toNumber(properties[`3HR_PM_CONC_CNN(${timeCode})`]);
    return { aqi, pm, valueForColor: aqi };
  }
  if (displayType === 'PM') {
    const pm = toNumber(properties[`3HR_PM_CONC_CNN(${timeCode})`]);
    const aqi = toNumber(properties[`3HR_AQI(${timeCode})`]) ?? toNumber(properties.DAILY_AQI);
    return { aqi, pm, valueForColor: pm };
  }
  const aqi = toNumber(properties[`3HR_AQI(${timeCode})`]) ?? toNumber(properties.DAILY_AQI);
  const pm = toNumber(properties[`3HR_PM_CONC_CNN(${timeCode})`]);
  return { aqi, pm, valueForColor: aqi };
}

/**
 * Lightweight probe — checks HTTP status only, discards body immediately.
 * Returns the date ISO if the file exists (200 OK), otherwise null.
 */
async function probeDate(dateIso: string): Promise<string | null> {
  const base = getAaqeForecastBaseUrl();
  const url = `${base}${toYmdCompact(dateIso)}_forecast.geojson`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    // Cancel body download immediately — we only need the status code.
    res.body?.cancel().catch(() => {});
    return res.ok ? dateIso : null;
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Find the nearest available AAQE forecast init date.
 *
 * Strategy (fast):
 *   1. Check module-level cache (instant if same date requested before).
 *   2. Probe today + yesterday IN PARALLEL (covers >99% of cases, ~1 round-trip).
 *   3. Fall back to sequential probe up to `maxDaysBack` days.
 */
export async function findNearestAAQEForecastInitDate(
  startIso: string,
  maxDaysBack = 7
): Promise<{ initDate: string; wasAdjusted: boolean } | null> {
  let d = dayjs(startIso, 'YYYY-MM-DD', true);
  if (!d.isValid()) d = dayjs(startIso);
  if (!d.isValid()) return null;
  const requested = d.format('YYYY-MM-DD');

  if (initDateCache.has(requested)) {
    const cached = initDateCache.get(requested)!;
    return cached ? { initDate: cached, wasAdjusted: cached !== requested } : null;
  }

  // Phase 1: probe today and yesterday in parallel.
  const candidates = [d.format('YYYY-MM-DD'), d.subtract(1, 'day').format('YYYY-MM-DD')];
  const [r0, r1] = await Promise.all(candidates.map(probeDate));
  const fast = r0 ?? r1 ?? null;
  if (fast) {
    initDateCache.set(requested, fast);
    return { initDate: fast, wasAdjusted: fast !== requested };
  }

  // Phase 2: sequential fallback for older dates.
  d = d.subtract(2, 'day');
  for (let i = 2; i <= maxDaysBack; i++) {
    const iso = d.format('YYYY-MM-DD');
    const found = await probeDate(iso);
    if (found) {
      initDateCache.set(requested, found);
      return { initDate: found, wasAdjusted: true };
    }
    d = d.subtract(1, 'day');
  }

  initDateCache.set(requested, null);
  return null;
}

export async function getAAQEForecastByDate(dateIso: string): Promise<AAQEForecastPoint[]> {
  if (geojsonCache.has(dateIso)) return geojsonCache.get(dateIso)!;

  const base = getAaqeForecastBaseUrl();
  const filename = `${toYmdCompact(dateIso)}_forecast.geojson`;
  const res = await fetch(`${base}${filename}`);
  if (!res.ok) {
    throw new Error(`AAQE forecast unavailable for ${dateIso} (${res.status}).`);
  }
  const data = (await res.json()) as AAQEGeoJSON;
  const features = Array.isArray(data.features) ? data.features : [];

  const points: AAQEForecastPoint[] = [];
  for (const f of features) {
    const lon = f.geometry?.coordinates?.[0];
    const lat = f.geometry?.coordinates?.[1];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    points.push({
      latitude: lat as number,
      longitude: lon as number,
      properties: f.properties ?? {},
    });
  }

  geojsonCache.set(dateIso, points);
  return points;
}
