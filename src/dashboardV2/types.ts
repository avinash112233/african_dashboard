export interface SelectedFireData {
  latitude: number;
  longitude: number;
  bright_ti4: number;
  bright_ti5?: number;
  scan: number;
  track: number;
  acq_date: string;
  acq_time: string;
  satellite: string;
  instrument: string;
  confidence: string;
  version?: string;
  frp?: number;
  daynight: string;
}

export interface SelectedAAQEData {
  latitude: number;
  longitude: number;
  station?: string;
  siteName?: string;
  utcDate?: string;
  dailyAqi?: number;
  selectedPm?: number;
  selectedTimeCode?: string;
  hourlyPm: Array<{ label: string; value: number }>;
  hourlyAqi: Array<{ label: string; value: number }>;
  selectedAqiCategory?: string;
}

export type AnalysisRange = '7D' | '30D' | '90D';
export type PlotRangePreset = AnalysisRange;
export type PlotRangeMode = PlotRangePreset | 'custom';
export type FireAnalysisRange = '24H' | '48H' | '7D';
