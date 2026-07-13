export type OpenAqMapMode = 'daily' | 'latest';
export type OpenAqSeriesResolution = 'daily' | 'monthly' | 'yearly';

export interface OpenAqLocationRecord {
  locationId: number;
  sensorId: number;
  name: string;
  locality: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  isMonitor: boolean;
  provider: string | null;
  datetimeLast?: string | null;
}

export interface OpenAqStationRecord extends OpenAqLocationRecord {
  pm25: number | null;
  datetime: string;
  mode: OpenAqMapMode;
  hasReading?: boolean;
}

export interface OpenAqStationsResponse {
  date: string;
  mode: OpenAqMapMode;
  monitorsOnly: boolean;
  count: number;
  totalLocations?: number;
  withReadingCount?: number;
  /** True while the server is still filling recent dates from live hourly data. */
  enrichmentPending?: boolean;
  stations: OpenAqStationRecord[];
}

export interface OpenAqTimeseriesPoint {
  date: string;
  datetime: string;
  pm25: number;
}

export interface OpenAqTimeseriesResponse {
  sensorId: number;
  start: string;
  end: string;
  resolution: OpenAqSeriesResolution;
  points: OpenAqTimeseriesPoint[];
  /** Where the points came from: the free S3 historical archive, the live API, or a blend at the boundary. */
  source?: 'archive' | 'live' | 'archive+live' | string;
}

export interface OpenAqTimeseriesOptions {
  locationId?: number;
  signal?: AbortSignal;
}

