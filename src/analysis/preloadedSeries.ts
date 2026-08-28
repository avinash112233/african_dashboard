import type { AERONETDataPoint } from '../services/aeronetApi';
import type { OpenAqTimeseriesPoint } from '../services/openaqApi';
import type { MERRA2StationTimeseriesPoint } from '../services/merra2Api';
import type { WashUTimeseriesPoint, WashUStationTimeseriesPoint } from '../services/washuApi';
import { computeDailyMeanAOD } from '../utils/aodUtils';
import { getVariableDef } from './catalog';
import type { AnalysisVariableId, NormalizedSeries } from './types';

function seriesFromPoints(
  variable: AnalysisVariableId,
  points: { time: string; value: number }[]
): NormalizedSeries | null {
  const def = getVariableDef(variable);
  if (!def || points.length === 0) return null;
  return {
    id: `preloaded-${variable}`,
    source: def.source as NormalizedSeries['source'],
    variable,
    label: def.label,
    unit: def.unit,
    points,
  };
}

export function openAqPointsToSeries(points: OpenAqTimeseriesPoint[]): NormalizedSeries | null {
  const normalized = points
    .map((p) => {
      const time = (p.date ?? p.datetime.slice(0, 10)).slice(0, 10);
      return Number.isFinite(p.pm25) ? { time, value: p.pm25 } : null;
    })
    .filter((p): p is { time: string; value: number } => p != null);
  return seriesFromPoints('openaq_pm25', normalized);
}

function washuRawPointsToSeries(
  points: Array<{ year: number; month: number; pm25: number }>
): NormalizedSeries | null {
  const normalized = points
    .map((p) => {
      const time = `${p.year}-${String(p.month).padStart(2, '0')}-01`;
      return Number.isFinite(p.pm25) ? { time, value: p.pm25 } : null;
    })
    .filter((p): p is { time: string; value: number } => p != null);
  return seriesFromPoints('washu_pm25', normalized);
}

export function washuPinPointsToSeries(points: WashUTimeseriesPoint[]): NormalizedSeries | null {
  return washuRawPointsToSeries(points);
}

export function washuStationPointsToSeries(points: WashUStationTimeseriesPoint[]): NormalizedSeries | null {
  return washuRawPointsToSeries(points);
}

export function merra2PointsToSeries(points: MERRA2StationTimeseriesPoint[]): NormalizedSeries | null {
  const byDate = new Map<string, { sum: number; n: number }>();
  for (const p of points) {
    const d = (p.date ?? p.datetime.slice(0, 10)).slice(0, 10);
    if (!d || !Number.isFinite(p.pm25)) continue;
    const e = byDate.get(d) ?? { sum: 0, n: 0 };
    e.sum += p.pm25;
    e.n += 1;
    byDate.set(d, e);
  }
  const normalized = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, { sum, n }]) => ({ time, value: sum / n }));
  return seriesFromPoints('merra2_pm25', normalized);
}

export function aeronetPointsToSeries(
  points: AERONETDataPoint[],
  variable: 'aeronet_aod_500' | 'aeronet_aod_675' = 'aeronet_aod_500'
): NormalizedSeries | null {
  const daily = computeDailyMeanAOD(points);
  const key = variable === 'aeronet_aod_675' ? 'AOD_675nm' : 'AOD_500nm';
  const normalized = daily
    .map((row) => {
      const v = row[key];
      return v != null && Number.isFinite(v) ? { time: row.date.slice(0, 10), value: v } : null;
    })
    .filter((p): p is { time: string; value: number } => p != null);
  return seriesFromPoints(variable, normalized);
}
