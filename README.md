# African Aerosol Quality & Fire (AQF) Dashboard

A research-grade web application for monitoring and analyzing aerosol optical depth, air quality forecasts, MERRA2 PM2.5 reanalysis, and fire hotspots across Africa. Built by the UMBC HAQAST team.

---

## Table of Contents

1. [What It Does](#what-it-does)
2. [Architecture Overview](#architecture-overview)
3. [Data Layers](#data-layers)
4. [Tech Stack](#tech-stack)
5. [Prerequisites](#prerequisites)
6. [Quick Start (Local Development)](#quick-start-local-development)
7. [Production Deployment with Docker](#production-deployment-with-docker)
8. [Environment Variables Reference](#environment-variables-reference)
9. [MERRA2 Parquet Files](#merra2-parquet-files)
10. [API Keys](#api-keys)
11. [Troubleshooting](#troubleshooting)

---

## What It Does

The AQF Dashboard overlays four real-time and reanalysis data sources on an interactive map of Africa:

| Layer | Source | Type |
|---|---|---|
| **AERONET AOD** | NASA AERONET network | Near-real-time station measurements |
| **MERRA2 PM2.5** | NASA MERRA2 reanalysis (local Parquet) | Gridded/station reanalysis data |
| **AAQE Forecast** | NASA aeronet_aq model | 5-day PM2.5 forecast GeoJSON |
| **Fire Hotspots** | NASA FIRMS VIIRS 375m | Near-real-time fire detections |

The right sidebar's **Analysis Location** panel lets users click any point on the map and immediately compare time-series data from all four sources simultaneously — including automatic cross-layer station linking (nearest AERONET site, nearest MERRA2 grid point) and chart export.

---

## Architecture Overview

```
Browser (React + Leaflet)
        │
        │  HTTP 80
        ▼
┌────────────────────┐
│   Nginx (frontend) │  serves React SPA + proxies /api/* → backend
└────────┬───────────┘
         │  HTTP 3001 (internal Docker network)
         ▼
┌────────────────────────────────────────┐
│      Node.js Express (backend)         │
│  ├── /api/aeronet/*  → NASA AERONET    │ (reverse proxy, bypasses CORS)
│  ├── /api/merra2/pm25/grid             │
│  ├── /api/merra2/stations              │
│  ├── /api/merra2/station-list          │
│  └── /api/merra2/station-timeseries    │
│             │                          │
│        Python worker                   │
│   (reads Parquet files via pandas)     │
└────────────────┬───────────────────────┘
                 │  volume mount (read-only)
                 ▼
    /data/merra2/*.parquet  (on EC2 host)
```

---

## Data Layers

### AERONET AOD
- Station list and Level 2.0 AOD measurements from [NASA AERONET](https://aeronet.gsfc.nasa.gov).
- Requests are proxied through the backend to avoid CORS restrictions.
- Data is cached in the browser (`localStorage`) for 24 hours (site list) and 30 minutes (AOD measurements).

### MERRA2 PM2.5 (Parquet backend)
- Reads pre-downloaded annual Parquet files stored on the server.
- Files follow the naming convention: `YYYY_AfricanStationsFull.parquet`
- The Python worker (`server/merra2StationsWorker.py`) processes these files and the Express API exposes a clean JSON interface.
- Files are mounted into the Docker container at `/data/merra2/` — see [MERRA2 Parquet Files](#merra2-parquet-files).

### AAQE PM2.5 Forecast
- 5-day forecast GeoJSON published by the NASA aeronet_aq model.
- Available at `https://aeronet.gsfc.nasa.gov/data_push/AQI/output_AAQE_geoJSON/`
- The backend proxies this endpoint. The frontend automatically probes for the most recent available forecast date.

### Fire Hotspots (FIRMS VIIRS 375m)
- Near-real-time fire detection from [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov).
- Requires a free FIRMS Map Key — see [API Keys](#api-keys).

---

## Tech Stack

| Component | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite |
| Map | Leaflet + custom Canvas layers |
| Charts | Chart.js |
| Styling | CSS Modules |
| Backend | Node.js 20, Express 5 |
| Data processing | Python 3, pandas, pyarrow |
| Reverse proxy | Nginx (Alpine) |
| Container runtime | Docker + Docker Compose |

---

## Prerequisites

- **Docker** ≥ 24 and **Docker Compose** ≥ 2.20 installed on the EC2 instance.
- MERRA2 Parquet files accessible on the host filesystem.
- A NASA FIRMS Map Key (free, takes ~5 minutes).
- Outbound internet access from the instance (for NASA API calls).

---

## Quick Start (Local Development)

> This section is for running the app on a developer laptop without Docker.

```bash
# 1. Clone the repository
git clone <repo-url>
cd african_dashboard

# 2. Install Node dependencies
npm install

# 3. Create your environment file
cp .env.example .env
# Edit .env — fill in MERRA2_PARQUET_DIR and VITE_FIRMS_MAP_KEY at minimum

# 4. (In one terminal) Start the backend
npm run backend
# → Starts Express on http://localhost:3001

# 5. (In another terminal) Start the frontend dev server
npm run dev
# → Opens http://localhost:5173

# 6. (Optional) Start both simultaneously
npm run dev:all
```

Python requirements for the backend (one-time setup):

```bash
pip install pandas pyarrow
```

---

## Production Deployment with Docker

### 1. Clone the repository on your EC2 instance

```bash
git clone <repo-url>
cd african_dashboard
```

### 2. Create the `.env` file

```bash
cp .env.example .env
nano .env
```

Fill in at minimum:

```bash
VITE_FIRMS_MAP_KEY=your_firms_api_key_here
MERRA2_HOST_DIR=/absolute/path/to/your/parquet/files
```

See [Environment Variables Reference](#environment-variables-reference) for all options.

### 3. Build and start

```bash
docker compose up -d --build
```

This will:
- Build the React app (with your `VITE_FIRMS_MAP_KEY` baked in)
- Build the backend image (Node.js + Python)
- Start Nginx on port 80
- Mount your Parquet files into the backend container

The app will be accessible at `http://<your-ec2-public-ip>`.

### 4. Check status

```bash
docker compose ps
docker compose logs -f backend    # watch backend logs
docker compose logs -f frontend   # watch nginx logs
```

### 5. Updating to a new version

```bash
git pull
docker compose up -d --build
```

Docker Compose will only rebuild images that have changed.

---

## Environment Variables Reference

Copy `.env.example` to `.env` and set the values below.

### Required

| Variable | Description |
|---|---|
| `VITE_FIRMS_MAP_KEY` | NASA FIRMS API map key. Get one free at https://firms.modaps.eosdis.nasa.gov/api/ |
| `MERRA2_HOST_DIR` | **Docker only.** Absolute path on the EC2 host where your Parquet files live. Example: `/home/ubuntu/merra2_data` |

### Backend (set inside the container via docker-compose.yml)

| Variable | Default | Description |
|---|---|---|
| `MERRA2_PARQUET_DIR` | `/data/merra2` | Path *inside* the container where Parquet files are mounted. Do not change unless you edit docker-compose.yml. |
| `MERRA2_API_PORT` | `3001` | Port the Express backend listens on. |

### Optional

| Variable | Description |
|---|---|
| `EARTHDATA_USERNAME` | NASA Earthdata username. Currently unused by the Parquet-based backend but kept for future OPeNDAP integration. |
| `EARTHDATA_PASSWORD` | NASA Earthdata password. Same note as above. |
| `VITE_AAQE_USE_DIRECT_NASA` | Set to `true` to fetch AAQE GeoJSON directly from NASA in the browser (requires CORS). Default is `false` — the backend proxy is used instead. |

---

## MERRA2 Parquet Files

The backend reads annual Parquet files that must follow this naming convention exactly:

```
YYYY_AfricanStationsFull.parquet
```

Example:
```
/home/ubuntu/merra2_data/
├── 2018_AfricanStationsFull.parquet
├── 2019_AfricanStationsFull.parquet
├── 2020_AfricanStationsFull.parquet
├── 2021_AfricanStationsFull.parquet
├── 2022_AfricanStationsFull.parquet
├── 2023_AfricanStationsFull.parquet
├── 2024_AfricanStationsFull.parquet
└── 2025_AfricanStationsFull.parquet
```

Each file should contain at least these columns:

| Column | Description |
|---|---|
| `sitename` | Station identifier string |
| `latitude` | Station latitude (float) |
| `longitude` | Station longitude (float) |
| `date` | Date string in `YYYY-MM-DD` format |
| `PM25_RH35_GCC` | PM2.5 concentration at RH=35% (µg/m³) |

To mount these files, set `MERRA2_HOST_DIR` in your `.env` to the full path of the folder on your EC2 host. Docker Compose maps it to `/data/merra2` inside the backend container (read-only).

> **Note:** Years with no Parquet file are silently skipped. You do not need a file for the current year if data has not been generated yet.

---

## API Keys

### NASA FIRMS Map Key (required for fire layer)

1. Go to https://firms.modaps.eosdis.nasa.gov/api/
2. Click **Get API Key**
3. Log in with your NASA Earthdata account (or create one free)
4. Copy the key into your `.env` as `VITE_FIRMS_MAP_KEY`

> **Important:** The key is baked into the frontend bundle at build time by Vite. You must rebuild the Docker image (`docker compose up -d --build`) after changing it.

### NASA Earthdata (for AERONET / MERRA2 downloads)

The app fetches AERONET data via the public API — no login required. If you need to download new MERRA2 Parquet files in the future, you will need a free NASA Earthdata account at https://urs.earthdata.nasa.gov/

---

## Opening Port 80 on EC2

Make sure your EC2 Security Group inbound rules allow:

| Type | Port | Source |
|---|---|---|
| HTTP | 80 | 0.0.0.0/0 (or your institution IP range) |
| SSH | 22 | Your IP only |

If you want HTTPS (recommended for production), add port 443 and configure an SSL certificate. The simplest approach on EC2 is to put an **Application Load Balancer** in front that handles TLS termination, forwarding plain HTTP to the Nginx container on port 80.

---

## Troubleshooting

### App loads but fire hotspots don't appear
- Check that `VITE_FIRMS_MAP_KEY` is set correctly in `.env` and you rebuilt (`--build`) after setting it.
- Verify the key is valid at https://firms.modaps.eosdis.nasa.gov/api/area/

### MERRA2 panel shows "start backend" or "unavailable"
- Check the backend logs: `docker compose logs backend`
- Verify the Parquet files exist and are readable: `docker compose exec backend ls /data/merra2`
- Confirm `MERRA2_HOST_DIR` points to the correct host path.

### AERONET sites take a long time to load
- The app fetches sites from NASA's public API on first load and caches them in the browser for 24 hours. Subsequent visits are instant.
- If NASA's API is temporarily unreachable, the app serves any previously cached data automatically.

### AAQE forecast not appearing
- The model publishes daily; occasionally the current day's file is not yet available.
- The app automatically falls back to yesterday's and prior dates.
- Check the backend logs for proxy errors.

### Backend container keeps restarting
- Most likely a Python import error (missing `pandas` or `pyarrow`). Check `docker compose logs backend`.
- If you are on ARM64 (e.g., AWS Graviton), the Dockerfile uses `pip install --break-system-packages` which should work on both architectures. File a GitHub issue if you see wheel-build failures.

### Port 80 already in use on EC2
Edit `docker-compose.yml` and change `"80:80"` to `"8080:80"`, then access the app at `http://<ip>:8080`.

---

## Project Structure

```
african_dashboard/
├── src/
│   ├── pages/           # DashboardPage — main map + layer state
│   ├── components/
│   │   ├── analysis/    # AnalysisPanel (right sidebar)
│   │   └── layers/      # Individual map layer components
│   ├── analysis/        # fetchAnalysisSeries, catalog, types, linkStations
│   └── services/        # aeronetApi, aaqeForecastApi, firmsApi
├── server/
│   ├── index.js                  # Express entry point
│   ├── merra2.js                 # OPeNDAP grid route (legacy)
│   ├── merra2Stations.js         # Station API — calls Python worker
│   └── merra2StationsWorker.py   # Reads Parquet files
├── Dockerfile.backend    # Backend image build
├── Dockerfile.frontend   # Frontend (React → Nginx) image build
├── docker-compose.yml    # Production orchestration
├── nginx.conf            # Nginx SPA + reverse proxy config
└── .env.example          # Template for environment variables
```

---

## License

Research use — UMBC HAQAST / NASA Applied Sciences. Contact the team before redistributing.
