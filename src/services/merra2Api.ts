export interface MERRA2StationDailyRecord {
  sitename: string;
  country: string | null;
  fullAddress: string | null;
  latitude: number;
  longitude: number;
  pm25: number;
  date: string;
  datetime: string;
}

export interface MERRA2StationTimeseriesPoint {
  date?: string;
  datetime: string;
  pm25: number;
}

export interface MERRA2StationTimeseriesResponse {
  station: {
    sitename: string;
    country?: string | null;
    fullAddress?: string | null;
    latitude?: number;
    longitude?: number;
  };
  start: string;
  end: string;
  points: MERRA2StationTimeseriesPoint[];
}

export interface MERRA2StationListRecord {
  sitename: string;
  country: string | null;
  fullAddress: string | null;
  latitude: number;
  longitude: number;
}

export interface MERRA2LatestDateResponse {
  latestDate: string;
  latestDatetimeUtc: string;
  sourceFile?: string;
}

export interface MERRA2StationsByDateResponse {
  date: string;
  requestedDate?: string;
  clamped?: boolean;
  stations: MERRA2StationDailyRecord[];
}

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
  source: 'gesdisc' | 'sample';
  fallbackReason?: string;
}

const CACHE_TTL_MS = 30 * 60 * 1000;

type CacheEntry<T> = { ts: number; data: T };

function getCached<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = map.get(key);
  if (!hit || Date.now() - hit.ts > CACHE_TTL_MS) return null;
  return hit.data;
}

function setCached<T>(map: Map<string, CacheEntry<T>>, key: string, data: T) {
  map.set(key, { ts: Date.now(), data });
}

import {
  clampIsoDateRangeToMerra2Archive,
  clampIsoDateToMerra2Archive,
} from '../dashboardV2/merra2PlotRange';

const stationsCache = new Map<string, CacheEntry<MERRA2StationDailyRecord[]>>();
const gridCache = new Map<string, CacheEntry<MERRA2PM25GridResponse>>();
const timeseriesCache = new Map<string, CacheEntry<MERRA2StationTimeseriesResponse>>();
let latestDateCache: CacheEntry<MERRA2LatestDateResponse> | null = null;
let cachedLatestArchiveDate: string | null = null;

const inflight = new Map<string, Promise<unknown>>();

function clampMerra2Date(date: string): string {
  return clampIsoDateToMerra2Archive(date, cachedLatestArchiveDate);
}

function clampMerra2Range(start: string, end: string): { start: string; end: string } {
  return clampIsoDateRangeToMerra2Archive(start, end, cachedLatestArchiveDate);
}

function buildBaseApiUrl(path: string) {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '';
  return `${base}${path}`;
}

async function readJsonOrThrow<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let message = `Request failed (${res.status})`;
  try {
    const payload = (await res.json()) as { error?: string };
    if (payload?.error) message = payload.error;
  } catch {
    // fallback to generic message
  }
  throw new Error(message);
}

async function fetchDeduped<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fetcher().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

/** Get one PM2.5 daily value per station for selected UTC date. */
export async function getMERRA2StationsByDate(date: string): Promise<MERRA2StationDailyRecord[]> {
  const clampedDate = clampMerra2Date(date);
  const cached = getCached(stationsCache, clampedDate);
  if (cached) return cached;

  return fetchDeduped(`stations:${clampedDate}`, async () => {
    const url = buildBaseApiUrl(`/api/merra2/stations?date=${encodeURIComponent(clampedDate)}`);
    const res = await fetch(url);
    const json = await readJsonOrThrow<MERRA2StationsByDateResponse>(res);
    const stations = Array.isArray(json.stations) ? json.stations : [];
    if (json.date) setCached(stationsCache, json.date, stations);
    else setCached(stationsCache, clampedDate, stations);
    return stations;
  });
}

/** Get station hourly PM2.5 series over requested date range. */
export async function getMERRA2StationTimeseries(
  sitename: string,
  start: string,
  end: string
): Promise<MERRA2StationTimeseriesResponse> {
  const { start: clampedStart, end: clampedEnd } = clampMerra2Range(start, end);
  const cacheKey = `${sitename}:${clampedStart}:${clampedEnd}`;
  const cached = getCached(timeseriesCache, cacheKey);
  if (cached) return cached;

  return fetchDeduped(`timeseries:${cacheKey}`, async () => {
    const url = buildBaseApiUrl(
      `/api/merra2/station-timeseries?sitename=${encodeURIComponent(sitename)}&start=${encodeURIComponent(clampedStart)}&end=${encodeURIComponent(clampedEnd)}`
    );
    const res = await fetch(url);
    const data = await readJsonOrThrow<MERRA2StationTimeseriesResponse>(res);
    setCached(timeseriesCache, cacheKey, data);
    return data;
  });
}

/** Optional station catalog endpoint for search/dropdowns. */
export async function getMERRA2StationList(): Promise<MERRA2StationListRecord[]> {
  const url = buildBaseApiUrl('/api/merra2/station-list');
  const res = await fetch(url);
  const json = await readJsonOrThrow<{ stations: MERRA2StationListRecord[] }>(res);
  return Array.isArray(json.stations) ? json.stations : [];
}

/** Get latest available parquet date for station data fallback. */
export async function getMERRA2LatestDate(): Promise<MERRA2LatestDateResponse> {
  if (latestDateCache && Date.now() - latestDateCache.ts <= CACHE_TTL_MS) {
    return latestDateCache.data;
  }

  return fetchDeduped('latest-date', async () => {
    const url = buildBaseApiUrl('/api/merra2/latest-date');
    const res = await fetch(url);
    const data = await readJsonOrThrow<MERRA2LatestDateResponse>(res);
    cachedLatestArchiveDate = data.latestDate ?? null;
    latestDateCache = { ts: Date.now(), data };
    return data;
  });
}

/** CNN PM2.5 grid from GES DISC OPeNDAP (MERRA2_CNN_HAQAST_PM25). */
export async function getMERRA2PM25Grid(date: string): Promise<MERRA2PM25GridResponse> {
  const clampedDate = clampMerra2Date(date);
  const cached = getCached(gridCache, clampedDate);
  if (cached) return cached;

  return fetchDeduped(`grid:${clampedDate}`, async () => {
    const url = buildBaseApiUrl(`/api/merra2/pm25/grid?date=${encodeURIComponent(clampedDate)}`);
    const res = await fetch(url);
    const data = await readJsonOrThrow<MERRA2PM25GridResponse>(res);
    setCached(gridCache, clampedDate, data);
    return data;
  });
}
