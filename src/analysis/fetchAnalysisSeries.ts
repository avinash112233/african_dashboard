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
    const key =
      variable === 'aeronet_aod_675' ? 'AOD_675nm' : 'AOD_500nm';
    const points = daily
      .map((row) => {
        const v = row[key];
        if (v == null || !Number.isFinite(v)) return null;
        return { time: row.date.slice(0, 10), value: v };
      })
      .filter((p): p is { time: string; value: number } => p != null);
    return {
      id,
      source: 'aeronet',
      variable,
      label: def.label,
      unit: def.unit,
      points,
    };
  } catch (err) {
    return {
      id,
      source: 'aeronet',
      variable,
      label: def.label,
      unit: def.unit,
      points: [],
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
    return {
      id,
      source: 'merra2',
      variable,
      label: def.label,
      unit: def.unit,
      points,
    };
  } catch (err) {
    return {
      id,
      source: 'merra2',
      variable,
      label: def.label,
      unit: def.unit,
      points: [],
      error: err instanceof Error ? err.message : 'MERRA2 fetch failed',
    };
  }
}

/**
 * Fetch AAQE daily PM2.5 forecast values for the nearest AAQE point to the anchor.
 * AAQE is a 3-day forecast; we walk through init dates to cover the requested range.
 */
async function fetchAaqeSeries(
  variable: AnalysisVariableId,
  lat: number,
  lon: number,
  start: string,
  end: string
): Promise<NormalizedSeries> {
  const def = getVariableDef(variable)!;
  const id = 'aaqe-pm25';
  const FIRE_RADIUS_KM = 250; // max distance to nearest AAQE forecast point

  try {
    const startD = new Date(start);
    const endD = new Date(end);
    const pointsMap = new Map<string, number>();

    // Walk from start to end in 3-day steps (each AAQE init covers 3 days).
    let cursor = new Date(startD);
    let attempts = 0;
    while (cursor <= endD && attempts < 10) {
      attempts++;
      const isoReq = cursor.toISOString().slice(0, 10);
      const nearest = await findNearestAAQEForecastInitDate(isoReq, 5);
      if (!nearest) { cursor.setDate(cursor.getDate() + 3); continue; }

      const forecastPoints = await getAAQEForecastByDate(nearest.initDate);
      if (!forecastPoints.length) { cursor.setDate(cursor.getDate() + 3); continue; }

      // Find nearest forecast station to anchor.
      let bestDist = Infinity;
      let bestIdx = -1;
      for (let i = 0; i < forecastPoints.length; i++) {
        const d = haversineKm(lat, lon, forecastPoints[i].latitude, forecastPoints[i].longitude);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      if (bestIdx === -1 || bestDist > FIRE_RADIUS_KM) { cursor.setDate(cursor.getDate() + 3); continue; }

      const props = forecastPoints[bestIdx].properties;
      const days = getAaqeForecastDaysFromInit(nearest.initDate);

      for (const day of days) {
        if (day.iso < start || day.iso > end) continue;
        if (pointsMap.has(day.iso)) continue;
        const { pm } = getAaqeDisplayValues(props, 'DAILY_AQI', '130');
        if (pm != null && Number.isFinite(pm)) pointsMap.set(day.iso, pm);
      }

      // Advance cursor past the 3 forecast days.
      cursor = new Date(nearest.initDate);
      cursor.setDate(cursor.getDate() + 3);
    }

    const points = [...pointsMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([time, value]) => ({ time, value }));

    return { id, source: 'aaqe', variable, label: def.label, unit: def.unit, points };
  } catch (err) {
    return {
      id,
      source: 'aaqe',
      variable,
      label: def.label,
      unit: def.unit,
      points: [],
      error: err instanceof Error ? err.message : 'AAQE fetch failed',
    };
  }
}

/**
 * Count VIIRS fire detections within 100 km of the anchor per day.
 * Uses the cached FIRMS 7-day feed — only recent data (last 7 days) available.
 */
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
    const nearby = allFires.filter(
      (f) =>
        f.acq_date >= start &&
        f.acq_date <= end &&
        haversineKm(lat, lon, f.latitude, f.longitude) <= RADIUS_KM
    );

    const byDate = new Map<string, number>();
    for (const f of nearby) {
      byDate.set(f.acq_date, (byDate.get(f.acq_date) ?? 0) + 1);
    }

    const points = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([time, value]) => ({ time, value }));

    return { id, source: 'firms', variable, label: def.label, unit: def.unit, points };
  } catch (err) {
    return {
      id,
      source: 'firms',
      variable,
      label: def.label,
      unit: def.unit,
      points: [],
      error: err instanceof Error ? err.message : 'Fire data fetch failed',
    };
  }
}

export async function fetchAnalysisSeries(
  variableIds: AnalysisVariableId[],
  location: AnalysisLocationContext,
  start: string,
  end: string,
  aeronetAodVersion: AERONETAODVersion
): Promise<NormalizedSeries[]> {
  const results: NormalizedSeries[] = [];
  for (const vid of variableIds) {
    const def = getVariableDef(vid);
    if (!def) continue;
    if (def.source === 'aeronet') {
      const site = location.aeronetQuerySite;
      if (!site) {
        results.push({
          id: `skip-${vid}`,
          source: 'aeronet',
          variable: vid,
          label: def.label,
          unit: def.unit,
          points: [],
          // Only show an error if user expected AERONET — not for every anchor type.
          error: location.anchorSource === 'aeronet'
            ? 'AERONET site ID missing — try re-clicking the site'
            : undefined,
        });
        continue;
      }
      results.push(await fetchAeronetSeries(vid, site, start, end, aeronetAodVersion));
    } else if (def.source === 'merra2') {
      const sitename = location.merra2Sitename;
      if (!sitename) {
        results.push({
          id: `skip-${vid}`,
          source: 'merra2',
          variable: vid,
          label: def.label,
          unit: def.unit,
          points: [],
          error: undefined, // no station found — shown in metadata, not as an error
        });
        continue;
      }
      results.push(await fetchMerra2Series(vid, sitename, start, end));
    } else if (def.source === 'aaqe') {
      results.push(await fetchAaqeSeries(vid, location.latitude, location.longitude, start, end));
    } else if (def.source === 'firms') {
      results.push(await fetchFireCountSeries(vid, location.latitude, location.longitude, start, end));
    }
  }
  return results;
}
