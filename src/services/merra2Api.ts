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

/** Get one PM2.5 daily value per station for selected UTC date. */
export async function getMERRA2StationsByDate(date: string): Promise<MERRA2StationDailyRecord[]> {
  const url = buildBaseApiUrl(`/api/merra2/stations?date=${encodeURIComponent(date)}`);
  const res = await fetch(url);
  const json = await readJsonOrThrow<{ date: string; stations: MERRA2StationDailyRecord[] }>(res);
  return Array.isArray(json.stations) ? json.stations : [];
}

/** Get station hourly PM2.5 series over requested date range. */
export async function getMERRA2StationTimeseries(
  sitename: string,
  start: string,
  end: string
): Promise<MERRA2StationTimeseriesResponse> {
  const url = buildBaseApiUrl(
    `/api/merra2/station-timeseries?sitename=${encodeURIComponent(sitename)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
  );
  const res = await fetch(url);
  return readJsonOrThrow<MERRA2StationTimeseriesResponse>(res);
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
  const url = buildBaseApiUrl('/api/merra2/latest-date');
  const res = await fetch(url);
  return readJsonOrThrow<MERRA2LatestDateResponse>(res);
}

// Legacy grid API contract kept only for backward-compatibility with unused heatmap component.
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

/** @deprecated Parquet station workflow replaced this grid route for active UI usage. */
export async function getMERRA2PM25Grid(_date: string): Promise<MERRA2PM25GridResponse> {
  throw new Error('MERRA2 grid heatmap is deprecated. Use station endpoints instead.');
}
