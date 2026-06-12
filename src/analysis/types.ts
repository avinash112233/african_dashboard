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
  anchorSource: AnalysisAnchorSource;
  aeronetQuerySite?: string;
  merra2Sitename?: string;
  merra2LinkDistanceKm?: number;
  /** True when the linked MERRA2 station exceeds the preferred colocation radius. */
  merra2LinkBeyondPreferred?: boolean;
}

export type AnalysisChartMode = 'timeseries' | 'scatter';

export interface AlignedRow {
  date: string;
  values: Record<string, number>;
}
