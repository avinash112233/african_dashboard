/**
 * OpenAQ v3 — Africa PM2.5 ground stations.
 * Requires OPENAQ_API_KEY in .env (server-side only).
 *
 * Rate-limit safety: OpenAQ enforces 60 req/min & 2,000 req/hour per key, and its terms
 * prohibit "running in perpetuity" background polling. A previous key was suspended for
 * both. We now (1) hard-throttle every live API call through a shared limiter well under
 * those caps, (2) route all historical data through the free/unlimited S3 archive
 * (openaqArchive.js) instead of per-station API calls, and (3) only warm the cache once at
 * boot — subsequent refreshes are request-driven (stale-while-revalidate), never a timer.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  aggregateDailyToResolution,
  archiveCutoffDate,
  getArchiveDailySeries,
  getArchiveDayForLocations,
  getOpenAqArchiveInfo,
  loadDayPm25Map,
  nextDayStr,
  saveDayPm25Map,
} from './openaqArchive.js';

const OPENAQ_BASE = 'https://api.openaq.org';
const PM25_PARAMETER_ID = 2;
/** minLon,minLat,maxLon,maxLat (WGS84) */
export const AFRICA_BBOX = '-25,-35,55,38';

const LOCATIONS_TTL_MS = 24 * 60 * 60 * 1000;
const MAP_CACHE_TTL_MS = 60 * 60 * 1000;
const SERIES_CACHE_TTL_MS = 30 * 60 * 1000;
const WARM_INTERVAL_MS = 60 * 60 * 1000; // "how stale before request-driven revalidation" — no perpetual timer uses this.
const LOCATIONS_DISK_PATH = path.join(process.cwd(), '.cache', 'openaq', 'africa-locations.json');
let locationsRefreshInflight = null;

// Global request throttle shared by every live OpenAQ call (stays comfortably under
// OpenAQ's 60/min and 2,000/hour limits regardless of how many call sites fire at once).
const MAX_PER_MINUTE = Number(process.env.OPENAQ_MAX_REQUESTS_PER_MIN || 45);
const MAX_PER_HOUR = Number(process.env.OPENAQ_MAX_REQUESTS_PER_HOUR || 1500);
const minuteWindow = [];
const hourWindow = [];

async function throttleOpenAqRequest() {
  const now = Date.now();
  while (minuteWindow.length && now - minuteWindow[0] > 60_000) minuteWindow.shift();
  while (hourWindow.length && now - hourWindow[0] > 3_600_000) hourWindow.shift();

  if (minuteWindow.length >= MAX_PER_MINUTE) {
    await sleep(60_000 - (now - minuteWindow[0]) + 25);
    return throttleOpenAqRequest();
  }
  if (hourWindow.length >= MAX_PER_HOUR) {
    await sleep(3_600_000 - (now - hourWindow[0]) + 25);
    return throttleOpenAqRequest();
  }
  minuteWindow.push(Date.now());
  hourWindow.push(Date.now());
}

let locationsCache = null;
const mapStationsCache = new Map();
const seriesCache = new Map();
const inflightMap = new Map();
const inflightDailyEnrich = new Map();
let warmInflight = null;

/** Pre-warmed latest PM2.5 values keyed by sensorId — merged with location catalog on serve. */
let warmedLatest = {
  ts: 0,
  all: new Map(),
  monitors: new Map(),
};

function getApiKey() {
  const key = process.env.OPENAQ_API_KEY?.trim();
  if (!key) {
    const err = new Error('OPENAQ_API_KEY is not set. Add it to .env and restart the backend.');
    err.status = 503;
    throw err;
  }
  return key;
}

function pickUtcDatetime(obj) {
  if (!obj) return null;
  if (typeof obj === 'string') return obj;
  return obj.utc ?? obj.local ?? null;
}

function roundPm25(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  return Math.round(Number(value) * 100) / 100;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openaqFetch(path, params = {}, attempt = 0) {
  const url = new URL(path.startsWith('http') ? path : `${OPENAQ_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }

  await throttleOpenAqRequest();
  const res = await fetch(url, {
    headers: {
      'X-API-Key': getApiKey(),
      'User-Agent': 'african-dashboard/1.0',
      Accept: 'application/json',
    },
  });

  // Proactively back off if OpenAQ tells us we're close to the limit, instead of waiting for a 429.
  const remaining = Number(res.headers.get('x-ratelimit-remaining'));
  if (Number.isFinite(remaining) && remaining <= 2) {
    const resetSec = Number(res.headers.get('x-ratelimit-reset'));
    await sleep((Number.isFinite(resetSec) ? resetSec : 5) * 1000);
  }

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    const err = new Error(`OpenAQ returned non-JSON (${res.status})`);
    err.status = res.status >= 400 ? res.status : 502;
    throw err;
  }

  if (res.status === 429 && attempt < 4) {
    await sleep(800 * (attempt + 1));
    return openaqFetch(path, params, attempt + 1);
  }

  if (!res.ok) {
    const detail = json?.detail ?? json?.message ?? json?.error ?? res.statusText;
    const err = new Error(typeof detail === 'string' ? detail : `OpenAQ HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  return json;
}

async function fetchAllPages(path, baseParams = {}, maxPages = 30) {
  const all = [];
  let page = 1;
  const pageLimit = 100;
  while (page <= maxPages) {
    const json = await openaqFetch(path, { ...baseParams, page, limit: pageLimit });
    const batch = Array.isArray(json.results) ? json.results : [];
    all.push(...batch);
    if (batch.length < pageLimit) break;
    page += 1;
  }
  return all;
}

function pm25SensorFromLocation(location) {
  const sensors = Array.isArray(location?.sensors) ? location.sensors : [];
  return sensors.find((s) => s?.parameter?.name === 'pm25' || s?.parameter?.id === PM25_PARAMETER_ID) ?? null;
}

function locationMeta(location) {
  const sensor = pm25SensorFromLocation(location);
  if (!sensor?.id) return null;
  const lat = location.coordinates?.latitude;
  const lon = location.coordinates?.longitude;
  if (lat == null || lon == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lon))) return null;

  return {
    locationId: location.id,
    sensorId: sensor.id,
    name: location.name ?? `Location ${location.id}`,
    locality: location.locality ?? null,
    country: location.country?.name ?? location.country?.code ?? null,
    latitude: Number(lat),
    longitude: Number(lon),
    isMonitor: Boolean(location.isMonitor),
    provider: location.provider?.name ?? null,
    datetimeLast: pickUtcDatetime(location.datetimeLast),
  };
}

