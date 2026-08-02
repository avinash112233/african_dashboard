export type AnalysisWorkflow = 'historical' | 'nrt' | 'forecast';

export type DashboardV2LayerKey = 'merra2' | 'aeronet' | 'openaq' | 'fires' | 'viirs' | 'washu' | 'aaqe';

export interface DashboardV2Product {
  id: string;
  label: string;
  unit: string;
  layer: DashboardV2LayerKey;
  heatCapable: boolean;
}

export interface WorkflowConfig {
  title: string;
  description: string;
  products: DashboardV2Product[];
  heatProducts: string[];
  defaultProductId: string;
}

export const DASHBOARD_V2_WORKFLOWS: Record<AnalysisWorkflow, WorkflowConfig> = {
  historical: {
    title: 'Historical analysis',
    description:
      'Historical products support MERRA2 CNN PM2.5 grids and stations, AERONET AOD context, and OpenAQ ground PM2.5 for selected dates.',
    products: [
      {
        id: 'merra2_cnn_pm25',
        label: 'MERRA2-CNN PM2.5',
        unit: 'µg m⁻³',
        layer: 'merra2',
        heatCapable: true,
      },
      {
        id: 'aeronet_aod',
        label: 'AERONET AOD',
        unit: 'AOD 500/550 nm',
        layer: 'aeronet',
        heatCapable: false,
      },
      {
        id: 'historical_obs',
        label: 'OpenAQ ground PM2.5',
        unit: 'µg m⁻³',
        layer: 'openaq',
        heatCapable: false,
      },
      {
        id: 'washu_satpm25',
        label: 'WashU 1-km PM2.5',
        unit: 'µg m⁻³',
        layer: 'washu',
        heatCapable: true,
      },
    ],
    heatProducts: ['merra2_cnn_pm25', 'washu_satpm25', 'aeronet_aod'],
    defaultProductId: 'aeronet_aod',
  },
  nrt: {
    title: 'Near-real-time satellite analysis',
    description:
      'Near-real-time products focus on VIIRS true-color context, fire hotspots, AERONET AOD, and latest OpenAQ ground PM2.5 for event interpretation.',
    products: [
      {
        id: 'fire_hotspots',
        label: 'Fire hotspots (VIIRS)',
        unit: 'count',
        layer: 'fires',
        heatCapable: false,
      },
      {
        id: 'viirs_rgb',
        label: 'VIIRS true-color context',
        unit: 'qualitative',
        layer: 'viirs',
        heatCapable: false,
      },
      {
        id: 'aeronet_aod',
        label: 'AERONET AOD',
        unit: 'AOD 500/550 nm',
        layer: 'aeronet',
        heatCapable: false,
      },
      {
        id: 'openaq_pm25',
        label: 'OpenAQ PM2.5 (latest)',
        unit: 'µg m⁻³',
        layer: 'openaq',
        heatCapable: false,
      },
    ],
    heatProducts: ['fire_hotspots'],
    defaultProductId: 'fire_hotspots',
  },
  forecast: {
    title: 'Forecast analysis',
    description:
      'AAQE PM2.5 forecast layers show forward-looking air-quality information for African cities and regions.',
    products: [
      {
        id: 'geos_fp_ml_pm25',
        label: 'AAQE PM2.5 forecast',
        unit: 'µg m⁻³',
        layer: 'aaqe',
        heatCapable: true,
      },
    ],
    heatProducts: ['geos_fp_ml_pm25'],
    defaultProductId: 'geos_fp_ml_pm25',
  },
};

export const PRODUCT_METADATA: Record<
  string,
  { short: string; temporal: string; resolution: string; use: string }
