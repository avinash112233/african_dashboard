export type DashboardV1Workflow = 'historical' | 'nrt' | 'forecast';

export type DashboardV1Layer =
  | 'aeronet'
  | 'fires'
  | 'viirs'
  | 'merra2'
  | 'washu'
  | 'openaq'
  | 'aaqe';

export const DASHBOARD_V1_WORKFLOW_TABS: { id: DashboardV1Workflow; label: string }[] = [
  { id: 'historical', label: 'Historical' },
  { id: 'nrt', label: 'Near real time' },
  { id: 'forecast', label: 'Forecast' },
];

export const DASHBOARD_V1_WORKFLOW_META: Record<
  DashboardV1Workflow,
  { title: string; description: string; defaultLayer: DashboardV1Layer; icon: string }
> = {
  historical: {
    title: 'Historical analysis',
    description: 'MERRA2, WashU, AERONET AOD, and OpenAQ daily means for selected dates.',
    defaultLayer: 'aeronet',
    icon: 'bi-clock-history',
  },
  nrt: {
    title: 'Near-real-time analysis',
    description: 'Fire hotspots, VIIRS imagery, and latest OpenAQ ground readings.',
    defaultLayer: 'fires',
    icon: 'bi-broadcast',
  },
  forecast: {
    title: 'Forecast analysis',
    description: 'AAQE machine-learning PM2.5 forecast for African cities.',
    defaultLayer: 'aaqe',
    icon: 'bi-graph-up-arrow',
  },
};

export const DASHBOARD_V1_WORKFLOW_LAYERS: Record<DashboardV1Workflow, DashboardV1Layer[]> = {
  historical: ['aeronet', 'merra2', 'washu', 'openaq'],
  nrt: ['fires', 'viirs', 'openaq'],
  forecast: ['aaqe'],
};

export const DASHBOARD_V1_LAYER_LABELS: Record<DashboardV1Layer, string> = {
  aeronet: 'AERONET AOD',
  fires: 'Fire hotspots (VIIRS)',
  viirs: 'VIIRS true-color imagery',
  merra2: 'MERRA2 CNN PM2.5',
  washu: 'WashU 1-km PM2.5',
  openaq: 'OpenAQ ground PM2.5',
  aaqe: 'AAQE PM2.5 forecast',
};

/** Bootstrap icon class + accent color used to visually distinguish each map layer chip. */
export const DASHBOARD_V1_LAYER_META: Record<DashboardV1Layer, { icon: string; color: string }> = {
  aeronet: { icon: 'bi-cloud-haze2', color: '#ca8a04' },
  fires: { icon: 'bi-fire', color: '#ea580c' },
  viirs: { icon: 'bi-camera', color: '#0e7490' },
  merra2: { icon: 'bi-grid-3x3-gap-fill', color: '#0f68a9' },
  washu: { icon: 'bi-globe-americas', color: '#7c3aed' },
  openaq: { icon: 'bi-broadcast-pin', color: '#16a34a' },
  aaqe: { icon: 'bi-graph-up-arrow', color: '#be185d' },
};