function loadLocationsFromDisk() {
  if (!existsSync(LOCATIONS_DISK_PATH)) return null;
  try {
    const json = JSON.parse(readFileSync(LOCATIONS_DISK_PATH, 'utf8'));
    return Array.isArray(json?.rows) && json.rows.length > 0 ? json.rows : null;
  } catch {
    return null;
  }
}

function saveLocationsToDisk(rows) {
  mkdirSync(path.dirname(LOCATIONS_DISK_PATH), { recursive: true });
  writeFileSync(
    LOCATIONS_DISK_PATH,
    JSON.stringify({ savedAt: new Date().toISOString(), count: rows.length, rows })
  );
}

async function fetchAfricaLocationsFromApi() {
  const raw = await fetchAllPages('/v3/locations', {
    bbox: AFRICA_BBOX,
    parameters_id: PM25_PARAMETER_ID,
  });
  const rows = raw.map(locationMeta).filter(Boolean);
  locationsCache = { ts: Date.now(), rows };
  try {
    saveLocationsToDisk(rows);
  } catch {
    /* non-fatal */
  }
  return rows;
}

function refreshAfricaLocationsInBackground() {
  if (locationsRefreshInflight) return locationsRefreshInflight;
  locationsRefreshInflight = fetchAfricaLocationsFromApi()
    .catch((err) => {
      console.warn('[OpenAQ] Background locations refresh failed:', err.message);
    })
    .finally(() => {
      locationsRefreshInflight = null;
    });
  return locationsRefreshInflight;
}

async function getAfricaLocations({ monitorsOnly = false } = {}) {
  const now = Date.now();
  if (locationsCache && now - locationsCache.ts < LOCATIONS_TTL_MS) {
    const rows = locationsCache.rows;
    return monitorsOnly ? rows.filter((r) => r.isMonitor) : rows;
  }

  // Prefer disk catalog so daily map date changes never wait on the live locations API.
  const diskRows = loadLocationsFromDisk();
  if (diskRows) {
    locationsCache = { ts: now, rows: diskRows };
    if (!locationsRefreshInflight) refreshAfricaLocationsInBackground();
    return monitorsOnly ? diskRows.filter((r) => r.isMonitor) : diskRows;
  }

  const rows = await fetchAfricaLocationsFromApi();
  return monitorsOnly ? rows.filter((r) => r.isMonitor) : rows;
}

/** Instant metadata-only list (no PM2.5 values) for progressive map render. */
export async function getOpenAqLocationCatalog({ monitorsOnly = false } = {}) {
  const locations = await getAfricaLocations({ monitorsOnly });
  return {
    monitorsOnly,
    count: locations.length,
    locations,
  };
}

function stationRecord(location, mode, reading = null) {
  if (reading?.value != null) {
    return {
      ...location,
      pm25: reading.value,
      datetime: reading.datetime,
      mode,
      hasReading: true,
    };
  }
  return {
    ...location,
    pm25: null,
    // For daily mode, do not reuse datetimeLast — that is "last telemetry", not the map date.
    datetime: mode === 'daily' ? '' : (location.datetimeLast ?? ''),
    mode,
    hasReading: false,
  };
}