export interface OpenAqArchiveInfo {
  bucket: string;
  lagDays: number;
  cutoffDate: string;
  usesApiKey: boolean;
  note?: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000;
const SERIES_FETCH_TIMEOUT_MS = 35_000;
const LOCATIONS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ARCHIVE_INFO_CACHE_TTL_MS = 60 * 60 * 1000;
type CacheEntry<T> = { ts: number; data: T; enrichmentPending?: boolean };
const stationsCache = new Map<string, CacheEntry<OpenAqStationRecord[]>>();
const locationsCache = new Map<string, CacheEntry<OpenAqLocationRecord[]>>();
const seriesCache = new Map<string, CacheEntry<OpenAqTimeseriesResponse>>();
const inflight = new Map<string, Promise<unknown>>();
let archiveInfoCache: CacheEntry<OpenAqArchiveInfo> | null = null;
let historicalPrefetchPromise: Promise<string | null> | null = null;

function buildBaseApiUrl(path: string) {
  const base = import.meta.env.BASE_URL ?? '/';
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${normalizedBase}${path.startsWith('/') ? path : `/${path}`}`;
}

function getCached<T>(map: Map<string, CacheEntry<T>>, key: string, ttl: number): T | null {
  const hit = map.get(key);
  if (!hit || Date.now() - hit.ts > ttl) return null;
  return hit.data;
}

function setCached<T>(
  map: Map<string, CacheEntry<T>>,
  key: string,
  data: T,
  enrichmentPending = false
) {
  map.set(key, { ts: Date.now(), data, enrichmentPending });
}

async function readJsonOrThrow<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((json as { error?: string }).error || `Request failed (${res.status})`);
  }
  return json as T;
}

async function fetchDeduped<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const promise = fetcher().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** Latest date guaranteed to be in the OpenAQ S3 historical archive (~today − lagDays). */
export async function getOpenAqArchiveInfo(): Promise<OpenAqArchiveInfo> {
  if (archiveInfoCache && Date.now() - archiveInfoCache.ts <= ARCHIVE_INFO_CACHE_TTL_MS) {
    return archiveInfoCache.data;
  }
  return fetchDeduped('openaq-archive-info', async () => {
    const url = buildBaseApiUrl('/api/openaq/archive-info');
    const res = await fetch(url);
    const data = await readJsonOrThrow<OpenAqArchiveInfo>(res);
    archiveInfoCache = { ts: Date.now(), data };
    return data;
  });
}

/** Peek in-memory station cache without triggering a network request. */
export function peekOpenAqStations(
  date: string,
  mode: OpenAqMapMode,
  monitorsOnly = false
): OpenAqStationRecord[] | null {
  return getCached(stationsCache, `${date}:${mode}:${monitorsOnly ? '1' : '0'}`, CACHE_TTL_MS);
}

/**
 * Warm locations + daily stations for the latest archive date as soon as the dashboard opens,
 * so switching to Historical OpenAQ can render from cache.
 * Returns the archive cutoff date used for the prefetch (or null on failure).
 */
export function prefetchOpenAqHistorical(monitorsOnly = false): Promise<string | null> {
  if (historicalPrefetchPromise) return historicalPrefetchPromise;

  historicalPrefetchPromise = (async () => {
    try {
      const info = await getOpenAqArchiveInfo();
      const date = info.cutoffDate;
      await Promise.all([
        getOpenAqLocations(monitorsOnly),
        getOpenAqStations(date, 'daily', monitorsOnly),
      ]);
      // Keep warming enrichment in the background without blocking.
      refreshOpenAqStationsInBackground(date, 'daily', monitorsOnly, () => {});
      return date;
    } catch {
      historicalPrefetchPromise = null; // allow quick retry on failure
      return null;
    }
  })();

  return historicalPrefetchPromise;
}

/** Warm NRT latest stations on dashboard open so the layer switch is instant. */
export function prefetchOpenAqNrt(monitorsOnly = false, date = new Date().toISOString().slice(0, 10)): Promise<void> {
  return fetchDeduped(`openaq-prefetch-nrt:${date}:${monitorsOnly ? '1' : '0'}`, async () => {
    await Promise.all([
      getOpenAqLocations(monitorsOnly),
      getOpenAqStations(date, 'latest', monitorsOnly),
    ]);
    refreshOpenAqStationsInBackground(date, 'latest', monitorsOnly, () => {});
  });
}

/** Fast metadata-only station list (map positions appear immediately). */
export async function getOpenAqLocations(monitorsOnly = false): Promise<OpenAqLocationRecord[]> {
  const cacheKey = monitorsOnly ? '1' : '0';
  const cached = getCached(locationsCache, cacheKey, LOCATIONS_CACHE_TTL_MS);
  if (cached) return cached;

  return fetchDeduped(`openaq-locations:${cacheKey}`, async () => {
    const params = new URLSearchParams({ monitorsOnly: monitorsOnly ? '1' : '0' });
    const url = buildBaseApiUrl(`/api/openaq/locations?${params.toString()}`);
    const res = await fetch(url);
    const json = await readJsonOrThrow<{ locations: OpenAqLocationRecord[] }>(res);
    const locations = Array.isArray(json.locations) ? json.locations : [];
    setCached(locationsCache, cacheKey, locations);
    return locations;
  });
}

async function fetchOpenAqStationsResponse(
  date: string,
  mode: OpenAqMapMode,
  monitorsOnly: boolean
): Promise<OpenAqStationsResponse> {
  const params = new URLSearchParams({
    date,
    mode,
    monitorsOnly: monitorsOnly ? '1' : '0',
    // Bust any intermediate HTTP caches while the server fills archive colors.
    _: String(Date.now()),
  });
  const url = buildBaseApiUrl(`/api/openaq/stations?${params.toString()}`);
  const res = await fetch(url, { cache: 'no-store' });
  return readJsonOrThrow<OpenAqStationsResponse>(res);
}

function countStationsWithPm25(stations: OpenAqStationRecord[]): number {
  return stations.filter((s) => s.pm25 != null && Number.isFinite(s.pm25)).length;
}

/**
 * Map stations for daily (historical) or latest (NRT).
 * Never lock onto an empty skeleton — wait briefly / poll until readings arrive.
 */
export async function getOpenAqStations(
  date: string,
  mode: OpenAqMapMode = 'latest',
  monitorsOnly = false
): Promise<OpenAqStationRecord[]> {
  const cacheKey = `${date}:${mode}:${monitorsOnly ? '1' : '0'}`;
  const hit = stationsCache.get(cacheKey);
  const cached =
    hit && Date.now() - hit.ts <= CACHE_TTL_MS ? hit : null;

  // Reuse only a finished snapshot with readings.
  if (
    cached &&
    countStationsWithPm25(cached.data) > 0 &&
    cached.enrichmentPending === false
  ) {
    return cached.data;
  }

  return fetchDeduped(`openaq-stations:${cacheKey}`, async () => {
    // Wait briefly for colors (archive fill or NRT warm/bulk latest).
    const maxAttempts = 8;
    let stations: OpenAqStationRecord[] = [];
    let enrichmentPending = false;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const json = await fetchOpenAqStationsResponse(date, mode, monitorsOnly);
      stations = Array.isArray(json.stations) ? json.stations : [];
      enrichmentPending = Boolean(json.enrichmentPending);
      const withReadings = countStationsWithPm25(stations);
      if (withReadings > 0 || !enrichmentPending) break;
      await new Promise((r) => setTimeout(r, 400));
    }

    const withReadings = countStationsWithPm25(stations);
    if (stations.length > 0 && withReadings > 0) {
      setCached(stationsCache, cacheKey, stations, enrichmentPending);
    }
    return stations;
  });
}

/** Background refresh while server fills readings — daily archive or NRT latest. */
export function refreshOpenAqStationsInBackground(
  date: string,
  mode: OpenAqMapMode,
  monitorsOnly: boolean,
  onUpdate: (stations: OpenAqStationRecord[]) => void,
  maxPolls = 90,
  intervalMs = 700
): () => void {
  let cancelled = false;
  let polls = 0;
  let bestWithReadings = countStationsWithPm25(
    peekOpenAqStations(date, mode, monitorsOnly) ?? []
  );

  const poll = async () => {
    if (cancelled || polls >= maxPolls) return;
    polls += 1;
    try {
      const json = await fetchOpenAqStationsResponse(date, mode, monitorsOnly);
      const stations = Array.isArray(json.stations) ? json.stations : [];
      const withReadings = countStationsWithPm25(stations);
      if (withReadings > bestWithReadings) {
        bestWithReadings = withReadings;
        const cacheKey = `${date}:${mode}:${monitorsOnly ? '1' : '0'}`;
        setCached(stationsCache, cacheKey, stations, Boolean(json.enrichmentPending));
        if (!cancelled) onUpdate(stations);
      } else if (!json.enrichmentPending && withReadings > 0 && !cancelled) {
        const cacheKey = `${date}:${mode}:${monitorsOnly ? '1' : '0'}`;
        setCached(stationsCache, cacheKey, stations, false);
        onUpdate(stations);
      }
      // Keep polling while pending OR while we still have zero colors (warm may still be filling).
      if (!json.enrichmentPending && withReadings > 0) return;
      if (!json.enrichmentPending && withReadings === 0 && polls >= 8) return;
    } catch {
      /* ignore background poll errors */
    }
    if (!cancelled && polls < maxPolls) {
      const delay = polls < 20 ? intervalMs : intervalMs * 2;
      setTimeout(poll, delay);
    }
  };

  setTimeout(poll, 200);
  return () => {
    cancelled = true;
  };
}

export async function getOpenAqStationDay(
  sensorId: number,
  date: string
): Promise<OpenAqStationRecord> {
  const params = new URLSearchParams({
    sensorId: String(sensorId),
    date,
  });
  const url = buildBaseApiUrl(`/api/openaq/station-day?${params.toString()}`);
  const res = await fetch(url);
  return readJsonOrThrow<OpenAqStationRecord>(res);
}

export async function getOpenAqTimeseries(
  sensorId: number,
  start: string,
  end: string,
  resolution: OpenAqSeriesResolution = 'daily',
  options: OpenAqTimeseriesOptions = {}
): Promise<OpenAqTimeseriesResponse> {
  const cacheKey = `${sensorId}:${start}:${end}:${resolution}`;
  const cached = getCached(seriesCache, cacheKey, CACHE_TTL_MS);
  if (cached) return cached;

  return fetchDeduped(`openaq-series:${cacheKey}`, async () => {
    const params = new URLSearchParams({
      sensorId: String(sensorId),
      start,
      end,
      resolution,
    });
    if (options.locationId != null) {
      params.set('locationId', String(options.locationId));
    }
    const url = buildBaseApiUrl(`/api/openaq/timeseries?${params.toString()}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SERIES_FETCH_TIMEOUT_MS);
    const external = options.signal;
    const onAbort = () => controller.abort();
    external?.addEventListener('abort', onAbort);
    try {
      const res = await fetch(url, { signal: controller.signal });
      const data = await readJsonOrThrow<OpenAqTimeseriesResponse>(res);
      setCached(seriesCache, cacheKey, data);
      return data;
    } finally {
      clearTimeout(timeout);
      external?.removeEventListener('abort', onAbort);
    }
  });
}

