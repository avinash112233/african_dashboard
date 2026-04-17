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

const app = express();
const PORT = process.env.MERRA2_API_PORT || 3001;

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

app.listen(PORT, () => {
  console.log(`[MERRA2 API] Running on http://localhost:${PORT}`);
  if (!process.env.EARTHDATA_USERNAME || !process.env.EARTHDATA_PASSWORD) {
    console.log('[MERRA2 API] No Earthdata credentials – using sample data. Set EARTHDATA_USERNAME and EARTHDATA_PASSWORD for real GES DISC data.');
  }
});
