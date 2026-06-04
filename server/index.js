/**
 * Express backend for African Aerosol Dashboard
 * Serves MERRA2 PM2.5 grid API – connects to GES DISC when credentials are set.
 *
 * Set EARTHDATA_USERNAME and EARTHDATA_PASSWORD for real data.
 * Create account: https://urs.earthdata.nasa.gov/
 */

import 'dotenv/config';
import express from 'express';
import { fetchMerra2Grid } from './merra2.js';
import {
  getLatestStationDate,
  getStationList,
  getStationsForDate,
  getStationTimeseries,
  toHttpError,
} from './merra2Stations.js';

const app = express();
const PORT = process.env.MERRA2_API_PORT || 3001;

/**
 * Proxy AERONET (including AAQE forecast GeoJSON under /data_push/...) for production.
 * Vite only proxies /api/aeronet during `npm run dev`; static hosting needs this or nginx.
 */
app.use('/api/aeronet', async (req, res) => {
  try {
    const pathAndQuery = req.originalUrl.replace(/^\/api\/aeronet/, '') || '/';
    const target = `https://aeronet.gsfc.nasa.gov${pathAndQuery.startsWith('/') ? '' : '/'}${pathAndQuery}`;
    const upstream = await fetch(target, {
      method: req.method,
      headers: { 'User-Agent': 'african-dashboard/1.0' },
    });
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(upstream.status);
    const body = Buffer.from(await upstream.arrayBuffer());
    res.send(body);
  } catch (err) {
    console.error('[AERONET proxy] Error:', err);
    res.status(502).json({ error: err?.message || 'AERONET proxy failed' });
  }
});

app.get('/api/merra2/pm25/grid', async (req, res) => {
  try {
    const dateParam = req.query.date || new Date().toISOString().slice(0, 10);
    const [y, m, d] = dateParam.split('-').map(Number);
    const year = y || new Date().getFullYear();
    // Keep lower bound for dataset start year; do not hard-cap upper year
    // so newly published years can be requested without code changes.
    const normalizedYear = Math.max(2000, year);
    const normalizedDate = `${normalizedYear}-${String(m || 1).padStart(2, '0')}-${String(d || 1).padStart(2, '0')}`;

    const grid = await fetchMerra2Grid(normalizedDate);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(grid);
  } catch (err) {
    console.error('[MERRA2 API] Error:', err);
    res.status(500).json({ error: err.message || 'MERRA2 fetch failed' });
  }
});

app.get('/api/merra2/stations', async (req, res) => {
  try {
    const dateParam = String(req.query.date || '').trim();
    const stations = await getStationsForDate(dateParam);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ date: dateParam, stations });
  } catch (err) {
    const e = toHttpError(err);
    console.error('[MERRA2 stations] Error:', e.message);
    res.status(e.status).json({ error: e.message });
  }
});

app.get('/api/merra2/station-timeseries', async (req, res) => {
  try {
    const sitename = String(req.query.sitename || '').trim();
    const start = String(req.query.start || '').trim();
    const end = String(req.query.end || '').trim();
    const series = await getStationTimeseries({ sitename, start, end });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(series);
  } catch (err) {
    const e = toHttpError(err);
    console.error('[MERRA2 station-timeseries] Error:', e.message);
    res.status(e.status).json({ error: e.message });
  }
});

app.get('/api/merra2/station-list', async (_req, res) => {
  try {
    const stations = await getStationList();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ stations });
  } catch (err) {
    const e = toHttpError(err);
    console.error('[MERRA2 station-list] Error:', e.message);
    res.status(e.status).json({ error: e.message });
  }
});

app.get('/api/merra2/latest-date', async (_req, res) => {
  try {
    const latest = await getLatestStationDate();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(latest);
  } catch (err) {
    const e = toHttpError(err);
    console.error('[MERRA2 latest-date] Error:', e.message);
    res.status(e.status).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`[MERRA2 API] Running on http://localhost:${PORT}`);
  if (!process.env.MERRA2_PARQUET_DIR) {
    console.log(
      '[MERRA2 API] MERRA2_PARQUET_DIR is not set. Station endpoints will fail until parquet directory is configured.'
    );
  }
});
