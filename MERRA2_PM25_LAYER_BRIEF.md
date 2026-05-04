# MERRA PM2.5 Layer — Implementation Brief

This file explains how the **MERRA2 PM2.5 map layer** is implemented in this project, end-to-end.

> Note: the current production workflow is **station-based parquet API** (`/api/merra2/stations`, `/api/merra2/station-timeseries`).  
> The older OPeNDAP grid heatmap route is retained only as a legacy backend endpoint.

---

## 1) What this layer is

- Product: **MERRA2_CNN_HAQAST_PM25** (surface PM2.5).
- Display type: **station marker layer** (AERONET-style interactions) on Leaflet map.
- Main behavior:
  - Uses selected dashboard date.
- Reads yearly parquet station archives from server-local storage.
- Computes daily station PM2.5 (UTC) for selected date.

---

## 2) Key files and responsibilities

- `src/components/maps/PM25HeatMapLayer.tsx`
  - Fetches PM2.5 grid data.
  - Builds and manages custom Leaflet `GridLayer` canvas tiles.
  - Handles hover/click PM2.5 sampling.
- `src/components/maps/PM25Colorbar.tsx`
  - Renders vertical PM2.5 legend.
- `src/utils/pm25Colormap.ts`
  - Color ramp and interpolation/sampling helpers.
- `src/services/merra2Api.ts`
  - Frontend API contract and fallback behavior.
- `server/index.js`
  - Express route: `GET /api/merra2/pm25/grid`.
- `server/merra2.js`
  - Real data fetch from CMR + OPeNDAP, parse, normalize, and fallback logic.
- `src/components/maps/MapVisualization.tsx`
  - Inserts PM2.5 layer and colorbar in map stack.
- `src/pages/DashboardPage.tsx`
  - Layer toggles, loading state, source/fallback warning messages.

---

## 3) Data contract used by frontend

The PM2.5 map layer expects a grid response like:

- `date`
- `units` (usually `µg/m³`)
- `bounds` `{ south, west, north, east }`
- `width`, `height`
- `values` (flattened row-major numeric array)
- `min`, `max`
- `noDataValue`
- `source`: `'gesdisc' | 'sample'`
- optional `fallbackReason`

This contract is defined in `src/services/merra2Api.ts`.

---

## 4) Frontend flow (runtime)

1. User enables **MERRA2 PM2.5** layer in `DashboardPage`.
2. `MapVisualization` mounts `PM25HeatMapLayer`.
3. `PM25HeatMapLayer` calls `getMERRA2PM25Grid(date)` from `merra2Api.ts`.
4. If backend response is valid, use returned real/sample grid.
5. Build a Leaflet canvas `GridLayer` for tile rendering.
6. For each tile pixel:
   - Convert pixel → map lat/lon.
   - Sample PM2.5 via interpolation.
   - Convert PM2.5 value → color from colormap.
7. Push layer source/loading info back up:
   - `onLoadingChange`
   - `onSourceChange`
8. Dashboard shows warning text if source is sample.

---

## 5) Backend flow (real NASA path)

Implemented in `server/merra2.js` and called by `server/index.js`.

1. Receive date from `/api/merra2/pm25/grid`.
2. Query **CMR** to verify granule availability for that date.
3. Resolve OPeNDAP URL (from CMR related URLs or constructed fallback URL).
4. Request OPeNDAP ASCII subset for global PM2.5 grid.
5. Parse ASCII numeric payload to flat `values[]`.
6. Compute `min/max` (respecting nodata).
7. Return normalized JSON contract with `source: 'gesdisc'`.

If any step fails, backend returns sample data with:

- `source: 'sample'`
- descriptive `fallbackReason` (example: `opendap_401_unauthorized`).

---

## 6) Dev vs production behavior

### Development

- Vite frontend requests `/api/merra2/pm25/grid`.
- Dev setup proxies/serves backend locally (`npm run backend`).
- Real NASA data possible if Earthdata auth is valid.

### Production (current app behavior)

- If no hosted backend is available behind `/api/merra2`, frontend uses fallback grid.
- So static-only deployment shows sample PM2.5 unless backend is deployed too.

---

## 7) Authentication and env requirements

Backend reads:

- `EARTHDATA_USERNAME`
- `EARTHDATA_PASSWORD`
- optional `EARTHDATA_TOKEN` (Bearer)

Notes:

- Earthdata account/app authorization is required for GES DISC OPeNDAP access.
- Browser access to dataset pages does not guarantee backend authorization.
- Keep secrets in `.env`; do not commit credentials.

---

## 8) Rendering details (visual behavior)

- Layer type: custom canvas tile layer for smooth scientific appearance.
- Opacity: semi-transparent so basemap remains visible.
- Colorbar: right-side vertical legend via `PM25Colorbar`.
- Sampling:
  - Bilinear interpolation for smooth visuals.
  - Hover/click values sampled from same grid logic for consistency.

---

## 9) Fallback behavior and user messaging

Fallback can happen due to:

- Earthdata unauthorized (401)
- no granule for date
- CMR/network error
- backend unreachable

UI behavior:

- Layer still renders using sample global field.
- Dashboard displays warning/tip text based on `source` + `fallbackReason`.

---

## 10) Performance approach

- Uses per-tile canvas rendering instead of large DOM overlays.
- Uses global grid dimensions compatible with MERRA native spacing.
- Keeps color sampling local/in-memory after response fetch.

---

## 11) How to run locally

```bash
npm install
npm run backend   # terminal 1
npm run dev       # terminal 2
```

Then:

1. Open Dashboard.
2. Enable **MERRA2 PM2.5**.
3. Pick supported dates.
4. Verify whether source is real or sample by UI warning text.

---

## 12) Quick troubleshooting

- PM2.5 not loading:
  - check backend is running.
  - check `/api/merra2/pm25/grid?date=YYYY-MM-DD` in network tab.
- Always sample data:
  - inspect `fallbackReason`.
  - verify Earthdata credentials/token and app authorization.
- 401 unauthorized:
  - Earthdata/GES DISC authorization issue, not only code issue.
- Works in dev, not prod:
  - deploy backend and route `/api/merra2/*` to it.

---

## 13) Current limitations

- Hour index is fixed in backend request (single timestep view).
- Static frontend alone cannot serve real OPeNDAP data securely.
- Visual scale is fixed for map readability/comparison.

