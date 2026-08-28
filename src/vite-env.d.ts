/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_KEY?: string;
  readonly VITE_API_BASE_URL?: string;
  /** Optional override for AAQE GeoJSON base (trailing slash optional). Same as aeronet_aq `GEOJSON_AAQE`. */
  readonly VITE_AAQE_FORECAST_BASE_URL?: string;
  /** If `'true'`, use `https://aeronet.gsfc.nasa.gov/.../output_AAQE_geoJSON/` (browser must allow CORS). */
  readonly VITE_AAQE_USE_DIRECT_NASA?: string;
  /** If `'true'`, expose Dashboard V2 (required for V2-only production mode). */
  readonly VITE_ENABLE_DASHBOARD_V2?: string;
  /** If `'true'` with V2 enabled, hide V1 and serve V2 at `/dashboard`. */
  readonly VITE_DASHBOARD_V2_ONLY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}



