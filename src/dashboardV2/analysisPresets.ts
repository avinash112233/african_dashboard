import type { AnalysisVariableId } from '../analysis/types';
import type { AnalysisAnchorSource } from '../analysis/types';

export type CrossAnalysisPresetId =
  | 'validation'
  | 'satellite'
  | 'aerosol'
  | 'fires'
  | 'full';

export interface CrossAnalysisPreset {
  id: CrossAnalysisPresetId;
  label: string;
  description: string;
  variables: AnalysisVariableId[];
  scatterX: AnalysisVariableId;
  scatterY: AnalysisVariableId;
  /** Historical workflow only unless noted. */
  workflows: Array<'historical' | 'nrt' | 'forecast'>;
}

export const CROSS_ANALYSIS_PRESETS: CrossAnalysisPreset[] = [
  {
    id: 'validation',
    label: 'Validation',
    description: 'Ground OpenAQ PM₂.₅ vs MERRA2-CNN daily estimates at colocated points.',
    variables: ['openaq_pm25', 'merra2_pm25'],
    scatterX: 'openaq_pm25',
    scatterY: 'merra2_pm25',
    workflows: ['historical'],
  },
  {
    id: 'satellite',
    label: 'Satellite PM2.5',
    description:
      'WashU ACAG SatPM2.5 (monthly) vs MERRA2-CNN daily PM2.5 aggregated to monthly means at the nearest colocated station.',
    variables: ['washu_pm25', 'merra2_pm25'],
    scatterX: 'washu_pm25',
    scatterY: 'merra2_pm25',
    workflows: ['historical'],
  },
  {
    id: 'aerosol',
    label: 'Aerosol context',
    description: 'AERONET column AOD vs MERRA2 surface PM₂.₅ (indirect relationship).',
    variables: ['aeronet_aod_500', 'merra2_pm25'],
    scatterX: 'aeronet_aod_500',
    scatterY: 'merra2_pm25',
    workflows: ['historical', 'nrt'],
  },
  {
    id: 'fires',
    label: 'Fire smoke',
    description: 'Nearby fire detections vs MERRA2 PM₂.₅ (FIRMS data: last 7 days).',
    variables: ['fire_count', 'merra2_pm25'],
    scatterX: 'fire_count',
    scatterY: 'merra2_pm25',
    workflows: ['historical', 'nrt'],
  },
  {
    id: 'full',
    label: 'All sources',
    description: 'AOD, ground PM₂.₅, satellite PM₂.₅, model PM₂.₅, fires, and forecast where available.',
    variables: [
      'aeronet_aod_500',
      'openaq_pm25',
      'washu_pm25',
      'merra2_pm25',
      'aaqe_pm25',
      'fire_count',
    ],
    scatterX: 'openaq_pm25',
    scatterY: 'merra2_pm25',
    workflows: ['historical', 'nrt', 'forecast'],
  },
];

export function presetsForWorkflow(
  workflow: 'historical' | 'nrt' | 'forecast'
): CrossAnalysisPreset[] {
  return CROSS_ANALYSIS_PRESETS.filter((p) => p.workflows.includes(workflow));
}

export function defaultPresetForWorkflow(
  workflow: 'historical' | 'nrt' | 'forecast'
): CrossAnalysisPresetId {
  if (workflow === 'historical') return 'validation';
  if (workflow === 'nrt') return 'fires';
  return 'full';
}

export function defaultPresetForAnchor(
  anchorSource: AnalysisAnchorSource | undefined,
  workflow: 'historical' | 'nrt' | 'forecast'
): CrossAnalysisPresetId {
  if (anchorSource === 'washu') return 'satellite';
  if (anchorSource === 'openaq') return 'validation';
  if (anchorSource === 'aeronet') return 'aerosol';
  if (anchorSource === 'fire') return 'fires';
  return defaultPresetForWorkflow(workflow);
}
