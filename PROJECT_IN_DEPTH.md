# African Aerosol Dashboard — In-Depth Project Description

This document complements `PROJECT.md` (API tables and quick reference) with architecture, runtime behavior, data pipelines, and operational detail for developers and maintainers.

---

## 1. Purpose and scope

The **African Aerosol Dashboard** is a web application for exploring **aerosol and air-quality–related** information over Africa (and global context where data products are global). It targets:

- **Ground truth:** AERONET sun photometer sites and multi-wavelength AOD.
- **Active fires:** NASA FIRMS VIIRS hotspots (regional WFS with CSV fallback).
- **Satellite context:** NASA GIBS VIIRS true-color imagery for a user-selected date.
- **Modeled surface PM2.5:** NASA GES DISC **MERRA2_CNN_HAQAST_PM25** (CNN bias-corrected hourly surface PM2.5), visualized as a smooth, publication-style heatmap with a vertical color scale.

The product is aimed at researchers, students, and air-quality stakeholders who need an interactive map plus charts without standing up a full GIS stack.

---

## 2. High-level architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (React + Vite)                                         │
│  • Routes, UI, charts                                           │
│  • Leaflet map + custom layers                                   │
└───────────────┬─────────────────────────────┬─────────────────────┘
                │                             │
                │  Dev: Vite proxy            │  Production static
                ▼                             ▼
   /api/aeronet, /api/firms,        Same paths only if host
   /api/gibs, /api/merra2          provides reverse proxy to
                │                   backend + NASA APIs
                ▼