async function poolMap(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index;
      index += 1;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/**
 * Bulk global "latest" feed for the pm25 parameter — one endpoint covers every sensor
 * worldwide (~26k, ~26 pages at limit=1000), which we then filter down to our Africa
 * catalog locally. This replaces what used to be one HTTP call per station (the N+1
 * pattern that got the previous key suspended) with a small, fixed number of bulk calls
 * regardless of how many African stations we track.
 */
async function fetchAllLatestPm25Readings(maxPages = 50) {
  const all = [];
  let page = 1;
  const limit = 1000;
  while (page <= maxPages) {
    const json = await openaqFetch(`/v3/parameters/${PM25_PARAMETER_ID}/latest`, { limit, page });
    const batch = Array.isArray(json.results) ? json.results : [];
    all.push(...batch);
    if (batch.length < limit) break;
    page += 1;
  }
  return all;
}

/** Keep only readings whose UTC calendar day matches the selected map date. */
function readingMatchesSelectedDate(datetimeIso, date) {
  if (!datetimeIso || !date) return false;
  return String(datetimeIso).slice(0, 10) === date;
}

/** Drop ancient OpenAQ "latest" values (inactive sensors) from the warm pool. */
function isUsableNrtReading(datetimeIso, nowMs = Date.now()) {
  if (!datetimeIso) return false;
  const ts = Date.parse(datetimeIso);
  if (!Number.isFinite(ts)) return false;
  const maxAgeMs = Number(process.env.OPENAQ_NRT_WARM_MAX_AGE_DAYS || 7) * 24 * 60 * 60 * 1000;
  return nowMs - ts <= maxAgeMs;
}

/**
 * Bulk latest crawl for Africa. Returns all recent readings (not date-filtered).
 * Callers filter to the selected calendar day when packing the map response.
 */
async function fetchLatestStations({ monitorsOnly = false } = {}) {
  const locations = await getAfricaLocations({ monitorsOnly });
  const bySensor = new Map(locations.map((loc) => [loc.sensorId, loc]));
  const nowMs = Date.now();

  const globalLatest = await fetchAllLatestPm25Readings();
  const hits = new Map();
  for (const row of globalLatest) {
    const sensorId = row.sensorsId ?? row.sensorId ?? row.sensors_id;
    const loc = bySensor.get(sensorId);
    if (!loc || row.value == null) continue;
    const datetime = pickUtcDatetime(row.datetime) ?? loc.datetimeLast ?? null;
    if (!isUsableNrtReading(datetime, nowMs)) continue;
    hits.set(sensorId, {
      value: roundPm25(row.value),
      datetime,
    });
  }

  return locations.map((loc) => stationRecord(loc, 'latest', hits.get(loc.sensorId) ?? null));
}

function filterStationsToSelectedDate(stations, date) {
  return stations.map((s) => {
    if (s.hasReading && s.pm25 != null && readingMatchesSelectedDate(s.datetime, date)) {
      return s;
    }
    return stationRecord(s, 'latest');
  });
}

function fetchDailyStationsArchiveOnly(locations, date) {
  const dayMap = loadDayPm25Map(date);
  if (dayMap?.byLocationId) {
    return Promise.resolve(
      locations.map((loc) => {
        const hit = dayMap.byLocationId[String(loc.locationId)];
        if (!hit || hit.missing || hit.mean == null) return stationRecord(loc, 'daily');
        return stationRecord(loc, 'daily', { value: hit.mean, datetime: `${date}T12:00:00Z` });
      })
    );
  }

  return getArchiveDayForLocations(locations, date).then((results) => {
    const byLocationId = {};
    const stations = results.map(({ loc, day }) => {
      if (!day || day.missing || day.mean == null) {
        byLocationId[String(loc.locationId)] = { missing: true, mean: null };
        return stationRecord(loc, 'daily');
      }
      byLocationId[String(loc.locationId)] = { missing: false, mean: day.mean };
      return stationRecord(loc, 'daily', { value: day.mean, datetime: `${date}T12:00:00Z` });
    });
    try {
      saveDayPm25Map(date, byLocationId);
    } catch {
      /* non-fatal */
    }
    return stations;
  });
}

function dailyFallbackEligible(date) {
  const today = new Date().toISOString().slice(0, 10);
  if (date >= today) return false;
  const daysAgo = countDaysInclusive(date, today) - 1;
  const maxFallbackAgeDays = Number(process.env.OPENAQ_DAILY_FALLBACK_MAX_AGE_DAYS || 120);
  return daysAgo > 0 && daysAgo <= maxFallbackAgeDays;
}

function missingDailyEnrichmentTargets(stations, locations, date) {
  const maxLagDays = Number(process.env.OPENAQ_DAILY_FALLBACK_MAX_LAG_DAYS || 14);
  return stations
    .map((station, index) => ({ station, loc: locations[index] }))
    .filter(({ station, loc }) => {
      if (station.hasReading && station.pm25 != null) return false;
      const lastKnown = loc.datetimeLast?.slice(0, 10);
      if (!lastKnown || lastKnown < date) return false;
      const lagDays = countDaysInclusive(date, lastKnown) - 1;
      return lagDays <= maxLagDays;
    })
    .sort((a, b) => {
      const lagA = countDaysInclusive(date, a.loc.datetimeLast?.slice(0, 10) ?? date) - 1;
      const lagB = countDaysInclusive(date, b.loc.datetimeLast?.slice(0, 10) ?? date) - 1;
      if (lagA !== lagB) return lagA - lagB;
      return Number(b.loc.isMonitor) - Number(a.loc.isMonitor);
    });
}

async function fetchDailyStations(date, { monitorsOnly = false } = {}) {
  const locations = await getAfricaLocations({ monitorsOnly });
  const today = new Date().toISOString().slice(0, 10);
  if (date >= today) {
    return locations.map((loc) => stationRecord(loc, 'daily'));
  }

  const stations = await fetchDailyStationsArchiveOnly(locations, date);
  if (!dailyFallbackEligible(date)) return stations;

  await enrichDailyStationsFromLiveApi(stations, locations, date);
  return stations;
}

function packMapResponse(date, mode, monitorsOnly, stations, { enrichmentPending = false } = {}) {
  const withReadingCount = stations.filter((s) => s.hasReading && s.pm25 != null).length;
  return {
    date,
    mode,
    monitorsOnly,
    count: withReadingCount,
    totalLocations: stations.length,
    withReadingCount,
    enrichmentPending,
    stations,
  };
}

function isLegacyEmptyCache(hit) {
  const data = hit?.data;
  if (!data) return false;
  return data.totalLocations == null && data.count === 0 && (!data.stations || data.stations.length === 0);
}

async function buildLatestFromWarm(date, monitorsOnly) {
  const locations = await getAfricaLocations({ monitorsOnly });
  const warmed = monitorsOnly ? warmedLatest.monitors : warmedLatest.all;
  return locations.map((loc) => {
    const hit = warmed.get(loc.sensorId);
    if (!hit || !readingMatchesSelectedDate(hit.datetime, date)) {
      return stationRecord(loc, 'latest');
    }
    return hit;
  });
}

function storeMapCache(cacheKey, data) {
  mapStationsCache.set(cacheKey, { ts: Date.now(), data });
}

/**
 * Single-day PM2.5: try OpenAQ `/days` rollup first (1 call), then hourly aggregation.
 */
async function fetchDailyForDate(sensorId, date) {
  try {
    const raw = await fetchAllPages(seriesPath(sensorId, 'daily'), { date_from: date, date_to: date }, 2);
    const fromDays = raw.map((row) => normalizeSeriesPoint(row, 'daily')).find(Boolean);
    if (fromDays) return fromDays;
  } catch (err) {
    console.warn(`[OpenAQ] /days failed for sensor ${sensorId} on ${date}:`, err.message);
  }

  try {
    const hourPoints = await fetchDailyFromHours(sensorId, date, date);
    return hourPoints.find((p) => p.date === date) ?? null;
  } catch (err) {
    console.warn(`[OpenAQ] /hours failed for sensor ${sensorId} on ${date}:`, err.message);
    return null;
  }
}

/**
 * Fill map markers from live API when the S3 archive has not published a station yet.
 * Mutates `stations` in place. Returns how many targets remain after optional time budget.
 */
async function enrichDailyStationsFromLiveApi(
  stations,
  locations,
  date,
  { only, shouldStop, timeBudgetMs, onProgress } = {}
) {
  const targets = only ?? missingDailyEnrichmentTargets(stations, locations, date);
  if (targets.length === 0) return { enriched: 0, remaining: 0 };

  const concurrency = Number(process.env.OPENAQ_DAILY_FALLBACK_CONCURRENCY || 10);
  const deadline = timeBudgetMs ? Date.now() + timeBudgetMs : null;
  let index = 0;
  let active = 0;
  let enriched = 0;

  return new Promise((resolve) => {
    const finish = (remaining) => resolve({ enriched, remaining });

    const pump = () => {
      if (shouldStop?.()) {
        if (active === 0) finish(targets.length - index);
        return;
      }
      if (deadline && Date.now() > deadline) {
        if (active === 0) finish(targets.length - index);
        return;
      }

      while (active < concurrency && index < targets.length) {
        if (shouldStop?.()) break;
        if (deadline && Date.now() > deadline) break;

        const { station, loc } = targets[index];
        index += 1;
        active += 1;

        fetchDailyForDate(loc.sensorId, date)
          .then((hit) => {
            if (!hit) return;
            const idx = stations.findIndex((s) => s.sensorId === station.sensorId);
            if (idx >= 0) {
              stations[idx] = stationRecord(loc, 'daily', {
                value: hit.pm25,
                datetime: hit.datetime,
              });
              enriched += 1;
              onProgress?.();
            }
          })
          .catch(() => {})
          .finally(() => {
            active -= 1;
            if (index >= targets.length && active === 0) {
              finish(0);
            } else {
              pump();
            }
          });
      }
    };

    pump();
  });
}

async function refreshMapStations(cacheKey, { date, mode, monitorsOnly }) {
  if (mode === 'latest') {
    const locations = await getAfricaLocations({ monitorsOnly });
    const today = new Date().toISOString().slice(0, 10);
    // Instant skeleton so NRT never blocks the HTTP response on the bulk OpenAQ latest crawl.
    let stations = locations.map((loc) => stationRecord(loc, 'latest'));
    let data = packMapResponse(date, mode, monitorsOnly, stations, { enrichmentPending: true });
    storeMapCache(cacheKey, data);

    if (!inflightDailyEnrich.has(cacheKey)) {
      const fillPromise = (async () => {
        try {
          const warmPool = monitorsOnly ? warmedLatest.monitors : warmedLatest.all;
          const canUseWarm =
            warmedLatest.ts > 0 &&
            warmPool.size > 0 &&
            [...warmPool.values()].some((s) => readingMatchesSelectedDate(s.datetime, date));

          if (canUseWarm) {
            stations = await buildLatestFromWarm(date, monitorsOnly);
          } else if (date < today && date <= archiveCutoffDate()) {
            // Older than archive lag: use historical daily for that calendar day.
            const daily = await fetchDailyStations(date, { monitorsOnly });
            stations = daily.map((s) => ({ ...s, mode: 'latest' }));
          } else {
            // Today / recent: crawl bulk latest, then keep only the selected UTC day.
            const allRecent = await fetchLatestStations({ monitorsOnly });
            const withReadings = allRecent.filter((s) => s.hasReading && s.pm25 != null);
            const map = new Map(withReadings.map((s) => [s.sensorId, s]));
            if (monitorsOnly) warmedLatest.monitors = map;
            else warmedLatest.all = map;
            warmedLatest.ts = Date.now();
            stations = filterStationsToSelectedDate(allRecent, date);
          }

          data = packMapResponse(date, mode, monitorsOnly, stations, { enrichmentPending: false });
          storeMapCache(cacheKey, data);
          const colored = stations.filter((s) => s.hasReading && s.pm25 != null);
          console.log(
            `[OpenAQ] Latest map ready for ${date} (${colored.length} readings / ${stations.length} locations).`
          );
          return data;
        } catch (err) {
          console.warn('[OpenAQ] Latest fill failed:', err.message);
          data = packMapResponse(date, mode, monitorsOnly, stations, { enrichmentPending: false });
          storeMapCache(cacheKey, data);
          return data;
        } finally {
          inflightDailyEnrich.delete(cacheKey);
        }
      })();
      inflightDailyEnrich.set(cacheKey, fillPromise);
    }

    return data;
  }

  const locations = await getAfricaLocations({ monitorsOnly });
  // Instant skeleton so the HTTP response is not blocked on ~980 S3 archive downloads.
  let stations = locations.map((loc) => stationRecord(loc, 'daily'));
  let data = packMapResponse(date, mode, monitorsOnly, stations, { enrichmentPending: true });
  storeMapCache(cacheKey, data);

  // Defer heavy archive work so the skeleton response can flush to the client first.
  // Sync disk I/O from 40 parallel S3 downloads otherwise blocks the Node event loop.
  if (!inflightDailyEnrich.has(cacheKey)) {
    const fillPromise = new Promise((resolve) => {
      setImmediate(async () => {
        try {
          const dayMap = loadDayPm25Map(date);
          if (dayMap?.byLocationId) {
            stations = locations.map((loc) => {
              const hit = dayMap.byLocationId[String(loc.locationId)];
              if (!hit || hit.missing || hit.mean == null) return stationRecord(loc, 'daily');
              return stationRecord(loc, 'daily', { value: hit.mean, datetime: `${date}T12:00:00Z` });
            });
            data = packMapResponse(date, mode, monitorsOnly, stations, { enrichmentPending: false });
            storeMapCache(cacheKey, data);
          } else {
            const byLocationId = {};
            await getArchiveDayForLocations(locations, date, {
              onBatch: (partialResults) => {
                for (let i = 0; i < partialResults.length; i++) {
                  const row = partialResults[i];
                  if (!row) continue;
                  const { loc, day } = row;
                  if (!day || day.missing || day.mean == null) {
                    byLocationId[String(loc.locationId)] = { missing: true, mean: null };
                    stations[i] = stationRecord(loc, 'daily');
                  } else {
                    byLocationId[String(loc.locationId)] = { missing: false, mean: day.mean };
                    stations[i] = stationRecord(loc, 'daily', {
                      value: day.mean,
                      datetime: `${date}T12:00:00Z`,
                    });
                  }
                }
                data = packMapResponse(date, mode, monitorsOnly, stations, { enrichmentPending: true });
                storeMapCache(cacheKey, data);
              },
            });
            try {
              saveDayPm25Map(date, byLocationId);
            } catch {
              /* non-fatal */
            }
            data = packMapResponse(date, mode, monitorsOnly, stations, { enrichmentPending: false });
            storeMapCache(cacheKey, data);
          }

          if (!dailyFallbackEligible(date)) {
            resolve(data);
            return;
          }

          const missingAll = missingDailyEnrichmentTargets(stations, locations, date);
          const maxStations = Number(process.env.OPENAQ_DAILY_FALLBACK_MAX_STATIONS || 60);
          const missing = missingAll.slice(0, maxStations);
          if (missing.length === 0) {
            resolve(data);
            return;
          }

          data = packMapResponse(date, mode, monitorsOnly, stations, { enrichmentPending: true });
          storeMapCache(cacheKey, data);

          await enrichDailyStationsFromLiveApi(stations, locations, date, {
            only: missing,
            onProgress: () => {
              const partial = packMapResponse(date, mode, monitorsOnly, stations, { enrichmentPending: true });
              storeMapCache(cacheKey, partial);
            },
          });

          const stillMissing = missingDailyEnrichmentTargets(stations, locations, date);
          data = packMapResponse(date, mode, monitorsOnly, stations, {
            enrichmentPending: stillMissing.length > 0,
          });
          storeMapCache(cacheKey, data);
          resolve(data);
        } catch (err) {
          console.warn('[OpenAQ] Daily archive fill failed:', err.message);
          data = packMapResponse(date, mode, monitorsOnly, stations, { enrichmentPending: false });
          storeMapCache(cacheKey, data);
          resolve(data);
        } finally {
          inflightDailyEnrich.delete(cacheKey);
        }
      });
    });
    inflightDailyEnrich.set(cacheKey, fillPromise);
  }

  return data;
}

export async function warmOpenAqCache() {
  if (!process.env.OPENAQ_API_KEY?.trim()) return;
  if (warmInflight) return warmInflight;

  warmInflight = (async () => {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const keyAll = `latest:${today}:0`;
      const keyMon = `latest:${today}:1`;
      // Kick progressive fills (returns skeleton immediately).
      await refreshMapStations(keyAll, { date: today, mode: 'latest', monitorsOnly: false });
      await refreshMapStations(keyMon, { date: today, mode: 'latest', monitorsOnly: true });
      // Wait for the bulk latest crawl to finish so NRT can color from warm cache.
      await Promise.all(
        [inflightDailyEnrich.get(keyAll), inflightDailyEnrich.get(keyMon)].filter(Boolean)
      );
      console.log(
        `[OpenAQ] Warm cache ready (${warmedLatest.all.size} readings, ${(await getAfricaLocations()).length} Africa PM2.5 locations).`
      );
    } catch (err) {
      if (/invalid credentials|unauthorized/i.test(err.message)) {
        console.warn(
          '[OpenAQ] Warm cache failed: API key rejected by OpenAQ (401). Regenerate at https://explore.openaq.org/account and update OPENAQ_API_KEY in .env, then restart the backend.'
        );
      } else {
        console.warn('[OpenAQ] Warm cache failed:', err.message);
      }
    } finally {
      warmInflight = null;
    }
  })();

  return warmInflight;
}

