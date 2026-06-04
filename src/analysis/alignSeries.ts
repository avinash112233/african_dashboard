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
