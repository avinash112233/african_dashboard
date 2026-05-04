# VIIRS Layer — In-Depth Implementation Guide

This document explains exactly how the VIIRS functionality is implemented in this project, including imagery tiles, fire hotspots, API endpoints, request paths, data transformation, and troubleshooting.

---

## 1) Scope: what “VIIRS layer” means in this app

There are **two distinct VIIRS-based capabilities**:

1. **VIIRS Imagery layer** (visual satellite background)
   - Source: NASA GIBS
   - Format: WMTS raster tiles (`.jpg`)
   - Rendered as Leaflet `TileLayer`

2. **VIIRS Fire Hotspots layer** (point detections)
   - Source: NASA FIRMS
   - Primary feed: WFS GeoJSON (`fires_noaa21_7days`)
   - Fallback feed: FIRMS Area CSV API (NOAA-20)
   - Rendered in custom `CanvasFireLayer`

---

## 2) Core files involved

- `src/components/maps/MapVisualization.tsx`
  - Adds/removes VIIRS imagery `TileLayer`
  - Displays fire points through `CanvasFireLayer`
- `src/services/firmsApi.ts`
  - Fetches and normalizes fire detections
  - Handles WFS primary + CSV fallback logic
- `src/pages/DashboardPage.tsx`
  - Layer toggle state (`showVIIRSImagery`, `showFires`)
  - Fetch trigger for fire points
  - Fire chart analysis filtering
- `vite.config.ts`
  - Dev proxy routes for `/api/gibs` and `/api/firms`

---

## 3) VIIRS imagery implementation (NASA GIBS)

### 3.1 Render path

In `MapVisualization.tsx`, imagery is added only when:

- `showVIIRSImagery === true`

It renders this Leaflet `TileLayer`:

- **Dev URL template**
  - `/api/gibs/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${selectedDate}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`
- **Prod URL template**
  - `https://gibs-{s}.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${selectedDate}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`
  - subdomains: `a`, `b`, `c`

### 3.2 Important tile settings

- Projection path uses `epsg3857` (Web Mercator)
- Tile matrix set: `GoogleMapsCompatible_Level9`
- `maxNativeZoom={8}`
- `maxZoom={18}`
- `opacity={0.9}`
- `zIndex={350}`

### 3.3 Date behavior

- `selectedDate` comes from dashboard date picker.
- URL is date-scoped, so imagery reflects that day.
- Future dates are clamped in dashboard before being passed down where applicable.

---

## 4) VIIRS fire hotspots implementation (NASA FIRMS)

### 4.1 Frontend trigger

In `DashboardPage.tsx`:

- Fire data is fetched via `getNOAA21VIIRS7DayFromWFS()`
- Trigger currently runs in an effect tied to selected date change:
  - `useEffect(..., [selectedDate])`

### 4.2 Service module

`src/services/firmsApi.ts` provides:

- `getNOAA21VIIRS7DayFromWFS()` (**primary**)
- `getNOAA20VIIRS7DayDataset()` (**fallback**)

### 4.3 Required environment variable

- `VITE_FIRMS_MAP_KEY`
  - Read at build/runtime in frontend service
  - Missing key => returns empty list with warning

---

## 5) API endpoints and request patterns

## 5.1 Dev proxy base

From `vite.config.ts`:

- `/api/firms` -> `https://firms.modaps.eosdis.nasa.gov`
- `/api/gibs` -> `https://gibs.earthdata.nasa.gov`

Rewrite strips the `/api/firms` or `/api/gibs` prefix before forwarding.

---

### 5.2 Fire primary endpoint (WFS GeoJSON)

For each region:

- `Northern_and_Central_Africa`
- `Southern_Africa`

Request template:

- `/api/firms/mapserver/wfs/${region}/${FIRMS_KEY}/?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAME=ms:fires_noaa21_7days&OUTPUTFORMAT=application/json`

Characteristics:

- Returns GeoJSON FeatureCollection
- Features parsed to internal `FIRMSFirePoint` interface
- Both regions fetched in parallel

---

### 5.3 Fire fallback endpoint (CSV Area API)

If WFS fails (HTTP/network/parse), fallback runs:

- Source: `VIIRS_NOAA20_NRT`
- Africa bbox: `-18,-35,51.5,37.3` (west,south,east,north)
- Day loop: `1..7`