export function startOpenAqCacheWarmer() {
  if (!process.env.OPENAQ_API_KEY?.trim()) return;
  // Seed the Africa location catalog first (disk/memory) so Historical daily map date
  // changes never wait behind the bulk "latest" warm-up on the shared rate limiter.
  getAfricaLocations()
    .then((rows) => {
      console.log(`[OpenAQ] Africa location catalog ready (${rows.length} PM2.5 locations).`);
    })
    .catch((err) => {
      console.warn('[OpenAQ] Locations seed failed:', err.message);
    })
    .finally(() => {
      warmOpenAqCache();
    });
}

export async function getOpenAqMapStations({ date, mode = 'latest', monitorsOnly = false } = {}) {
  if (!date) {
    const err = new Error('Missing required query param: date');
    err.status = 400;
    throw err;
  }

  const cacheKey = `${mode}:${date}:${monitorsOnly ? '1' : '0'}`;
  const hit = mapStationsCache.get(cacheKey);
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // Progressive fill (daily + latest): always return the newest in-memory snapshot.
  if ((mode === 'daily' || mode === 'latest') && hit && !isLegacyEmptyCache(hit)) {
    if (!inflightMap.has(cacheKey) && !inflightDailyEnrich.has(cacheKey) && hit.data?.enrichmentPending) {
      inflightMap.set(
        cacheKey,
        refreshMapStations(cacheKey, { date, mode, monitorsOnly }).finally(() => inflightMap.delete(cacheKey))
      );
    }
    return hit.data;
  }

  // Latest + warm cache: color immediately for the selected UTC day only.
  if (mode === 'latest' && warmedLatest.ts > 0 && date >= today) {
    const stations = await buildLatestFromWarm(date, monitorsOnly);
    const data = packMapResponse(date, mode, monitorsOnly, stations, { enrichmentPending: false });
    storeMapCache(cacheKey, data);
    if (now - warmedLatest.ts > WARM_INTERVAL_MS && !warmInflight) {
      warmOpenAqCache();
    }
    return data;
  }

  // Daily / latest cold start (or past NRT date): never block HTTP on heavy fills.
  if (mode === 'daily' || mode === 'latest') {
    if (!inflightMap.has(cacheKey)) {
      inflightMap.set(
        cacheKey,
        refreshMapStations(cacheKey, { date, mode, monitorsOnly }).finally(() => inflightMap.delete(cacheKey))
      );
    }

    const fresh = mapStationsCache.get(cacheKey);
    if (fresh?.data) return fresh.data;

    const locations = await getAfricaLocations({ monitorsOnly });
    const stations = locations.map((loc) => stationRecord(loc, mode));
    const data = packMapResponse(date, mode, monitorsOnly, stations, { enrichmentPending: true });
    storeMapCache(cacheKey, data);
    return data;
  }

  // Stale-while-revalidate for any other modes.
  if (hit && !isLegacyEmptyCache(hit)) {
    if (!inflightMap.has(cacheKey)) {
      inflightMap.set(
        cacheKey,
        refreshMapStations(cacheKey, { date, mode, monitorsOnly }).finally(() => inflightMap.delete(cacheKey))
      );
    }
    return hit.data;
  }

  if (inflightMap.has(cacheKey)) {
    return inflightMap.get(cacheKey);
  }

  const promise = refreshMapStations(cacheKey, { date, mode, monitorsOnly }).finally(() =>
    inflightMap.delete(cacheKey)
  );
  inflightMap.set(cacheKey, promise);
  return promise;
}

