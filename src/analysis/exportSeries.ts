import type { AlignedRow, NormalizedSeries } from './types';
import { alignSeriesByDate } from './alignSeries';

export function seriesListToCsv(seriesList: NormalizedSeries[]): string {
  if (seriesList.length === 0) return '';
  const header = ['date', ...seriesList.map((s) => s.label)].join(',');
  const aligned = alignSeriesByDate(seriesList);
  const lines = aligned.map((row) => {
    const vals = seriesList.map((s) => {
      const v = row.values[s.id];
      return v != null ? String(v) : '';
    });
    const formatted = vals.map((v) =>
      v != null && Number.isFinite(Number(v)) ? Number(v).toFixed(2) : ''
    );
    return [row.date, ...formatted].join(',');
  });
  return [header, ...lines].join('\n');
}

export function alignedToCsv(rows: AlignedRow[], columnLabels: Record<string, string>): string {
  if (rows.length === 0) return '';
  const ids = Object.keys(rows[0].values);
  const header = ['date', ...ids.map((id) => columnLabels[id] ?? id)].join(',');
  const lines = rows.map((r) => [r.date, ...ids.map((id) => String(r.values[id] ?? ''))].join(','));
  return [header, ...lines].join('\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
