import dayjs from 'dayjs';
import type { PlotRangeMode, PlotRangePreset } from './types';

export function getPresetPlotRange(
  anchorDateStr: string,
  preset: PlotRangePreset
): { startDate: string; endDate: string } {
  const today = dayjs().startOf('day');
  const requested = dayjs(anchorDateStr, 'YYYY-MM-DD').startOf('day');
  const end = requested.isAfter(today) ? today : requested;
  const days = preset === '7D' ? 7 : preset === '30D' ? 30 : 90;
  const start = end.subtract(days - 1, 'day');
  return { startDate: start.format('YYYY-MM-DD'), endDate: end.format('YYYY-MM-DD') };
}

export function normalizeCustomPlotRange(
  start: string,
  end: string
): { startDate: string; endDate: string } | null {
  const from = dayjs(start, 'YYYY-MM-DD', true);
  const to = dayjs(end, 'YYYY-MM-DD', true);
  if (!from.isValid() || !to.isValid()) return null;
  const startDate = from.isAfter(to, 'day') ? to : from;
  const endDate = from.isAfter(to, 'day') ? from : to;
  return {
    startDate: startDate.format('YYYY-MM-DD'),
    endDate: endDate.format('YYYY-MM-DD'),
  };
}

export function plotRangeLabel(mode: PlotRangeMode): string {
  if (mode === 'custom') return 'Custom range';
  if (mode === '7D') return 'Last 7 days';
  if (mode === '30D') return 'Last 30 days';
  return 'Last 90 days';
}

export const PLOT_RANGE_PRESETS: PlotRangePreset[] = ['7D', '30D', '90D'];

export const PLOT_RANGE_PRESET_LABELS: Record<PlotRangePreset, string> = {
  '7D': 'Last 7 days',
  '30D': 'Last 30 days',
  '90D': 'Last 90 days',
};