┌───────────────────────────┐     ┌────────────────────────────┐
│  Optional Node backend     │     │  NASA public services     │
│  server/index.js :3001    │────▶│  CMR + GES DISC OPeNDAP     │
│  server/merra2.js         │     │  (Earthdata auth)           │
└───────────────────────────┘     └────────────────────────────┘
```

- **Frontend** is a SPA: all pages under `react-router-dom`, bundled by Vite.
- **Sensitive or CORS-blocked NASA calls** are intended to go through **Vite dev proxies** (`vite.config.ts`) or a **deployment reverse proxy**.
- **MERRA2 real data** requires the **Express backend** (`npm run backend`) because OPeNDAP needs server-side credentials and is not suitable to expose from the browser alone.

---

## 3. Technology stack (rationale)

| Area | Choice | Why it fits |
|------|--------|-------------|
| UI framework | React 19 + TypeScript | Typed components, large ecosystem. |
| Build | Vite 5 | Fast HMR, simple env handling, proxy for dev. |
| Maps | Leaflet + react-leaflet | Mature 2D maps; good control over panes and custom layers. |
| Charts | Chart.js + react-chartjs-2 | Standard time-series and scatter plots for AOD. |
| Styling | Bootstrap + MUI pickers | Global layout + accessible date controls. |
| Backend | Express 5 + Node `fetch` | Small surface area for a single JSON API route. |
| Dates | dayjs | Lightweight; used with MUI `LocalizationProvider`. |

---

## 4. Repository layout (conceptual)

| Path | Role |
|------|------|
| `src/main.tsx` | React root, StrictMode if enabled. |
| `src/App.tsx` | Router shell, `Navigation`, route table, MUI date provider. |
| `src/pages/` | One file per route: Home, Dashboard, Data Download, Publications, Team. |
| `src/components/layout/Navigation.tsx` | Top nav links. |
| `src/components/maps/` | Map container, basemaps, VIIRS tiles, PM2.5 raster layer, fire/AERONET canvas layer, circle tools, fire table. |
| `src/components/charts/` | AOD time series, scatter, wavelength bar, generic bar chart. |
| `src/services/` | HTTP clients: AERONET, FIRMS, MERRA2 (frontend contract). |
| `src/utils/` | AOD classification, date normalization, PM2.5 colormap + sampling helpers, geo (haversine). |
| `server/index.js` | Express app; `GET /api/merra2/pm25/grid`. |
| `server/merra2.js` | CMR granule discovery, OPeNDAP ASCII subset, parse, global grid JSON. |
| `vite.config.ts` | Dev proxies for AERONET, FIRMS, GIBS, MERRA2 backend. |
| `public/` | Static assets; legacy sample JSON may exist but frontend fallback is often **generated in code** for global grids. |
| `.env` / `.env.example` | Secrets vs documented variable names (never commit `.env`). |
| `PROJECT.md` | API endpoint and parameter reference. |
| **`PROJECT_IN_DEPTH.md`** | This file — architecture and behavior. |

---

## 5. Routing and pages

| Route | Component | Summary |
|-------|-----------|---------|
| `/` | `HomePage` | Project landing / intro. |
| `/dashboard` | `DashboardPage` (wrapped in `ErrorBoundary`) | Main science UI: date, layer toggles, map, charts, PM2.5 panel. |
| `/data-download` | `DataDownloadPage` | Data export / download UX. |
| `/publications` | `PublicationsPage` | Publications list. |
| `/team` | `TeamPage` | Team information. |

`App.tsx` sets `basename="/"` and imports Bootstrap CSS globally.

---

## 6. Dashboard page — state and UX model

`DashboardPage.tsx` is the orchestrator:

- **Global date** drives VIIRS tiles, MERRA2 request date, and (together with range controls) AERONET chart windows.
- **Layer mode** is exclusive: one of `aeronet` | `fires` | `viirs` | `merra2` at a time (checkbox group semantics).
- **AERONET:** site list once on mount; Africa-wide AOD map for coloring sites when AERONET layer is active; per-site charts when a site is selected.
- **Fires:** FIRMS points loaded (see `firmsApi`); optional circle selection and table of points in radius.
- **VIIRS:** GIBS true-color overlay for selected ISO date.
- **MERRA2:** Fetches grid for selected date; shows loading state; surfaces `source` (`gesdisc` vs `sample`) and optional `fallbackReason` for user-facing warnings (e.g. Earthdata 401).

Right-hand **Selected Data** panel shows context for the last clicked/hovered entity (site, fire, or PM2.5 sample).

---

## 7. Map stack (`MapVisualization.tsx`)

### 7.1 Basemap

`LayersControl` offers:

- OpenStreetMap
- Esri World Imagery
- Esri imagery + Carto light labels overlay

### 7.2 VIIRS imagery layer

When the VIIRS layer mode is on, a `TileLayer` requests NASA GIBS WMTS-style URLs. In development, URLs go through `/api/gibs` to avoid CORS; in production, direct `gibs-*.earthdata.nasa.gov` URLs are used (subject to CORS policy of the deployment host).

### 7.3 MERRA2 PM2.5 layer (`PM25HeatMapLayer.tsx`)

Implementation highlights:

- Data arrives as a **dense lat–lon grid** (`values` row-major, `bounds`, `width` × `height`).
- Rendering uses a **custom Leaflet `GridLayer`**: each map tile is a small **canvas** where pixels are colored by **bilinearly interpolated** PM2.5 (`samplePm25AtLatLon` in `pm25Colormap.ts`) for a smooth heatmap appearance.
- **Opacity** is tuned (~0.62) so basemap remains visible.
- **Interaction:** map-level `mousemove` / `click` / `mouseout` sample the same grid for tooltips and the right panel.

### 7.4 PM2.5 legend (`PM25Colorbar.tsx`)

- Vertical gradient bar, numeric ticks, title including units.
- Positioned **absolute**, **right side**, **vertically centered** on the map wrapper (`PM25Colorbar.css`).
- Hidden while `merra2Loading` is true to avoid flashing an empty legend.

### 7.5 Fires and AERONET (`CanvasFireLayer.tsx`)

- Shared **canvas renderer** for many `circleMarker` features.
- Fire points may be **subsampled** when counts are huge (`MAX_FIRE_MARKERS` with lat-band stratified sampling).
- Fire styling can reflect confidence / FRP (see component for current rules).

### 7.6 Circle tools

When fires mode is on, optional **circle select** draws a geodesic circle; `CircleFireTable` lists FIRMS points inside the circle.

---

## 8. MERRA2 data pipeline (deep dive)

### 8.1 Dataset

- **Short name:** `MERRA2_CNN_HAQAST_PM25`
- **Concept:** Bias-corrected **surface PM2.5** from a CNN applied in the MERRA2 context; see NASA catalog for full documentation and citation requirements.

### 8.2 Backend flow (`server/merra2.js`)

1. **Normalize date** in `server/index.js` (year floored at 2000; upper bound not hard-coded so new years can work when NASA publishes granules).
2. **CMR granule search** (JSON) for the calendar day.
3. Resolve **OPeNDAP URL** from CMR metadata or fall back to a constructed `acdisc` path.
4. Request **ASCII subset** of variable `MERRA2_CNN_Surface_PM25` for:
   - Time index **12** (documented as “noon” slice in this app),
   - **Full global** lat/lon index ranges matching the native grid (361 × 576).
5. Parse numeric lines into a flat array; compute min/max excluding fill value.
6. Return JSON: `bounds` global, `width`, `height`, `values`, `units`, `source: 'gesdisc'`, etc.

On any failure, return **`sample` grid** with a **`fallbackReason`** string (e.g. `opendap_401_unauthorized`, `cmr_network_error`) so the UI can explain *why* it is not real data.

### 8.3 Authentication (operational reality)

NASA Earthdata Login (EDL) governs access:

- Backend supports **`Authorization: Basic`** (username + password) and **`Authorization: Bearer`** (`EARTHDATA_TOKEN`) when set in `.env`.
- **Browser** access to OPeNDAP directory pages does **not** guarantee **server** access: EDL may require **application authorization**, **EULA acceptance**, or account flags that only GES DISC / Earthdata support can fix.
- A persistent **`401`** with `fallbackReason` indicating unauthorized almost always means **account or token authorization**, not a bug in the React map.

**Operational checklist:** `.env` correct → authorize **NASA GESDISC DATA ARCHIVE** (and related) in Earthdata → restart backend → verify `source` becomes `gesdisc`.

### 8.4 Frontend client (`src/services/merra2Api.ts`)

- **Development:** `fetch('/api/merra2/pm25/grid?date=...')` via Vite proxy to `localhost:3001`.
- **Production build (`import.meta.env.PROD`):** the bundled app **does not** call your Node server unless the host is configured to proxy `/api/merra2` to a backend; otherwise it uses **`buildGlobalFallbackGrid`** (synthetic global field) so the UI still runs on static hosting.

### 8.5 Colormap (`src/utils/pm25Colormap.ts`)

- Scientific-style **sequential ramp** (light → orange/red → dark) mapped with a **fixed display scale** (0–100 µg/m³ style) for comparability with common publication figures.
- **Sampling helpers** implement bilinear interpolation + nearest fallback for robust hover values at cell edges.

---

## 9. AERONET pipeline (summary)

- **Site catalog:** downloaded as text, parsed, filtered to an Africa bounding box.
- **Per-site time series** and **Africa-wide** queries use `print_web_data_v3` with date ranges and AOD product flags.
- **AOD levels** for map coloring come from shared utilities (`aodUtils.ts`) so legend and markers stay consistent.

See `PROJECT.md` for exact query parameters.

---

## 10. FIRMS pipeline (summary)

- Primary path: **WFS GeoJSON** for VIIRS NOAA-21 7-day layers split by NASA **region** (Northern/Central + Southern Africa) for performance.
- Fallback: **CSV area API** for NOAA-20 if WFS fails.
- Requires `VITE_FIRMS_MAP_KEY` in `.env` (Vite injects at build time).

---

## 11. Configuration and security

| Variable | Consumer | Notes |
|----------|-----------|--------|
| `EARTHDATA_USERNAME` / `EARTHDATA_PASSWORD` | Node backend | Basic auth to OPeNDAP. |
| `EARTHDATA_TOKEN` | Node backend | Bearer alternative; prefer after EDL changes. |
| `VITE_FIRMS_MAP_KEY` | Vite frontend bundle | Public in built JS; still treat as a secret-like token and rotate if leaked. |
| `MERRA2_API_PORT` | `server/index.js` | Optional; default 3001. |

**Never commit `.env`.** Use `.env.example` only as a template. If credentials appear in chat, screenshots, or CI logs, **rotate** them.

---

## 12. Scripts and typical developer workflow

```bash
npm install          # once
npm run backend      # terminal 1 — MERRA2 API (needs .env)
npm run dev          # terminal 2 — Vite dev server
npm run build        # production bundle + tsc
npm run preview      # serve dist locally
npm run lint         # eslint
```

For **full MERRA2** in dev: backend **must** be running before or shortly after loading the dashboard MERRA2 layer, and Earthdata auth must succeed.

---

## 13. Deployment considerations

1. **Static frontend only:** PM2.5 will be **synthetic fallback** unless you deploy the Express service (or serverless equivalent) and configure the same `/api/merra2` reverse proxy path.
2. **CORS:** Production hosts must allow browser calls to any direct NASA tile URLs if not proxied.
3. **Secrets:** Store Earthdata credentials in the server environment (e.g. platform secret manager), not in the client.

---

## 14. Known limitations and extension ideas

- **Single exclusive layer mode** simplifies performance but prevents simultaneous overlay of all products; could be relaxed with z-order and partial opacity controls.
- **MERRA2 timestep** is fixed to index 12 in backend subset; exposing local solar time or multiple hours would need API and UI changes.
- **FIRMS** is a rolling multi-day product; date alignment with calendar day is handled in app logic (see `DashboardPage` / `firmsApi` history in git).
- **ViewportFirePanel** exists in the tree but may not be wired into the current dashboard layout — verify before documenting as user-facing.

---

## 15. Further reading

- `PROJECT.md` — API paths, query parameters, and data contracts.
- NASA dataset catalog pages for **MERRA2_CNN_HAQAST_PM25**, **FIRMS**, **AERONET**, and **GIBS** for citation and terms of use.

---

*Document generated for repository maintainers. Update this file when major architecture or data-flow behavior changes.*
