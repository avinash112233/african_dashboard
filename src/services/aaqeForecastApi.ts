import dayjs from 'dayjs';

// AAQE GeoJSON lives under the same aeronet.gsfc.nasa.gov domain as AERONET.
// Use the Vite/Express /api/aeronet proxy in dev and production; or set env vars below.
const PROXY_AAQE_BASE  = '/api/aeronet/data_push/AQI/output_AAQE_geoJSON/';
const DIRECT_AAQE_BASE = 'https://aeronet.gsfc.nasa.gov/data_push/AQI/output_AAQE_geoJSON/';

export function getAaqeForecastBaseUrl(): string {
  const raw = import.meta.env.VITE_AAQE_FORECAST_BASE_URL?.trim();
  if (raw) return raw.endsWith('/') ? raw : `${raw}/`;
  if (import.meta.env.VITE_AAQE_USE_DIRECT_NASA === 'true') return DIRECT_AAQE_BASE;
  return PROXY_AAQE_BASE;
}

const TIME_CODES = ['130', '430', '730', '1030', '1330', '1630', '1930', '2230'] as const;
const TIME_NUMS  = [130, 430, 730, 1030, 1330, 1630, 1930, 2230];

/** Returns the 3-hourly UTC slot (same grid as aeronet_aq SidePanel timeArr) closest to now. */
export function getDefaultAaqeTimeCodeFromUtc(now = new Date()): string {
  const t = now.getUTCHours() * 100 + now.getUTCMinutes();
  let bestI = 0, bestDiff = Infinity;
  for (let i = 0; i < TIME_NUMS.length; i++) {
    const d = Math.abs(TIME_NUMS[i] - t);
    if (d < bestDiff) { bestDiff = d; bestI = i; }
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
  geometry?: { type?: string; coordinates?: [number, number] };
  properties?: AAQEForecastProperties;
}

interface AAQEGeoJSON {
  type: 'FeatureCollection';
  features?: AAQEGeoJSONFeature[];
}

function toYmdCompact(date: string): string {
  return date.replaceAll('-', '');
}

/** Normalize AAQE UTC_DATE (ISO, YYYYMMDD string, or numeric) to YYYY-MM-DD. */
export function normalizeAaqeUtcDate(value: string | number | undefined): string | null {
  if (value == null || value === '') return null;
  const v = String(value).trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  const d = dayjs(v.slice(0, 10), 'YYYY-MM-DD', true);
  return d.isValid() ? d.format('YYYY-MM-DD') : null;
}

export function filterAaqePointsByUtcDate(
  points: AAQEForecastPoint[],
  targetIso: string
): AAQEForecastPoint[] {
  return points.filter(
    (p) => normalizeAaqeUtcDate(p.properties.UTC_DATE) === targetIso
  );
}

const PROBE_TIMEOUT_MS = 8000;

// Module-level caches — repeated calls for the same dates are instant.
const initDateCache = new Map<string, string | null>();      // requested → resolved initDate
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

/** Days covered by a model run: init, init+1, init+2. */
export function getAaqeForecastDaysFromInit(initIso: string): AaqeForecastDayOption[] {
  const base = dayjs(initIso, 'YYYY-MM-DD');
  return [0, 1, 2].map((dayIndex) => {
    const d = base.add(dayIndex, 'day');
    return { dayIndex, iso: d.format('YYYY-MM-DD'), label: d.format('MM/DD/YYYY') };
  });
}

/** Forecast day options shown in the UI: selected date + next 2 days. */
export function getAaqeForecastDaysAfterSelected(selectedIso: string): AaqeForecastDayOption[] {
  const base = dayjs(selectedIso, 'YYYY-MM-DD');
  return [0, 1, 2].map((offset, dayIndex) => {
    const d = base.add(offset, 'day');
    return { dayIndex, iso: d.format('YYYY-MM-DD'), label: d.format('MM/DD/YYYY') };
  });
}

/** Returns AQI and PM values for a given display mode and time slot (mirrors NASA aqforecast logic). */
export function getAaqeDisplayValues(
  properties: AAQEForecastProperties,
  displayType: AaqeDisplayType,
  timeCode: string
): { aqi: number | null; pm: number | null; valueForColor: number | null } {
  if (displayType === 'DAILY_AQI') {
    const aqi = toNumber(properties.DAILY_AQI);
    const pm  = toNumber(properties.PM_DAILY) ?? toNumber(properties[`3HR_PM_CONC_CNN(${timeCode})`]);
    return { aqi, pm, valueForColor: aqi };
  }
  if (displayType === 'PM') {
    const pm  = toNumber(properties[`3HR_PM_CONC_CNN(${timeCode})`]);
    const aqi = toNumber(properties[`3HR_AQI(${timeCode})`]) ?? toNumber(properties.DAILY_AQI);
    return { aqi, pm, valueForColor: pm };
  }
  const aqi = toNumber(properties[`3HR_AQI(${timeCode})`]) ?? toNumber(properties.DAILY_AQI);
  const pm  = toNumber(properties[`3HR_PM_CONC_CNN(${timeCode})`]);
  return { aqi, pm, valueForColor: aqi };
}

// HEAD-like check: fetch, read only status, cancel body immediately.
async function probeDate(dateIso: string): Promise<string | null> {
  const url = `${getAaqeForecastBaseUrl()}${toYmdCompact(dateIso)}_forecast.geojson`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    res.body?.cancel().catch(() => {});
    return res.ok ? dateIso : null;
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Finds the nearest available AAQE forecast init date.
 * Phase 1: probe today + yesterday in parallel (covers >99% of cases).
 * Phase 2: sequential fallback up to maxDaysBack.
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

  const [r0, r1] = await Promise.all([
    probeDate(d.format('YYYY-MM-DD')),
    probeDate(d.subtract(1, 'day').format('YYYY-MM-DD')),
  ]);
  const fast = r0 ?? r1 ?? null;
  if (fast) {
    initDateCache.set(requested, fast);
    return { initDate: fast, wasAdjusted: fast !== requested };
  }

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

  const filename = `${toYmdCompact(dateIso)}_forecast.geojson`;
  const res = await fetch(`${getAaqeForecastBaseUrl()}${filename}`);
  if (!res.ok) throw new Error(`AAQE forecast unavailable for ${dateIso} (${res.status}).`);

  const data = (await res.json()) as AAQEGeoJSON;
  const points: AAQEForecastPoint[] = [];
  for (const f of data.features ?? []) {
    const lon = f.geometry?.coordinates?.[0];
    const lat = f.geometry?.coordinates?.[1];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    points.push({ latitude: lat as number, longitude: lon as number, properties: f.properties ?? {} });
  }

  geojsonCache.set(dateIso, points);
  return points;
}