> = {
  merra2_cnn_pm25: {
    short: 'Bias-corrected historical PM2.5 from MERRA2 CNN station archive and native grid overlay.',
    temporal: 'Daily station values; hourly grid slices (UTC)',
    resolution: 'Station points + 0.625°×0.5° grid cells',
    use: 'Primary historical PM2.5 exploration for Africa.',
  },
  aeronet_aod: {
    short: 'Ground-based aerosol optical depth from AERONET sites across Africa.',
    temporal: 'Daily AOD for map coloring; time series on site click',
    resolution: 'Point stations',
    use: 'AOD validation and aerosol event confirmation.',
  },
  historical_obs: {
    short: 'Ground-network PM2.5 from OpenAQ for the selected calendar date.',
    temporal: 'Daily mean for selected date',
    resolution: 'Point monitors',
    use: 'Historical ground-truth context for PM2.5.',
  },
  fire_hotspots: {
    short: 'Active fire detections from NOAA-21 VIIRS (FIRMS) over the last 7 days.',
    temporal: 'Near-real-time detections',
    resolution: 'Point hotspots',
    use: 'Smoke source attribution and fire activity monitoring.',
  },
  viirs_rgb: {
    short: 'NASA GIBS VIIRS NOAA-21 true-color imagery for visual smoke, dust, and cloud context.',
    temporal: 'Daily composite for selected date',
    resolution: 'Satellite imagery',
    use: 'Qualitative interpretation of aerosol events.',
  },
  openaq_pm25: {
    short: 'OpenAQ PM2.5 readings for the selected date only (gray = no reading that day).',
    temporal: 'Latest available readings',
    resolution: 'Point monitors',
    use: 'Near-real-time local PM2.5 monitoring.',
  },
  geos_fp_ml_pm25: {
    short: 'AAQE machine-learning PM2.5 forecast for African cities.',
    temporal: 'Multi-day forecast from latest init run',
    resolution: 'City / grid forecast points',
    use: 'Forward-looking air-quality planning and advisories.',
  },
  washu_satpm25: {
    short: 'WashU ACAG SatPM2.5 V6.GL.03 monthly/annual means over Africa (~1 km).',
    temporal: 'Monthly and annual means, 1998–2023',
    resolution: '~0.01° fine grid',
    use: 'Long-term satellite-derived PM2.5 exposure mapping.',
  },
};

export const DASHBOARD_V2_COUNTRIES = [
  'Africa overview',
  'Nigeria',
  'Ghana',
  'Uganda',
  'Rwanda',
  'Kenya',
  'South Africa',
  'Ethiopia',
  'Senegal',
] as const;

export const DASHBOARD_V2_CITIES: Record<string, string[]> = {
  'Africa overview': ['— select country first —'],
  Nigeria: ['Lagos, Nigeria', 'Abuja, Nigeria', 'Kano, Nigeria'],
  Ghana: ['Accra, Ghana', 'Kumasi, Ghana'],
  Uganda: ['Kampala, Uganda', 'Gulu, Uganda'],
  Rwanda: ['Kigali, Rwanda'],
  Kenya: ['Nairobi, Kenya'],
  'South Africa': ['Johannesburg, South Africa', 'Cape Town, South Africa'],
  Ethiopia: ['Addis Ababa, Ethiopia'],
  Senegal: ['Dakar, Senegal'],
};

export const DASHBOARD_V2_STATION_NETWORKS = [
  'All station networks',
  'AERONET',
  'OpenAQ / AirQo',
  'MERRA2 CNN stations',
  'WashU SatPM2.5',
  'AAQE forecast sites',
] as const;

export function getWorkflowLayers(workflow: AnalysisWorkflow): DashboardV2LayerKey[] {
  return DASHBOARD_V2_WORKFLOWS[workflow].products.map((p) => p.layer);
}

export function getProductById(workflow: AnalysisWorkflow, productId: string): DashboardV2Product | undefined {
  return DASHBOARD_V2_WORKFLOWS[workflow].products.find((p) => p.id === productId);
}

export function getDefaultProductId(workflow: AnalysisWorkflow): string {
  return DASHBOARD_V2_WORKFLOWS[workflow].defaultProductId;
}

const POINT_ONLY_PRODUCT_IDS = new Set([
  'aeronet_aod',
  'historical_obs',
  'openaq_pm25',
  'fire_hotspots',
]);

export function isPointOnlyProduct(productId: string): boolean {
  return POINT_ONLY_PRODUCT_IDS.has(productId);
}
