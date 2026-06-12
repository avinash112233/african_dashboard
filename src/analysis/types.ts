export type AnalysisDataSource = 'aeronet' | 'merra2' | 'aaqe' | 'firms';

export type AnalysisAnchorSource = 'aeronet' | 'merra2' | 'aaqe' | 'fire';

export type AnalysisVariableId =
  | 'aeronet_aod_500'
  | 'aeronet_aod_675'
  | 'merra2_pm25'
  | 'merra2_aqi'
  | 'aaqe_pm25'
  | 'fire_count';

export interface NormalizedPoint {
  time: string;
  value: number;
}

export interface NormalizedSeries {
  id: string;
  source: AnalysisDataSource;
  variable: AnalysisVariableId;
  label: string;
  unit: string;
  points: NormalizedPoint[];
  error?: string;
}

export interface AnalysisLocationContext {
  label: string;
  latitude: number;
  longitude: number;
  /** How this anchor was set (map click / sidebar). */
  anchorSource: AnalysisAnchorSource;
  aeronetQuerySite?: string;
  merra2Sitename?: string;
  /** Distance from anchor to linked MERRA2 station (km), when resolved. */
  merra2LinkDistanceKm?: number;
  /** True when the linked station is beyond the preferred colocation radius. */
  merra2LinkBeyondPreferred?: boolean;
}

export type AnalysisChartMode = 'timeseries' | 'scatter';

export interface AlignedRow {
  date: string;
  values: Record<string, number>;
}
