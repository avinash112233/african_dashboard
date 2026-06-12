export function formatChartNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

export function formatChartTick(value: string | number | null | undefined): string {
  if (value == null) return '';
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : String(value);
}

// Disables the global datalabels plugin for all charts unless explicitly opted in.
export const chartPluginsBase = {
  datalabels: { display: false },
} as const;

export function tooltipLine(label: string, value: unknown, unit = ''): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return `${label}: —`;
  return `${label}: ${n.toFixed(2)}${unit ? ` ${unit}` : ''}`;
}
