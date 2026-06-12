import type { AnalysisDataSource, AnalysisVariableId } from './types';

export interface AnalysisVariableDef {
  id: AnalysisVariableId;
  label: string;
  unit: string;
  source: AnalysisDataSource;
  /** Right Y-axis when mixing incompatible units (e.g. fire count vs AOD). */
  yAxis?: 'left' | 'right';
}

export const ANALYSIS_VARIABLES: AnalysisVariableDef[] = [
  { id: 'aeronet_aod_500', label: 'AERONET AOD 500nm', unit: 'dimensionless', source: 'aeronet', yAxis: 'left' },
  { id: 'aeronet_aod_675', label: 'AERONET AOD 675nm', unit: 'dimensionless', source: 'aeronet', yAxis: 'left' },
  { id: 'merra2_pm25',     label: 'MERRA2 PM2.5',      unit: 'µg/m³',         source: 'merra2',  yAxis: 'right' },
  { id: 'merra2_aqi',      label: 'MERRA2 AQI',         unit: 'AQI',           source: 'merra2',  yAxis: 'right' },
  { id: 'aaqe_pm25',       label: 'AAQE PM2.5 Forecast', unit: 'µg/m³',        source: 'aaqe',    yAxis: 'right' },
  { id: 'fire_count',      label: 'Fire Count (100 km)', unit: 'fires/day',     source: 'firms',   yAxis: 'right' },
];

export const DEFAULT_ANALYSIS_VARIABLES: AnalysisVariableId[] = [
  'aeronet_aod_500',
  'merra2_pm25',
];

export function getVariableDef(id: AnalysisVariableId): AnalysisVariableDef | undefined {
  return ANALYSIS_VARIABLES.find((v) => v.id === id);
}
