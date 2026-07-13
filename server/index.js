import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import zlib from 'node:zlib';
import {
  encodeMerra2DailyCubeBinary,
  fetchMerra2DailyCube,
  fetchMerra2Grid,
  fetchMerra2NetcdfBuffer,
  resolveMerra2Granule,
} from './merra2.js';
import { getEarthdataAuthStatus, getEarthdataBearerToken } from './earthdataAuth.js';
import {
  getLatestStationDate,
  getStationList,
  getStationsForDate,
  getStationTimeseries,
  toHttpError,
} from './merra2Stations.js';
import { fetchWashUGrid, fetchWashUTimeseries, getWashUConfig } from './washu.js';
import {
  getOpenAqArchiveInfo,
  getOpenAqAuthStatus,
  getOpenAqLocationCatalog,
  getOpenAqMapStations,
  getOpenAqStationDay,
  getOpenAqTimeseries,
  proxyOpenAqV3,
  startOpenAqCacheWarmer,
  verifyOpenAqApiKey,
} from './openaq.js';
import { FIRMS_FIELDS, getFires7Day, startFirmsCacheWarmer } from './firms.js';

const app = express();
app.use(compression());
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

// FIRMS — compact 7-day Africa fire point feed (fetched + minified + cached server-side;
// avoids the browser downloading the raw ~50MB+ per-region WFS GeoJSON payload).
app.get('/api/firms/fires7day', async (_req, res) => {
  try {
    const { ts, points } = await getFires7Day();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ generatedAt: ts, count: points.length, fields: FIRMS_FIELDS, points });
  } catch (err) {
    console.error('[FIRMS fires7day] Error:', err.message);
    res.status(err.status ?? 502).json({ error: err.message || 'FIRMS fetch failed' });
  }
});

// FIRMS — fire hotspot WFS and CSV area API (cache WFS GET responses 15 min).
// Kept as a raw passthrough fallback for the CSV Area API path.
app.use('/api/firms', (req, res) => {
  const cacheable = req.method === 'GET' && /\/mapserver\/wfs\//.test(req.originalUrl);
  return proxyTo('https://firms.modaps.eosdis.nasa.gov', '/api/firms', req, res, 'FIRMS', { cacheable });
});

app.get('/api/merra2/granule', async (req, res) => {
  try {
    const dateParam = req.query.date || new Date().toISOString().slice(0, 10);
    const [y, m, d] = String(dateParam).split('-').map(Number);
    const year = Math.max(2000, y || new Date().getFullYear());
    const normalizedDate = `${year}-${String(m || 1).padStart(2, '0')}-${String(d || 1).padStart(2, '0')}`;
    const granule = await resolveMerra2Granule(normalizedDate);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(granule);
  } catch (err) {
    console.error('[MERRA2 granule] Error:', err.message);
    res.status(err.status ?? 500).json({ error: err.message || 'Granule lookup failed' });
  }
});

