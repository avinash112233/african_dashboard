import { getAERONETData, type AERONETAODVersion } from '../services/aeronetApi';
import {
  findNearestAAQEForecastInitDate,
  getAAQEForecastByDate,
  getAaqeDisplayValues,
  getAaqeForecastDaysFromInit,
} from '../services/aaqeForecastApi';
import { getNOAA21VIIRS7DayFromWFS } from '../services/firmsApi';
import { getMERRA2StationTimeseries } from '../services/merra2Api';
import { haversineKm } from '../utils/geoUtils';
import { computeDailyMeanAOD } from '../utils/aodUtils';
import { calculateAQIFromPm25 } from '../utils/aqiUtils';
import { getVariableDef } from './catalog';
import type { AnalysisLocationContext, AnalysisVariableId, NormalizedSeries } from './types';

function dailyMeanPm25(
  points: { date?: string; datetime: string; pm25: number }[]
): { time: string; value: number }[] {
  const byDate = new Map<string, { sum: number; n: number }>();
  for (const p of points) {
    const d = (p.date ?? p.datetime.slice(0, 10)).slice(0, 10);
    if (!d || !Number.isFinite(p.pm25)) continue;
    const e = byDate.get(d) ?? { sum: 0, n: 0 };
    e.sum += p.pm25;
    e.n += 1;
    byDate.set(d, e);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, { sum, n }]) => ({ time, value: sum / n }));
}

async function fetchAeronetSeries(
  variable: AnalysisVariableId,
  querySite: string,
  start: string,
  end: string,
  aodVersion: AERONETAODVersion
): Promise<NormalizedSeries> {
  const def = getVariableDef(variable)!;
  const id = `aeronet-${variable}`;
  try {
    const raw = await getAERONETData(querySite, start, end, aodVersion);
    const daily = computeDailyMeanAOD(raw);
    const key = variable === 'aeronet_aod_675' ? 'AOD_675nm' : 'AOD_500nm';
    const points = daily
      .map((row) => {
        const v = row[key];
        return v != null && Number.isFinite(v) ? { time: row.date.slice(0, 10), value: v } : null;
      })
      .filter((p): p is { time: string; value: number } => p != null);
    return { id, source: 'aeronet', variable, label: def.label, unit: def.unit, points };
  } catch (err) {
    return {
      id, source: 'aeronet', variable, label: def.label, unit: def.unit, points: [],
      error: err instanceof Error ? err.message : 'AERONET fetch failed',
    };
  }
}

async function fetchMerra2Series(
  variable: AnalysisVariableId,
  sitename: string,
  start: string,
  end: string
): Promise<NormalizedSeries> {
  const def = getVariableDef(variable)!;
  const id = `merra2-${variable}`;
  try {
    const res = await getMERRA2StationTimeseries(sitename, start, end);
    let points = dailyMeanPm25(res.points);
    if (variable === 'merra2_aqi') {
      points = points
        .map((p) => {
          const aqi = calculateAQIFromPm25(p.value);
          return aqi != null ? { time: p.time, value: aqi } : null;
        })
        .filter((p): p is { time: string; value: number } => p != null);
    }
    return { id, source: 'merra2', variable, label: def.label, unit: def.unit, points };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // "No data found" and "Command failed" with empty parquet range are expected when
    // the selected date range extends beyond the latest available Parquet year.
    // Treat as empty (no red error) so the chart renders cleanly without MERRA2 data.
    const isNoData =
      /no pm2\.5 time-series data found/i.test(msg) ||
      /no station data found/i.test(msg) ||
      /command failed/i.test(msg);
    return {
      id, source: 'merra2', variable, label: def.label, unit: def.unit, points: [],
      error: isNoData ? undefined : msg,
    };
  }
}