export function seedOpenAqTimeseriesFromStation(
  station: OpenAqStationRecord,
  mapDate?: string
): OpenAqTimeseriesPoint[] {
  if (!hasOpenAqPm25Value(station)) return [];
  const date = mapDate || station.datetime?.slice(0, 10) || '';
  if (!date) return [];
  return [
    {
      date,
      datetime: station.datetime || `${date}T12:00:00Z`,
      pm25: station.pm25!,
    },
  ];
}

export function hasOpenAqPm25Value(station: OpenAqStationRecord): boolean {
  return station.pm25 != null && Number.isFinite(station.pm25);
}

export function mergeOpenAqStationValues(
  locations: OpenAqLocationRecord[],
  withValues: OpenAqStationRecord[],
  mode: OpenAqMapMode
): OpenAqStationRecord[] {
  if (withValues.length >= locations.length) {
    return withValues;
  }
  const bySensor = new Map(withValues.map((s) => [s.sensorId, s]));
  return locations.map((loc) => {
    const hit = bySensor.get(loc.sensorId);
    if (hit) return hit;
    return {
      ...loc,
      pm25: null,
      datetime: mode === 'daily' ? '' : (loc.datetimeLast ?? ''),
      mode,
      hasReading: false,
    };
  });
}

export function skeletonStationsFromLocations(
  locations: OpenAqLocationRecord[],
  mode: OpenAqMapMode
): OpenAqStationRecord[] {
  return locations.map((loc) => ({
    ...loc,
    pm25: null,
    datetime: mode === 'daily' ? '' : (loc.datetimeLast ?? ''),
    mode,
    hasReading: false,
  }));
}
