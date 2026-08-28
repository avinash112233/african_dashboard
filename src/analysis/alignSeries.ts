import type { AlignedRow, NormalizedSeries } from './types';

/** Inner-join daily series on ISO date (YYYY-MM-DD). */
export function alignSeriesByDate(seriesList: NormalizedSeries[]): AlignedRow[] {
  if (seriesList.length === 0) return [];
  const maps = seriesList.map((s) => {
    const m = new Map<string, number>();
    for (const p of s.points) {
      const d = p.time.slice(0, 10);
      if (Number.isFinite(p.value)) m.set(d, p.value);
    }
    return { id: s.id, map: m };
  });

  const dates = new Set<string>();
  for (const { map } of maps) {
    for (const d of map.keys()) dates.add(d);
  }

  const rows: AlignedRow[] = [];
  for (const date of [...dates].sort()) {
    const values: Record<string, number> = {};
    let ok = true;
    for (const { id, map } of maps) {
      const v = map.get(date);
      if (v == null) {
        ok = false;
        break;
      }
      values[id] = v;
    }
    if (ok) rows.push({ date, values });
  }
  return rows;
}

/** Union of dates — each series may have gaps (for multi-line time series). */
export function unionDatesFromSeries(seriesList: NormalizedSeries[]): string[] {
  const dates = new Set<string>();
  for (const s of seriesList) {
    for (const p of s.points) dates.add(p.time.slice(0, 10));
  }
  return [...dates].sort();
}

export function isMonthlyGranularitySeries(series: NormalizedSeries): boolean {
  return series.variable === 'washu_pm25' || series.source === 'washu';
}

/** Collapse daily (or finer) points to calendar-month means keyed as YYYY-MM-01. */
export function aggregateSeriesToMonthly(series: NormalizedSeries): NormalizedSeries {
  const byMonth = new Map<string, { sum: number; n: number }>();
  for (const p of series.points) {
    const monthKey = `${p.time.slice(0, 7)}-01`;
    if (!monthKey || monthKey.length < 10) continue;
    const e = byMonth.get(monthKey) ?? { sum: 0, n: 0 };
    e.sum += p.value;
    e.n += 1;
    byMonth.set(monthKey, e);
  }
  const points = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, { sum, n }]) => ({ time, value: sum / n }));
  return { ...series, points };
}

/** Monthly-align all series for combined time-series when WashU is included. */
export function prepareSeriesListForCombinedChart(seriesList: NormalizedSeries[]): NormalizedSeries[] {
  const needsMonthly = seriesList.some(isMonthlyGranularitySeries);
  if (!needsMonthly) return seriesList;
  return seriesList.map((s) =>
    isMonthlyGranularitySeries(s) ? s : aggregateSeriesToMonthly(s)
  );
}

export function combinedChartUsesMonthlyMeans(seriesList: NormalizedSeries[]): boolean {
  return seriesList.some(isMonthlyGranularitySeries);
}

/** Monthly-align PM2.5 series before scatter when WashU is involved. */
export function prepareSeriesPairForScatter(
  a: NormalizedSeries,
  b: NormalizedSeries
): [NormalizedSeries, NormalizedSeries] {
  const needsMonthly = isMonthlyGranularitySeries(a) || isMonthlyGranularitySeries(b);
  if (!needsMonthly) return [a, b];
  const normalize = (s: NormalizedSeries) =>
    isMonthlyGranularitySeries(s) ? s : aggregateSeriesToMonthly(s);
  return [normalize(a), normalize(b)];
}