Request template:

- `/api/firms/api/area/csv/${FIRMS_KEY}/VIIRS_NOAA20_NRT/-18,-35,51.5,37.3/${day}`

Returns CSV rows normalized into `FIRMSFirePoint`.

---

### 5.4 Imagery endpoint (WMTS raster tiles)

Dev template:

- `/api/gibs/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${selectedDate}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`

Prod template:

- `https://gibs-{s}.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${selectedDate}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`

---

## 6) Fire data model used in app

`FIRMSFirePoint`:

- `latitude`, `longitude`
- `bright_ti4`, optional `bright_ti5`
- `scan`, `track`
- `acq_date`, `acq_time`
- `satellite`, `instrument`
- `confidence`, optional `version`
- optional `frp`
- `daynight`

This normalized contract is what all downstream layers/charts consume.

---

## 7) Fire parsing and normalization details

### 7.1 WFS conversion

`wfsFeatureToFirePoint()` handles:

- Coordinates from `geometry.coordinates` fallback to properties
- `acq_time` numeric -> zero-padded string (`HHMM`)
- Property mapping:
  - `brightness` -> `bright_ti4`
  - `brightness_2` -> `bright_ti5`
  - `frp` copied as optional number

### 7.2 CSV conversion

- CSV parser lowercases headers and maps row values
- Invalid lat/lon rows dropped
- Numeric casts with safe defaults

---

## 8) Rendering architecture

## 8.1 Imagery

- Leaflet `TileLayer` in map overlay pane
- Only visible when VIIRS imagery layer toggle is active

## 8.2 Fire points

- `CanvasFireLayer` draws detections for performance (many points)
- Interactivity:
  - click selects fire for right panel
  - map tools (circle/rectangle selection) can temporarily disable pointer events

---

## 9) Integration with fire analysis charts

Fire charts in dashboard are based on fire detections after filters:

1. Optional spatial filter
   - All points by default
   - Rectangle selection if active
2. Time-range filter
   - `24H`, `48H`, `7D` anchored to latest detection timestamp

The filtered set drives:

- Fire Count Time Series
- Total FRP Time Series
- Brightness vs FRP Scatter

---

## 10) Dev vs production behavior

### Development

- Browser requests `/api/firms/*` and `/api/gibs/*`
- Vite proxies to NASA services
- Helps avoid direct browser CORS issues

### Production

- VIIRS imagery URL points directly to `gibs-{s}.earthdata.nasa.gov`
- FIRMS calls depend on deployment routing/CORS policy

If production has CORS issues for FIRMS, add equivalent reverse proxy on host.

---

## 11) Performance notes

- Fire points are rendered in canvas layer (faster than thousands of DOM markers)
- NOAA-21 WFS split by two Africa regions improves fetch behavior
- Additional optimizations already applied in dashboard:
  - precomputed fire datetime objects
  - memoized spatial/time filtering for charts

---

## 12) Common failure modes and troubleshooting

- **No fire points**
  - Check `VITE_FIRMS_MAP_KEY`
  - Check proxy logs for `/api/firms` responses
  - WFS may fail and fallback may still return empty if key invalid

- **Imagery not visible**
  - Verify selected date has available GIBS tiles
  - Check tile request status in devtools
  - Verify `/api/gibs` proxy in dev

- **Fire charts empty but points visible**
  - Check active time range (`24H/48H/7D`)
  - Check whether rectangle filter is still active

---

## 13) Quick reference of exact external services

- **NASA GIBS WMTS**
  - Host (prod): `https://gibs-{s}.earthdata.nasa.gov`
  - Layer: `VIIRS_SNPP_CorrectedReflectance_TrueColor`

- **NASA FIRMS**
  - Host via proxy: `https://firms.modaps.eosdis.nasa.gov`
  - WFS layer: `ms:fires_noaa21_7days`
  - CSV area source: `VIIRS_NOAA20_NRT`

---

## 14) Minimal local run checklist

```bash
npm install
npm run dev
```

And ensure `.env` includes:

- `VITE_FIRMS_MAP_KEY=<your_firms_key>`

Then:

1. Open dashboard
2. Toggle `Fire Hotspots (VIIRS)` and/or `VIIRS Imagery`
3. Verify network calls to `/api/firms/*` and `/api/gibs/*`

