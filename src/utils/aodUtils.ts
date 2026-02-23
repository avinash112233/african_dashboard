/**
 * AOD data processing utilities
 */

export interface AODPoint {
  date: string;
  AOD_500nm?: number;
  AOD_675nm?: number;
  AOD_870nm?: number;
  AOD_1020nm?: number;
}

/** Normalize date string to YYYY-MM-DD for grouping */
function toDateKey(raw: string): string {
  const s = raw?.trim() ?? '';
  const dmy = s.match(/^(\d{1,2})[:\/-](\d{1,2})[:\/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

/** Group by date and compute daily mean AOD per wavelength */
export function computeDailyMeanAOD(data: AODPoint[]): AODPoint[] {
  if (!data?.length) return [];
  const byDate = new Map<string, { sums: Record<string, number>; counts: Record<string, number> }>();
  const keys = ['AOD_500nm', 'AOD_675nm', 'AOD_870nm', 'AOD_1020nm'] as const;

  for (const row of data) {
    const key = toDateKey(row.date);
    if (!byDate.has(key)) {
      byDate.set(key, { sums: {}, counts: {} });
    }
    const entry = byDate.get(key)!;
    for (const k of keys) {
      const v = row[k];
      if (v != null && !isNaN(v)) {
        entry.sums[k] = (entry.sums[k] ?? 0) + v;
        entry.counts[k] = (entry.counts[k] ?? 0) + 1;
      }
    }
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { sums, counts }]) => {
      const out: AODPoint = { date };
      for (const k of keys) {
        const n = counts[k] ?? 0;
        if (n > 0) (out as unknown as Record<string, number>)[k] = (sums[k] ?? 0) / n;
      }
      return out;
    });
}

/** AOD level for color-coding (scientifically defined thresholds) */
export type AODLevel = 'very-clean' | 'moderate' | 'high' | 'very-high' | null;

export function getAODLevel(aod: number | undefined | null): AODLevel {
  if (aod == null || isNaN(aod)) return null;
  if (aod < 0.1) return 'very-clean';
  if (aod < 0.3) return 'moderate';
  if (aod < 0.5) return 'high';
  return 'very-high';
}

export function getAODLevelColor(aod: number | undefined | null): string {
  const level = getAODLevel(aod);
  if (level === 'very-clean') return '#16a34a';  // green
  if (level === 'moderate') return '#ca8a04';    // yellow/amber
  if (level === 'high') return '#ea580c';        // orange
  if (level === 'very-high') return '#dc2626';   // red
  return 'inherit';
}

export function getAODLevelLabel(aod: number | undefined | null): string {
  const level = getAODLevel(aod);
  if (level === 'very-clean') return 'Very clean';
  if (level === 'moderate') return 'Moderate';
  if (level === 'high') return 'High';
  if (level === 'very-high') return 'Very high';
  return '';
}

/** AOD classification legend entries for display */
export const AOD_CLASSIFICATION_LEGEND = [
  { range: '<0.1', label: 'Very Clean', color: '#16a34a' },
  { range: '0.1–0.3', label: 'Moderate', color: '#ca8a04' },
  { range: '0.3–0.5', label: 'High', color: '#ea580c' },
  { range: '≥0.5', label: 'Very High', color: '#dc2626' },
] as const;