// Walks AAQE init dates in 3-day steps to cover the full requested range.
// Each model run covers 3 forecast days; max 10 iterations to avoid runaway loops.
async function fetchAaqeSeries(
  variable: AnalysisVariableId,
  lat: number,
  lon: number,
  start: string,
  end: string
): Promise<NormalizedSeries> {
  const def = getVariableDef(variable)!;
  const id = 'aaqe-pm25';
  const MAX_DISTANCE_KM = 250;

  try {
    const startD = new Date(start), endD = new Date(end);
    const pointsMap = new Map<string, number>();
    let cursor = new Date(startD);
    let attempts = 0;

    while (cursor <= endD && attempts < 10) {
      attempts++;
      const isoReq = cursor.toISOString().slice(0, 10);
      const nearest = await findNearestAAQEForecastInitDate(isoReq, 5);
      if (!nearest) { cursor.setDate(cursor.getDate() + 3); continue; }

      const forecastPoints = await getAAQEForecastByDate(nearest.initDate);
      if (!forecastPoints.length) { cursor.setDate(cursor.getDate() + 3); continue; }

      let bestDist = Infinity, bestIdx = -1;
      for (let i = 0; i < forecastPoints.length; i++) {
        const d = haversineKm(lat, lon, forecastPoints[i].latitude, forecastPoints[i].longitude);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      if (bestIdx === -1 || bestDist > MAX_DISTANCE_KM) { cursor.setDate(cursor.getDate() + 3); continue; }

      const props = forecastPoints[bestIdx].properties;
      for (const day of getAaqeForecastDaysFromInit(nearest.initDate)) {
        if (day.iso < start || day.iso > end || pointsMap.has(day.iso)) continue;
        const { pm } = getAaqeDisplayValues(props, 'DAILY_AQI', '130');
        if (pm != null && Number.isFinite(pm)) pointsMap.set(day.iso, pm);
      }

      cursor = new Date(nearest.initDate);
      cursor.setDate(cursor.getDate() + 3);
    }

    const points = [...pointsMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([time, value]) => ({ time, value }));
    return { id, source: 'aaqe', variable, label: def.label, unit: def.unit, points };
  } catch (err) {
    return {
      id, source: 'aaqe', variable, label: def.label, unit: def.unit, points: [],
      error: err instanceof Error ? err.message : 'AAQE fetch failed',
    };
  }
}

// Counts VIIRS fire detections within 100 km of the anchor per day (last 7 days only).
async function fetchFireCountSeries(
  variable: AnalysisVariableId,
  lat: number,
  lon: number,
  start: string,
  end: string
): Promise<NormalizedSeries> {
  const def = getVariableDef(variable)!;
  const id = 'fire-count';
  const RADIUS_KM = 100;

  try {
    const allFires = await getNOAA21VIIRS7DayFromWFS();
    const byDate = new Map<string, number>();
    for (const f of allFires) {
      if (f.acq_date < start || f.acq_date > end) continue;
      if (haversineKm(lat, lon, f.latitude, f.longitude) > RADIUS_KM) continue;
      byDate.set(f.acq_date, (byDate.get(f.acq_date) ?? 0) + 1);
    }
    const points = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([time, value]) => ({ time, value }));
    return { id, source: 'firms', variable, label: def.label, unit: def.unit, points };
  } catch (err) {
    return {
      id, source: 'firms', variable, label: def.label, unit: def.unit, points: [],
      error: err instanceof Error ? err.message : 'Fire data fetch failed',
    };
  }
}

/** Resolves to `fallback` after `ms` milliseconds — used to cap a slow/dead API. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function fetchAnalysisSeries(
  variableIds: AnalysisVariableId[],
  location: AnalysisLocationContext,
  start: string,
  end: string,
  aeronetAodVersion: AERONETAODVersion
): Promise<NormalizedSeries[]> {
  const TIMEOUT_MS = 8_000;

  const promises = variableIds.map((vid): Promise<NormalizedSeries | null> => {
    const def = getVariableDef(vid);
    if (!def) return Promise.resolve(null);

    const empty = (error?: string): NormalizedSeries => ({
      id: `skip-${vid}`, source: def.source as NormalizedSeries['source'],
      variable: vid, label: def.label, unit: def.unit, points: [], error,
    });

    let fetch: Promise<NormalizedSeries>;

    if (def.source === 'aeronet') {
      const site = location.aeronetQuerySite;
      if (!site) {
        return Promise.resolve(empty(
          location.anchorSource === 'aeronet'
            ? 'AERONET site ID missing — try re-clicking the site'
            : undefined
        ));
      }
      fetch = fetchAeronetSeries(vid, site, start, end, aeronetAodVersion);
    } else if (def.source === 'merra2') {
      const sitename = location.merra2Sitename;
      if (!sitename) return Promise.resolve(empty());
      fetch = fetchMerra2Series(vid, sitename, start, end);
    } else if (def.source === 'aaqe') {
      fetch = fetchAaqeSeries(vid, location.latitude, location.longitude, start, end);
    } else if (def.source === 'firms') {
      fetch = fetchFireCountSeries(vid, location.latitude, location.longitude, start, end);
    } else {
      return Promise.resolve(null);
    }

    // Cap each source at 12 s — if NASA is down the panel still loads cleanly.
    return withTimeout(fetch, TIMEOUT_MS, empty());
  });

  const results = await Promise.all(promises);
  return results.filter((r): r is NormalizedSeries => r !== null);
}
