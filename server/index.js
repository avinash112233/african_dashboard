import 'dotenv/config';
import express from 'express';
import { fetchMerra2Grid } from './merra2.js';
import { getEarthdataAuthStatus } from './earthdataAuth.js';
import {
  getLatestStationDate,
  getStationList,
  getStationsForDate,
  getStationTimeseries,
  toHttpError,
} from './merra2Stations.js';

const app = express();
const PORT = process.env.MERRA2_API_PORT || 3001;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDateParam(value, fieldName = 'date') {
  const trimmed = String(value ?? '').trim();
  if (!ISO_DATE_RE.test(trimmed)) {
    const err = new Error(`Invalid ${fieldName}. Expected YYYY-MM-DD.`);
    err.status = 400;
    throw err;
  }
  return trimmed;
}

// Generic proxy helper — strips the local prefix and forwards to an upstream host.
const PROXY_CACHE_TTL_MS = 15 * 60 * 1000;
const proxyResponseCache = new Map();

async function proxyTo(upstream, stripPrefix, req, res, tag, { cacheable = false } = {}) {
  try {
    const pathAndQuery = req.originalUrl.replace(new RegExp(`^${stripPrefix}`), '') || '/';
    const target = `${upstream}${pathAndQuery.startsWith('/') ? '' : '/'}${pathAndQuery}`;
    const cacheKey = cacheable && req.method === 'GET' ? `${tag}:${target}` : null;

    if (cacheKey) {
      const hit = proxyResponseCache.get(cacheKey);
      if (hit && Date.now() - hit.ts < PROXY_CACHE_TTL_MS) {
        if (hit.contentType) res.setHeader('Content-Type', hit.contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('X-Proxy-Cache', 'HIT');
        res.status(hit.status);
        res.send(hit.body);
        return;
      }
    }

    const up = await fetch(target, {
      method: req.method,
      headers: { 'User-Agent': 'african-dashboard/1.0' },
    });
    const ct = up.headers.get('content-type');
    const body = Buffer.from(await up.arrayBuffer());
    if (ct) res.setHeader('Content-Type', ct);
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (cacheKey && up.ok) {
      proxyResponseCache.set(cacheKey, {
        ts: Date.now(),
        status: up.status,
        contentType: ct,
        body,
      });
      res.setHeader('X-Proxy-Cache', 'MISS');
    }
    res.status(up.status);
    res.send(body);
  } catch (err) {
    console.error(`[${tag} proxy] Error:`, err);
    res.status(502).json({ error: err?.message || `${tag} proxy failed` });
  }
}

// AERONET + AAQE GeoJSON — same NASA host, one proxy covers both.
app.use('/api/aeronet', (req, res) =>
  proxyTo('https://aeronet.gsfc.nasa.gov', '/api/aeronet', req, res, 'AERONET')
);

// FIRMS — fire hotspot WFS and CSV area API (cache WFS GET responses 15 min).
app.use('/api/firms', (req, res) => {
  const cacheable = req.method === 'GET' && /\/mapserver\/wfs\//.test(req.originalUrl);
  return proxyTo('https://firms.modaps.eosdis.nasa.gov', '/api/firms', req, res, 'FIRMS', { cacheable });
});

app.get('/api/merra2/pm25/grid', async (req, res) => {
  try {
    const dateParam = req.query.date || new Date().toISOString().slice(0, 10);
    const [y, m, d] = dateParam.split('-').map(Number);
    // Floor at dataset start year; no upper cap so newly published years work automatically.
    const year = Math.max(2000, y || new Date().getFullYear());
    const normalizedDate = `${year}-${String(m || 1).padStart(2, '0')}-${String(d || 1).padStart(2, '0')}`;
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
    const dateParam = parseIsoDateParam(req.query.date, 'date');
    const stations = await getStationsForDate(dateParam);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ date: dateParam, stations, count: stations.length });
  } catch (err) {
    const e = toHttpError(err);
    console.error('[MERRA2 stations] Error:', e.message);
    res.status(e.status).json({ error: e.message });
  }
});

app.get('/api/merra2/station-timeseries', async (req, res) => {
  try {
    const sitename = String(req.query.sitename || '').trim();
    if (!sitename) {
      return res.status(400).json({ error: 'Missing required query param: sitename' });
    }
    const start = parseIsoDateParam(req.query.start, 'start');
    const end = parseIsoDateParam(req.query.end, 'end');
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
  const auth = getEarthdataAuthStatus();
  if (auth.ready) {
    console.log(`[MERRA2 API] Earthdata auth: ${auth.mode} (Bearer token for OPeNDAP)`);
  } else {
    console.warn('[MERRA2 API] Earthdata auth not configured — CNN grid will use sample data.');
  }
  if (!process.env.MERRA2_PARQUET_DIR) {
    console.warn('[MERRA2 API] MERRA2_PARQUET_DIR not set — station endpoints will fail.');
  }
});