function seriesPath(sensorId, resolution) {
  switch (resolution) {
    case 'monthly':
      return `/v3/sensors/${sensorId}/days/monthly`;
    case 'yearly':
      return `/v3/sensors/${sensorId}/days/yearly`;
    case 'daily':
    default:
      return `/v3/sensors/${sensorId}/days`;
  }
}

function seriesDateParams(resolution, start, end) {
  if (resolution === 'daily') {
    return { date_from: start, date_to: end };
  }
  return {
    datetime_from: `${start}T00:00:00Z`,
    datetime_to: `${end}T23:59:59Z`,
  };
}

function normalizeSeriesPoint(row, resolution) {
  const value = roundPm25(row.value);
  if (value == null) return null;
  const from = pickUtcDatetime(row.period?.datetimeFrom) ?? pickUtcDatetime(row.datetimeFrom);
  if (!from) return null;
  const date =
    resolution === 'monthly'
      ? from.slice(0, 7)
      : resolution === 'yearly'
        ? from.slice(0, 4)
        : from.slice(0, 10);
  return { date, datetime: from, pm25: value };
}

const MIN_VALID_PM25 = -100;
const MAX_VALID_PM25 = 3000;

function isPlausiblePm25(value) {
  return Number.isFinite(value) && value >= MIN_VALID_PM25 && value <= MAX_VALID_PM25;
}

