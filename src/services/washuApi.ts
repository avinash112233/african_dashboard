export type WashUPeriod = 'monthly' | 'annual';
export type WashUSource = 'satpm' | 'sample';

const WASHU_ARCHIVE_MIN_YEAR = 1998;
const WASHU_ARCHIVE_MAX_YEAR = 2023;
const WASHU_ARCHIVE_MAX_MONTH = 12;

function clampWashuGridYearMonth(year: number, month: number | null): { year: number; month: number | null } {
  let y = Number.isFinite(year) ? Math.round(year) : WASHU_ARCHIVE_MAX_YEAR;
  if (y < WASHU_ARCHIVE_MIN_YEAR) y = WASHU_ARCHIVE_MIN_YEAR;
  if (y > WASHU_ARCHIVE_MAX_YEAR) y = WASHU_ARCHIVE_MAX_YEAR;
  if (month == null) return { year: y, month: null };
  let m = Math.max(1, Math.min(12, Math.round(month)));
  if (y === WASHU_ARCHIVE_MAX_YEAR && m > WASHU_ARCHIVE_MAX_MONTH) {
    m = WASHU_ARCHIVE_MAX_MONTH;
  }
  return { year: y, month: m };
}

function clampWashuTimeseriesRange(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): { startYear: number; startMonth: number; endYear: number; endMonth: number } {
  const start = clampWashuGridYearMonth(startYear, startMonth);
  const end = clampWashuGridYearMonth(endYear, endMonth);
  const startKey = start.year * 100 + (start.month ?? 1);
  const endKey = end.year * 100 + (end.month ?? 12);
  if (startKey <= endKey) {
    return {
      startYear: start.year,
      startMonth: start.month ?? 1,
      endYear: end.year,
      endMonth: end.month ?? 12,
    };
  }
  return {
    startYear: end.year,
    startMonth: end.month ?? 12,
    endYear: end.year,
    endMonth: end.month ?? 12,
  };
}

export interface WashUGrid {
  period: WashUPeriod;
  year: number;
  month: number | null;
  periodLabel: string;
  units: string;
  bounds: { south: number; west: number; north: number; east: number };
  width: number;
  height: number;
  noDataValue: number;
  min: number;
  max: number;
  values: number[];
  nativeResolution?: string;
  source: WashUSource;
  fallbackReason?: string;
}

export interface WashUPM25Sample {
  lat: number;
  lon: number;
  value: number;
  period: WashUPeriod;
  periodLabel: string;
  min: number;
  max: number;
  units: string;
  source: WashUSource;
}

export interface WashUTimeseriesPoint {
  period: string;
  year: number;
  month: number;
  pm25: number;
}

const DB_NAME = 'african-dashboard-washu';
const DB_VERSION = 1;
const STORE = 'grids';

const memoryCache = new Map<string, WashUGrid>();
const inflight = new Map<string, Promise<WashUGrid>>();

function buildBaseApiUrl(path: string) {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '';
  return `${base}${path}`;
}

