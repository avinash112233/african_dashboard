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

const PROBE_TIMEOUT_MS = 15000;

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
 * Check that a forecast file exists (GET only — HEAD is unreliable through some dev proxies).
 */
export async function probeAAQEForecastExists(dateIso: string): Promise<boolean> {
  const base = getAaqeForecastBaseUrl();
  const filename = `${toYmdCompact(dateIso)}_forecast.geojson`;
  const url = `${base}${filename}`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
    if (!res.ok) return false;
    const data = (await res.json()) as AAQEGeoJSON;
    return Array.isArray(data.features) && data.features.length > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(tid);
  }
}

/**
 * Walk backward from `startIso` (inclusive) like `aeronet_aq` `nearestDate` in SiteManager / SidePanel.
 */
export async function findNearestAAQEForecastInitDate(
  startIso: string,
  maxDaysBack = 30
): Promise<{ initDate: string; wasAdjusted: boolean } | null> {
  let d = dayjs(startIso, 'YYYY-MM-DD', true);
  if (!d.isValid()) d = dayjs(startIso);
  if (!d.isValid()) return null;
  const requested = d.format('YYYY-MM-DD');
  for (let i = 0; i <= maxDaysBack; i++) {
    const iso = d.format('YYYY-MM-DD');
    if (await probeAAQEForecastExists(iso)) {
      return { initDate: iso, wasAdjusted: iso !== requested };
    }
    d = d.subtract(1, 'day');
  }
  return null;
}

export async function getAAQEForecastByDate(dateIso: string): Promise<AAQEForecastPoint[]> {
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
  return points;
}