function countDaysInclusive(start, end) {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  return Math.max(0, Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1);
}

function listMissingDates(start, end, byDate) {
  const missing = [];
  let cur = start;
  while (cur <= end) {
    if (!byDate.has(cur)) missing.push(cur);
    cur = nextDayStr(cur);
  }
  return missing;
}

/**
 * Build daily means from raw hourly readings when the archive has not published yet and
 * OpenAQ's `/days` rollup is still empty — common for newer low-cost sensors (AirGradient,
 * etc.) that report hourly data but lag on daily aggregates.
 */
async function fetchDailyFromHours(sensorId, start, end) {
  const span = countDaysInclusive(start, end);
  if (span === 0 || span > 120) return [];

  const raw = await fetchAllPages(
    `/v3/sensors/${sensorId}/hours`,
    { date_from: start, date_to: end },
    40
  );

  const buckets = new Map();
  for (const row of raw) {
    const value = Number(row.value);
    if (!isPlausiblePm25(value)) continue;
    const from =
      pickUtcDatetime(row.period?.datetimeFrom) ??
      pickUtcDatetime(row.datetimeFrom) ??
      pickUtcDatetime(row.datetime);
    if (!from) continue;
    const day = from.slice(0, 10);
    if (day < start || day > end) continue;
    const bucket = buckets.get(day) ?? { sum: 0, count: 0 };
    bucket.sum += value;
    bucket.count += 1;
    buckets.set(day, bucket);
  }

  return [...buckets.entries()]
    .map(([date, { sum, count }]) => ({
      date,
      datetime: `${date}T12:00:00Z`,
      pm25: roundPm25(sum / count),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function mergeSourceTag(base, extra) {
  if (!base || base === 'live') return extra;
  if (base.includes(extra)) return base;
  return `${base}+${extra}`;
}

export async function getOpenAqTimeseries({
  sensorId,
  start,
  end,
  resolution = 'daily',
  locationId: locationIdIn,
} = {}) {
  if (!sensorId) {
    const err = new Error('Missing required query param: sensorId');
    err.status = 400;
    throw err;
  }
  if (!start || !end) {
    const err = new Error('Missing required query params: start, end');
    err.status = 400;
    throw err;
  }

  const cacheKey = `${sensorId}:${resolution}:${start}:${end}`;
  const hit = seriesCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < SERIES_CACHE_TTL_MS) return hit.data;

  const cutoff = archiveCutoffDate();
  const points = [];
  let source = 'live';
  const expectedDays = resolution === 'daily' ? countDaysInclusive(start, end) : 0;

  const locations = await getAfricaLocations();
  const loc = locationIdIn
    ? locations.find((l) => l.locationId === Number(locationIdIn) || l.sensorId === Number(sensorId))
    : locations.find((l) => l.sensorId === Number(sensorId));

  // Historical portion (anything already published in the S3 archive) — free, unlimited,
  // cached to disk forever. Never touches the OpenAQ API or its rate limit.
  if (start <= cutoff && loc) {
    const archiveEnd = end < cutoff ? end : cutoff;
    try {
      const daily = await getArchiveDailySeries({ locationId: loc.locationId, start, end: archiveEnd });
      points.push(...aggregateDailyToResolution(daily, resolution));
      source = end <= cutoff ? 'archive' : 'archive+live';
    } catch (err) {
      console.warn('[OpenAQ archive] series fetch failed, falling back to live API:', err.message);
    }
  }

  // Trailing portion not yet published in the archive (last ~72h) — small, targeted live call.
  if (end > cutoff) {
    const liveStart = points.length ? nextDayStr(cutoff) : start;
    if (liveStart <= end) {
      try {
        const raw = await fetchAllPages(seriesPath(sensorId, resolution), {
          ...seriesDateParams(resolution, liveStart, end),
        }, 5);
        points.push(...raw.map((row) => normalizeSeriesPoint(row, resolution)).filter(Boolean));
      } catch (err) {
        console.warn('[OpenAQ timeseries] live /days failed, trying hourly fallback:', err.message);
      }
    }
  }

  // Fill recent gaps from hourly readings only for days past the archive cutoff — never
  // re-fetch hours for the full chart window (that was timing out 7-day historical charts).
  if (resolution === 'daily' && expectedDays > 0) {
    const byDate = new Map(points.map((p) => [p.date, p]));
    const lastKnown = loc?.datetimeLast?.slice(0, 10) ?? loc?.datetime?.slice(0, 10);
    if (lastKnown && lastKnown >= start && byDate.size < expectedDays) {
      const trailingMissing = listMissingDates(start, end, byDate).filter((d) => d > cutoff);
      if (trailingMissing.length > 0) {
        const hourStart = trailingMissing[0];
        const hourEnd = trailingMissing[trailingMissing.length - 1];
        const span = countDaysInclusive(hourStart, hourEnd);
        if (span > 0 && span <= 5) {
          try {
            const hourPoints = await fetchDailyFromHours(sensorId, hourStart, hourEnd);
            for (const p of hourPoints) {
              if (!byDate.has(p.date)) byDate.set(p.date, p);
            }
            if (hourPoints.length > 0) {
              source = mergeSourceTag(source, 'hours');
            }
          } catch (err) {
            console.warn('[OpenAQ timeseries] hourly fallback failed:', err.message);
          }
        }
      }
      points.length = 0;
      points.push(...byDate.values());
    }
  }

  const byDate = new Map();
  for (const p of points) byDate.set(p.date, p);
  const merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  const data = {
    sensorId: Number(sensorId),
    start,
    end,
    resolution,
    points: merged,
    source,
  };
  seriesCache.set(cacheKey, { ts: Date.now(), data });
  return data;
}

export { getOpenAqArchiveInfo };

/** Single-station daily PM2.5 for map click / sidebar when bulk map enrichment has not run yet. */
export async function getOpenAqStationDay({ sensorId, date } = {}) {
  if (!sensorId) {
    const err = new Error('Missing required query param: sensorId');
    err.status = 400;
    throw err;
  }
  if (!date) {
    const err = new Error('Missing required query param: date');
    err.status = 400;
    throw err;
  }

  const locations = await getAfricaLocations();
  const loc = locations.find((l) => l.sensorId === Number(sensorId));
  if (!loc) {
    const err = new Error(`Unknown sensorId: ${sensorId}`);
    err.status = 404;
    throw err;
  }

  const today = new Date().toISOString().slice(0, 10);
  if (date >= today) {
    return stationRecord(loc, 'daily');
  }

  const [{ day }] = await getArchiveDayForLocations([loc], date);
  if (day && !day.missing && day.mean != null) {
    return stationRecord(loc, 'daily', { value: day.mean, datetime: `${date}T12:00:00Z` });
  }

  if (!dailyFallbackEligible(date)) {
    return stationRecord(loc, 'daily');
  }

  const hit = await fetchDailyForDate(loc.sensorId, date);
  if (!hit) return stationRecord(loc, 'daily');
  return stationRecord(loc, 'daily', { value: hit.pm25, datetime: hit.datetime });
}

export async function proxyOpenAqV3(req, res) {
  try {
    const pathAndQuery = req.originalUrl.replace('/api/openaq/v3', '/v3') || '/v3';
    const target = `${OPENAQ_BASE}${pathAndQuery}`;
    await throttleOpenAqRequest();
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        'X-API-Key': getApiKey(),
        'User-Agent': 'african-dashboard/1.0',
        Accept: 'application/json',
      },
    });
    const ct = upstream.headers.get('content-type');
    const body = Buffer.from(await upstream.arrayBuffer());
    if (ct) res.setHeader('Content-Type', ct);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(upstream.status);
    res.send(body);
  } catch (err) {
    console.error('[OpenAQ proxy] Error:', err);
    res.status(err.status ?? 502).json({ error: err.message || 'OpenAQ proxy failed' });
  }
}