function gridCacheKey(period: WashUPeriod, year: number, month: number | null) {
  return `${period}:${year}:${month ?? 'annual'}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function readGridFromIdb(key: string): Promise<WashUGrid | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as WashUGrid) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function writeGridToIdb(key: string, grid: WashUGrid): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(grid, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore quota / private mode */
  }
}

async function fetchGridFromApi(period: WashUPeriod, year: number, month: number | null): Promise<WashUGrid> {
  const params = new URLSearchParams({
    period,
    year: String(year),
  });
  if (period === 'monthly' && month != null) {
    params.set('month', String(month));
  }
  const url = buildBaseApiUrl(`/api/washu/pm25/grid?${params.toString()}`);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `WashU grid request failed (${res.status})`);
  }
  return res.json();
}

export async function loadWashUGrid(
  period: WashUPeriod,
  year: number,
  month: number | null
): Promise<WashUGrid> {
  const clamped = clampWashuGridYearMonth(year, period === 'monthly' ? month : null);
  const key = gridCacheKey(period, clamped.year, clamped.month);
  const cached = memoryCache.get(key);
  if (cached) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const idbHit = await readGridFromIdb(key);
    if (idbHit) {
      memoryCache.set(key, idbHit);
      return idbHit;
    }

    const grid = await fetchGridFromApi(period, clamped.year, clamped.month);
    memoryCache.set(key, grid);
    void writeGridToIdb(key, grid);
    return grid;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

export async function fetchWashUTimeseries(params: {
  lat: number;
  lon: number;
  startYear: number;
  startMonth?: number;
  endYear: number;
  endMonth?: number;
}): Promise<{ points: WashUTimeseriesPoint[]; units: string; lat: number; lon: number; monthCount?: number; pointsReturned?: number }> {
  const clamped = clampWashuTimeseriesRange(
    params.startYear,
    params.startMonth ?? 1,
    params.endYear,
    params.endMonth ?? 12
  );
  const q = new URLSearchParams({
    lat: String(params.lat),
    lon: String(params.lon),
    startYear: String(clamped.startYear),
    startMonth: String(clamped.startMonth),
    endYear: String(clamped.endYear),
    endMonth: String(clamped.endMonth),
  });
  const url = buildBaseApiUrl(`/api/washu/pm25/timeseries?${q.toString()}`);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `WashU timeseries request failed (${res.status})`);
  }
  return res.json();
}

export function washuPeriodFromDate(dateStr: string): { year: number; month: number } {
  const [y, m] = dateStr.split('-').map(Number);
  return {
    year: y && y >= 1998 && y <= 2023 ? y : 2023,
    month: m && m >= 1 && m <= 12 ? m : 12,
  };
}

export function washuStationTimeseriesBounds(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number,
  granularity: 'monthly' | 'annual' = 'monthly'
): { start: string; end: string } {
  if (granularity === 'annual') {
    return { start: `${startYear}-01-01`, end: `${endYear}-12-31` };
  }
  const sm = String(startMonth).padStart(2, '0');
  const em = String(endMonth).padStart(2, '0');
  return { start: `${startYear}-${sm}-01`, end: `${endYear}-${em}-01` };
}

export function defaultWashuStationSeriesRange(mapYear: number, mapMonth: number) {
  const anchor = clampWashuGridYearMonth(mapYear, mapMonth);
  let endYear = anchor.year;
  let endMonth = anchor.month ?? 12;
  let startYear = endYear;
  let startMonth = endMonth - 11;
  while (startMonth <= 0) {
    startMonth += 12;
    startYear -= 1;
  }
  return clampWashuTimeseriesRange(startYear, startMonth, endYear, endMonth);
}

export interface WashUStationDailyRecord {
  sitename: string;
  country: string | null;
  fullAddress: string | null;
  latitude: number;
  longitude: number;
  pm25: number;
  date: string;
  datetime: string;
  period?: string;
  periodLabel?: string;
}

export interface WashUStationTimeseriesPoint {
  period: string;
  year: number;
  month: number;
  pm25: number;
  datetime: string;
  date?: string;
}

export interface WashUStationTimeseriesResponse {
  station: {
    sitename: string;
    country?: string | null;
    fullAddress?: string | null;
    latitude?: number;
    longitude?: number;
  };
  start: string;
  end: string;
  granularity: 'monthly' | 'annual';
  points: WashUStationTimeseriesPoint[];
}

export interface WashUStationListRecord {
  sitename: string;
  country: string | null;
  fullAddress: string | null;
  latitude: number;
  longitude: number;
}

export interface WashULatestDateResponse {
  latestDate: string;
  latestPeriod?: string;
  latestDatetimeUtc: string;
  sourceFile?: string;
  coverage?: string;
}

const STATION_CACHE_TTL_MS = 30 * 60 * 1000;
type StationCacheEntry<T> = { ts: number; data: T };

const washuStationsCache = new Map<string, StationCacheEntry<WashUStationDailyRecord[]>>();
const washuStationTimeseriesCache = new Map<string, StationCacheEntry<WashUStationTimeseriesResponse>>();
let washuLatestDateCache: StationCacheEntry<WashULatestDateResponse> | null = null;

function getStationCached<T>(map: Map<string, StationCacheEntry<T>>, key: string): T | null {
  const hit = map.get(key);
  if (!hit || Date.now() - hit.ts > STATION_CACHE_TTL_MS) return null;
  return hit.data;
}

function setStationCached<T>(map: Map<string, StationCacheEntry<T>>, key: string, data: T) {
  map.set(key, { ts: Date.now(), data });
}

async function readStationJsonOrThrow<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let message = `Request failed (${res.status})`;
  try {
    const payload = (await res.json()) as { error?: string };
    if (payload?.error) message = payload.error;
  } catch {
    /* ignore */
  }
  throw new Error(message);
}

export async function getWashUStationsByDate(date: string): Promise<WashUStationDailyRecord[]> {
  const cached = getStationCached(washuStationsCache, date);
  if (cached) return cached;

  const url = buildBaseApiUrl(`/api/washu/stations?date=${encodeURIComponent(date)}`);
  const res = await fetch(url);
  const json = await readStationJsonOrThrow<{ date: string; stations: WashUStationDailyRecord[] }>(res);
  const stations = Array.isArray(json.stations) ? json.stations : [];
  setStationCached(washuStationsCache, date, stations);
  return stations;
}

export async function getWashUStationTimeseries(
  sitename: string,
  start: string,
  end: string,
  granularity: 'monthly' | 'annual' = 'monthly'
): Promise<WashUStationTimeseriesResponse> {
  const cacheKey = `${sitename}:${granularity}:${start}:${end}`;
  const cached = getStationCached(washuStationTimeseriesCache, cacheKey);
  if (cached) return cached;

  const url = buildBaseApiUrl(
    `/api/washu/station-timeseries?sitename=${encodeURIComponent(sitename)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&granularity=${granularity}`
  );
  const res = await fetch(url);
  const data = await readStationJsonOrThrow<WashUStationTimeseriesResponse>(res);
  setStationCached(washuStationTimeseriesCache, cacheKey, data);
  return data;
}

export async function getWashUStationList(): Promise<WashUStationListRecord[]> {
  const url = buildBaseApiUrl('/api/washu/station-list');
  const res = await fetch(url);
  const json = await readStationJsonOrThrow<{ stations: WashUStationListRecord[] }>(res);
  return Array.isArray(json.stations) ? json.stations : [];
}

export async function getWashULatestDate(): Promise<WashULatestDateResponse> {
  if (washuLatestDateCache && Date.now() - washuLatestDateCache.ts <= STATION_CACHE_TTL_MS) {
    return washuLatestDateCache.data;
  }
  const url = buildBaseApiUrl('/api/washu/latest-date');
  const res = await fetch(url);
  const data = await readStationJsonOrThrow<WashULatestDateResponse>(res);
  washuLatestDateCache = { ts: Date.now(), data };
  return data;
}
