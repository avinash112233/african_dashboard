# African Aerosol Dashboard — Project Description

A React + TypeScript web application for visualizing aerosol and air quality data over Africa. Integrates NASA AERONET, VIIRS fire hotspots, VIIRS satellite imagery, and MERRA2 PM2.5 surface concentrations.

---

## Table of Contents

1. [Overview](#overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [APIs Used](#apis-used)
5. [Environment Variables](#environment-variables)
6. [Scripts & Commands](#scripts--commands)
7. [Features & Functions](#features--functions)
8. [Data Flow](#data-flow)

---

## Overview

The dashboard provides:

- **AERONET Sites** — Ground-based sun photometer locations with AOD (Aerosol Optical Depth) time series
- **Fire Hotspots (VIIRS)** — NASA FIRMS active fire detections (NOAA-21, 7-day)
- **AOD Heat Map** — Interpolated AOD visualization at AERONET sites
- **VIIRS Imagery** — NASA GIBS satellite true-color basemap
- **MERRA2 PM2.5** — Surface PM2.5 concentrations from NASA GES DISC (2000–2024)

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Vite |
| Maps | Leaflet, react-leaflet, leaflet.heat |
| Charts | Chart.js, react-chartjs-2 |
| UI | MUI (Material UI), Bootstrap |
| Backend | Express.js (Node) |
| Date handling | dayjs |

---

## Project Structure

```
african_dashboard/
├── server/                 # Express backend
│   ├── index.js            # MERRA2 PM2.5 API routes
│   └── merra2.js           # GES DISC OPeNDAP fetch logic
├── src/
│   ├── services/           # API clients
│   │   ├── aeronetApi.ts   # AERONET API
│   │   ├── firmsApi.ts     # FIRMS fire hotspots API
│   │   └── merra2Api.ts    # MERRA2 PM2.5 (frontend)
│   ├── components/
│   │   ├── charts/         # Time series, scatter, wavelength charts
│   │   ├── maps/           # Map layers (CanvasFireLayer, PM25HeatMapLayer, etc.)
│   │   ├── layout/         # Navigation
│   │   └── dataDownload/   # Data export form
│   ├── pages/              # Dashboard, Home, Data Download, Publications, Team
│   └── utils/              # aodUtils, dateFormat, geoUtils
├── public/
│   ├── merra2-sample-grid.json   # Fallback PM2.5 grid (when backend offline)
│   └── merra2-sample.json        # Fallback PM2.5 points
├── vite.config.ts          # Vite config + API proxies
├── .env.example
└── package.json
```

---

## APIs Used

### 1. AERONET (NASA)

**Base URL:** `https://aeronet.gsfc.nasa.gov`  
**Proxy:** `/api/aeronet` → `aeronet.gsfc.nasa.gov`

#### 1.1 Site locations

| Item | Value |
|------|-------|
| **Endpoint** | `GET /aeronet_locations_extended_v3.txt` |
| **Request** | No query params |
| **Response** | Tab/CSV text with columns: site, latitude, longitude, elevation, name, etc. |

**Function:** `getAfricanAERONETSites()`  
**Returns:** `AERONETSite[]` filtered to Africa bbox (lat -37..37, lon -18..52)

```ts
interface AERONETSite {
  site: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  name?: string;
}
```

#### 1.2 AOD time series (single site)

| Item | Value |
|------|-------|
| **Endpoint** | `GET /cgi-bin/print_web_data_v3` |
| **Request params** | `site`, `year`, `month`, `day`, `year2`, `month2`, `day2`, `AOD15=1`, `AVG=20`, `if_no_html=1` |
| **Response** | CSV with Date, Time, AOD_500nm, AOD_675nm, AOD_870nm, AOD_1020nm, etc. |

**Function:** `getAERONETData(site: string, startDate: string, endDate: string)`  
**Returns:** `AERONETDataPoint[]`

```ts
interface AERONETDataPoint {
  date: string;
  time?: string;
  dayOfYear?: number;
  AOD_500nm?: number;
  AOD_675nm?: number;
  AOD_870nm?: number;
  AOD_1020nm?: number;
}
```

#### 1.3 AOD for all African sites (date range)

| Item | Value |
|------|-------|
| **Endpoint** | `GET /cgi-bin/print_web_data_v3` |
| **Request params** | `year`, `month`, `day`, `year2`, `month2`, `day2`, `lat1=-37`, `lon1=-18`, `lat2=37`, `lon2=52`, `AOD15=1`, `AVG=20`, `if_no_html=1` |
| **Response** | CSV with site, AOD columns |

**Function:** `getAERONETDataAfrica(startDate: string, endDate: string)`  
**Returns:** `SiteAODMap` — `{ [siteId]: { hasData: true, AOD_500nm?, ... } | { hasData: false } }`

---

### 2. FIRMS (NASA — Fire Hotspots)

**Base URL:** `https://firms.modaps.eosdis.nasa.gov`  
**Proxy:** `/api/firms` → `firms.modaps.eosdis.nasa.gov`  
**Auth:** Free MAP_KEY required (set as `VITE_FIRMS_MAP_KEY` in `.env`)

#### 2.1 WFS (primary source)

| Item | Value |
|------|-------|
| **Endpoint** | `GET /mapserver/wfs/{region}/{MAP_KEY}/` |
| **Regions** | `Northern_and_Central_Africa`, `Southern_Africa` |
| **Params** | `SERVICE=WFS`, `VERSION=2.0.0`, `REQUEST=GetFeature`, `TYPENAME=ms:fires_noaa21_7days`, `OUTPUTFORMAT=application/json` |
| **Response** | GeoJSON FeatureCollection with Point geometries |

**Function:** `getNOAA21VIIRS7DayFromWFS()`  
**Returns:** `FIRMSFirePoint[]`  
**Fallback:** If WFS fails → CSV Area API

#### 2.2 CSV Area API (fallback)

| Item | Value |
|------|-------|
| **Endpoint** | `GET /api/area/csv/{MAP_KEY}/VIIRS_NOAA20_NRT/{bbox}/{day}` |
| **bbox** | `-18,-35,51.5,37.3` (west,south,east,north) |
| **day** | 1–7 (days ago) |
| **Response** | CSV with latitude, longitude, bright_ti4, acq_date, acq_time, etc. |

**Function:** `getNOAA20VIIRS7DayDataset()`  
**Returns:** `FIRMSFirePoint[]`

```ts
interface FIRMSFirePoint {
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
```

---

### 3. NASA GIBS (VIIRS Imagery)

**Base URL:** `https://gibs.earthdata.nasa.gov` (or `/api/gibs` in dev)  
**Endpoint:** WMTS tiles for VIIRS S-NPP True Color  
**Format:** `/{epsg}/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`  
**Request:** Tile requests (no explicit API call from app; Leaflet TileLayer fetches tiles)  
**Response:** JPEG map tiles

---

### 4. MERRA2 PM2.5 (GES DISC)

**Dataset:** [MERRA2_CNN_HAQAST_PM25](https://www.earthdata.nasa.gov/data/catalog/ges-disc-merra2-cnn-haqast-pm25-1)  
**Coverage:** 2000-01-01 to 2024-12-31  

#### 4.1 Frontend API (our backend)

| Item | Value |
|------|-------|
| **Endpoint** | `GET /api/merra2/pm25/grid?date=YYYY-MM-DD` |
| **Target (dev)** | `http://localhost:3001` (Express backend) |
| **Request** | Query param `date` (YYYY-MM-DD) |
| **Response** | JSON grid object |

**Function:** `getMERRA2PM25Grid(date: string)`  
**Returns:** `MERRA2PM25GridResponse`

```ts
interface MERRA2PM25GridResponse {
  date: string;
  units: string;
  bounds: { south, west, north, east };
  width: number;
  height: number;
  noDataValue: number;
  min: number;
  max: number;
  values: number[];  // row-major flattened grid
  source: 'gesdisc' | 'sample';
}
```

**Fallback:** If backend unavailable → `public/merra2-sample-grid.json` (source: `'sample'`)

#### 4.2 Backend → GES DISC OPeNDAP

| Item | Value |
|------|-------|
| **CMR check** | `GET https://cmr.earthdata.nasa.gov/search/granules.umm_json?provider=GES_DISC&short_name=MERRA2_CNN_HAQAST_PM25&temporal={date}T00:00:00Z,{date}T23:59:59Z` |
| **OPeNDAP** | `https://acdisc.gesdisc.eosdis.nasa.gov/opendap/HAQAST/MERRA2_CNN_HAQAST_PM25.1/{year}/{granule}.ascii` |
| **Auth** | Basic (EARTHDATA_USERNAME, EARTHDATA_PASSWORD) |
| **Subset** | Africa bbox, noon timestep (index 12) |
| **Response** | ASCII array of PM2.5 values |

**Backend function:** `fetchMerra2Grid(date)` in `server/merra2.js`  
**Fallback:** If CMR/OPeNDAP fails → synthetic sample grid

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `EARTHDATA_USERNAME` | For real MERRA2 | NASA Earthdata Login |
| `EARTHDATA_PASSWORD` | For real MERRA2 | NASA Earthdata Login |
| `VITE_FIRMS_MAP_KEY` | For fire hotspots | Free FIRMS MAP_KEY from [firms.modaps.eosdis.nasa.gov](https://firms.modaps.eosdis.nasa.gov/api/) |
| `MERRA2_API_PORT` | Optional | Backend port (default 3001) |

Copy `.env.example` to `.env` and fill in values.

---

## Scripts & Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server (frontend) |
| `npm run build` | TypeScript build + Vite production build |
| `npm run backend` | Start Express backend on port 3001 (MERRA2 API) |
| `npm run preview` | Preview production build |

**For full MERRA2 real data:** Run `npm run backend` in one terminal and `npm run dev` in another.

---

## Features & Functions

### Map Layers

| Layer | Component | Data source |
|-------|-----------|-------------|
| AERONET Sites | `CanvasFireLayer` | `getAfricanAERONETSites()` |
| Fire Hotspots | `CanvasFireLayer` | `getNOAA21VIIRS7DayFromWFS()` |
| AOD Heat Map | `AODHeatMapLayer` | AERONET + `getAERONETDataAfrica()` |
| VIIRS Imagery | `TileLayer` | NASA GIBS WMTS |
| MERRA2 PM2.5 | `PM25HeatMapLayer` | `getMERRA2PM25Grid()` |

### Charts

| Chart | Component | Data |
|-------|-----------|------|
| Time Series | `TimeSeriesChart` | `getAERONETData()` → daily mean AOD |
| Scatter | `ScatterPlotChart` | AOD 500nm vs 675nm |
| Wavelength | `WavelengthBarChart` | Multi-wavelength comparison |

### Utilities

| File | Functions |
|------|-----------|
| `aodUtils.ts` | `getAODLevel`, `getAODLevelColor`, `getAODLevelLabel`, `computeDailyMeanAOD`, `AOD_CLASSIFICATION_LEGEND` |
| `geoUtils.ts` | `haversineKm` |
| `dateFormat.ts` | `normalizeAeronetDate`, `formatDateMonthDayYear` |

---

## Data Flow

```
User selects date / toggles layers
        ↓
DashboardPage (state: selectedDate, showFires, showMERRA2PM25, ...)
        ↓
┌───────────────────────────────────────────────────────────────┐
│ AERONET: getAfricanAERONETSites() → map markers               │
│          getAERONETData(site, start, end) → charts            │
│          getAERONETDataAfrica(start, end) → AOD colors        │
├───────────────────────────────────────────────────────────────┤
│ FIRMS:  getNOAA21VIIRS7DayFromWFS() → fire points             │
├───────────────────────────────────────────────────────────────┤
│ MERRA2: getMERRA2PM25Grid(date) → canvas heat overlay         │
│          → /api/merra2/pm25/grid?date=...                     │
│          → backend → GES DISC OPeNDAP or sample               │
├───────────────────────────────────────────────────────────────┤
│ VIIRS:  TileLayer fetches tiles for selected date             │
└───────────────────────────────────────────────────────────────┘
        ↓
MapVisualization renders layers
```

---

## Proxy Configuration (vite.config.ts)

| Path | Target | Purpose |
|------|--------|---------|
| `/api/aeronet` | `aeronet.gsfc.nasa.gov` | AERONET CORS bypass |
| `/api/firms` | `firms.modaps.eosdis.nasa.gov` | FIRMS CORS bypass |
| `/api/gibs` | `gibs.earthdata.nasa.gov` | VIIRS tile CORS bypass |
| `/api/merra2` | `http://localhost:3001` | MERRA2 backend |