export async function verifyOpenAqApiKey() {
  if (!process.env.OPENAQ_API_KEY?.trim()) {
    return { ok: false, status: 0, message: 'OPENAQ_API_KEY is not set in .env' };
  }
  try {
    const res = await fetch(`${OPENAQ_BASE}/v3/locations/2178`, {
      headers: {
        'X-API-Key': getApiKey(),
        'User-Agent': 'african-dashboard/1.0',
        Accept: 'application/json',
      },
    });
    if (res.ok) {
      return { ok: true, status: res.status, message: 'OpenAQ API key accepted' };
    }
    const text = await res.text();
    let detail = text.slice(0, 160);
    try {
      const json = JSON.parse(text);
      detail = json.detail ?? json.message ?? detail;
    } catch {
      /* keep raw snippet */
    }
    return {
      ok: false,
      status: res.status,
      message: typeof detail === 'string' ? detail : 'OpenAQ rejected the API key',
    };
  } catch (err) {
    return { ok: false, status: 0, message: err.message || 'OpenAQ key check failed' };
  }
}

export function getOpenAqAuthStatus() {
  return {
    ready: Boolean(process.env.OPENAQ_API_KEY?.trim()),
    warmed: warmedLatest.all.size > 0,
    warmedCount: warmedLatest.all.size,
  };
}
