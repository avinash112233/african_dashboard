import { getAERONETData, type AERONETAODVersion } from '../services/aeronetApi';
import { getMERRA2StationTimeseries } from '../services/merra2Api';
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
          error: 'No AERONET site linked to this selection',
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
          error: 'No MERRA2 station within 50 km',
        });
        continue;
      }
      results.push(await fetchMerra2Series(vid, sitename, start, end));
    }
  }
  return results;
}
