export type AnalysisDataSource = 'aeronet' | 'merra2' | 'aaqe' | 'firms';

export type AnalysisVariableId =
  | 'aeronet_aod_500'
  | 'aeronet_aod_675'
  | 'merra2_pm25'
  | 'merra2_aqi';

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
  aeronetQuerySite?: string;
  merra2Sitename?: string;
}

export type AnalysisChartMode = 'timeseries' | 'scatter';

export interface AlignedRow {
  date: string;
  values: Record<string, number>;
}
