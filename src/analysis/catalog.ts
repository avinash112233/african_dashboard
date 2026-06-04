import type { AnalysisVariableId } from './types';

export interface AnalysisVariableDef {
  id: AnalysisVariableId;
  label: string;
  unit: string;
  source: 'aeronet' | 'merra2';
}

export const ANALYSIS_VARIABLES: AnalysisVariableDef[] = [
  { id: 'aeronet_aod_500', label: 'AERONET AOD 500nm', unit: 'dimensionless', source: 'aeronet' },
  { id: 'aeronet_aod_675', label: 'AERONET AOD 675nm', unit: 'dimensionless', source: 'aeronet' },
  { id: 'merra2_pm25', label: 'MERRA2 PM2.5', unit: 'µg/m³', source: 'merra2' },
  { id: 'merra2_aqi', label: 'MERRA2 AQI (from PM2.5)', unit: 'AQI', source: 'merra2' },
];

export const DEFAULT_ANALYSIS_VARIABLES: AnalysisVariableId[] = [
  'aeronet_aod_500',
  'merra2_pm25',
];

export function getVariableDef(id: AnalysisVariableId): AnalysisVariableDef | undefined {
  return ANALYSIS_VARIABLES.find((v) => v.id === id);
}