app.get('/api/merra2/earthdata-token', async (_req, res) => {
  try {
    const token = await getEarthdataBearerToken();
    if (!token) {
      return res.status(503).json({
        error: 'Earthdata credentials not configured. Set EARTHDATA_USERNAME/PASSWORD in .env.',
      });
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.json({
      token,
      expiresInSec: 300,
      hint:
        'Not used by the dashboard: GES DISC/CloudFront does not send CORS headers, so browsers ' +
        'cannot fetch NASA URLs directly. The backend downloads the granule and re-serves a ' +
        'quantized/compressed subset via /api/merra2/pm25/daily-cube.bin instead. This endpoint ' +
        'is kept for manual/scripted Earthdata access only.',
    });
  } catch (err) {
    console.error('[MERRA2 earthdata-token] Error:', err.message);
    res.status(500).json({ error: err.message || 'Earthdata token failed' });
  }
});

app.get('/api/merra2/pm25/nc4', async (req, res) => {
  try {
    const dateParam = req.query.date || new Date().toISOString().slice(0, 10);
    const [y, m, d] = String(dateParam).split('-').map(Number);
    const year = Math.max(2000, y || new Date().getFullYear());
    const normalizedDate = `${year}-${String(m || 1).padStart(2, '0')}-${String(d || 1).padStart(2, '0')}`;
    const { granuleFile, buffer, byteLength } = await fetchMerra2NetcdfBuffer(normalizedDate);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${granuleFile}"`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Length', String(byteLength));
    res.send(buffer);
  } catch (err) {
    console.error('[MERRA2 nc4] Error:', err.message);
    res.status(err.status ?? 500).json({ error: err.message || 'NetCDF download failed' });
  }
});

app.get('/api/merra2/pm25/daily-cube', async (req, res) => {
  try {
    const dateParam = req.query.date || new Date().toISOString().slice(0, 10);
    const [y, m, d] = String(dateParam).split('-').map(Number);
    const year = Math.max(2000, y || new Date().getFullYear());
    const normalizedDate = `${year}-${String(m || 1).padStart(2, '0')}-${String(d || 1).padStart(2, '0')}`;
    const cube = await fetchMerra2DailyCube(normalizedDate);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(cube);
  } catch (err) {
    console.error('[MERRA2 daily-cube] Error:', err.message);
    res.status(500).json({ error: err.message || 'MERRA2 daily cube fetch failed' });
  }
});

// Compact binary transport for the same daily cube — quantized Int16 + gzip instead of JSON text.
// Cuts egress from ~570KB (gzipped JSON) to roughly 100-150KB per date. Frontend uses this by
// default; the JSON route above stays available for debugging (curl/jq).
app.get('/api/merra2/pm25/daily-cube.bin', async (req, res) => {
  try {
    const dateParam = req.query.date || new Date().toISOString().slice(0, 10);
    const [y, m, d] = String(dateParam).split('-').map(Number);
    const year = Math.max(2000, y || new Date().getFullYear());
    const normalizedDate = `${year}-${String(m || 1).padStart(2, '0')}-${String(d || 1).padStart(2, '0')}`;
    const cube = await fetchMerra2DailyCube(normalizedDate);
    const packed = encodeMerra2DailyCubeBinary(cube);
    const gzipped = zlib.gzipSync(packed);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Length', String(gzipped.length));
    res.send(gzipped);
  } catch (err) {
    console.error('[MERRA2 daily-cube.bin] Error:', err.message);
    res.status(500).json({ error: err.message || 'MERRA2 daily cube fetch failed' });
  }
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

app.get('/api/washu/config', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(getWashUConfig());
});

app.get('/api/washu/pm25/grid', async (req, res) => {
  try {
    const period = String(req.query.period || 'monthly');
    const year = req.query.year;
    const month = req.query.month;
    const grid = await fetchWashUGrid({ period, year, month });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(grid);
  } catch (err) {
    const e = toHttpError(err);
    console.error('[WashU grid] Error:', e.message);
    res.status(e.status).json({ error: e.message });
  }
});

app.get('/api/washu/pm25/timeseries', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const startYear = req.query.startYear ?? req.query.start_year;
    const startMonth = req.query.startMonth ?? req.query.start_month ?? 1;
    const endYear = req.query.endYear ?? req.query.end_year;
    const endMonth = req.query.endMonth ?? req.query.end_month ?? 12;
    const series = await fetchWashUTimeseries({
      lat,
      lon,
      startYear,
      startMonth,
      endYear,
      endMonth,
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(series);
  } catch (err) {
    const e = toHttpError(err);
    console.error('[WashU timeseries] Error:', e.message);
    res.status(e.status).json({ error: e.message });
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

app.get('/api/openaq/locations', async (req, res) => {
  try {
    const monitorsOnly = String(req.query.monitorsOnly ?? '') === '1' || req.query.monitorsOnly === 'true';
    const payload = await getOpenAqLocationCatalog({ monitorsOnly });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(payload);
  } catch (err) {
    console.error('[OpenAQ locations] Error:', err.message);
    res.status(err.status ?? 500).json({ error: err.message || 'OpenAQ locations fetch failed' });
  }
});

app.get('/api/openaq/stations', async (req, res) => {
  try {
    const date = parseIsoDateParam(req.query.date, 'date');
    const mode = String(req.query.mode ?? 'latest').toLowerCase() === 'daily' ? 'daily' : 'latest';
    const monitorsOnly = String(req.query.monitorsOnly ?? '') === '1' || req.query.monitorsOnly === 'true';
    const payload = await getOpenAqMapStations({ date, mode, monitorsOnly });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    // Progressive daily fill updates the same URL — never let the browser keep the empty skeleton.
    res.setHeader('Cache-Control', 'no-store');
    res.json(payload);
  } catch (err) {
    console.error('[OpenAQ stations] Error:', err.message);
    res.status(err.status ?? 500).json({ error: err.message || 'OpenAQ stations fetch failed' });
  }
});

app.get('/api/openaq/timeseries', async (req, res) => {
  try {
    const sensorId = Number(req.query.sensorId);
    if (!Number.isFinite(sensorId)) {
      return res.status(400).json({ error: 'Missing or invalid query param: sensorId' });
    }
    const start = parseIsoDateParam(req.query.start, 'start');
    const end = parseIsoDateParam(req.query.end, 'end');
    const resolutionRaw = String(req.query.resolution ?? 'daily').toLowerCase();
    const resolution = ['daily', 'monthly', 'yearly'].includes(resolutionRaw) ? resolutionRaw : 'daily';
    const locationId = req.query.locationId != null ? Number(req.query.locationId) : undefined;
    const payload = await getOpenAqTimeseries({
      sensorId,
      start,
      end,
      resolution,
      locationId: Number.isFinite(locationId) ? locationId : undefined,
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', payload.source === 'archive' ? 'public, max-age=3600' : 'public, max-age=300');
    res.json(payload);
  } catch (err) {
    console.error('[OpenAQ timeseries] Error:', err.message);
    res.status(err.status ?? 500).json({ error: err.message || 'OpenAQ timeseries fetch failed' });
  }
});

app.get('/api/openaq/station-day', async (req, res) => {
  try {
    const sensorId = Number(req.query.sensorId);
    if (!Number.isFinite(sensorId)) {
      return res.status(400).json({ error: 'Missing or invalid query param: sensorId' });
    }
    const date = parseIsoDateParam(req.query.date, 'date');
    const payload = await getOpenAqStationDay({ sensorId, date });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(payload);
  } catch (err) {
    console.error('[OpenAQ station-day] Error:', err.message);
    res.status(err.status ?? 500).json({ error: err.message || 'OpenAQ station-day fetch failed' });
  }
});

app.get('/api/openaq/status', async (_req, res) => {
  const auth = getOpenAqAuthStatus();
  const verification = auth.ready
    ? await verifyOpenAqApiKey()
    : { ok: false, status: 0, message: 'OPENAQ_API_KEY is not set' };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({
    ...auth,
    verified: verification.ok,
    httpStatus: verification.status,
    message: verification.message,
    archive: getOpenAqArchiveInfo(),
  });
});

app.get('/api/openaq/archive-info', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(getOpenAqArchiveInfo());
});

app.use('/api/openaq/v3', (req, res) => proxyOpenAqV3(req, res));

app.listen(PORT, async () => {
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
  const openaq = getOpenAqAuthStatus();
  if (openaq.ready) {
    const verification = await verifyOpenAqApiKey();
    if (verification.ok) {
      console.log('[OpenAQ API] OPENAQ_API_KEY verified — ground station layer enabled.');
      startOpenAqCacheWarmer();
    } else {
      console.warn(
        `[OpenAQ API] OPENAQ_API_KEY is set but rejected by OpenAQ (HTTP ${verification.status}: ${verification.message}).`
      );
      console.warn('[OpenAQ API] Regenerate your key at https://explore.openaq.org/account → paste into .env → restart backend.');
      console.warn('[OpenAQ API] Quick check: npm run test:openaq');
    }
  } else {
    console.warn('[OpenAQ API] OPENAQ_API_KEY not set — OpenAQ endpoints will fail.');
  }
  startFirmsCacheWarmer();
});
