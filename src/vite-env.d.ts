/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_KEY?: string;
  readonly VITE_API_BASE_URL?: string;
  /** Optional override for AAQE GeoJSON base (trailing slash optional). Same as aeronet_aq `GEOJSON_AAQE`. */
  readonly VITE_AAQE_FORECAST_BASE_URL?: string;
  /** If `'true'`, use `https://aeronet.gsfc.nasa.gov/.../output_AAQE_geoJSON/` (browser must allow CORS). */
  readonly VITE_AAQE_USE_DIRECT_NASA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}



