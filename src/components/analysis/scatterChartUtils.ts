import dayjs from 'dayjs';
import { formatDisplayDate } from '../../utils/dateFormat';
import { formatChartTick } from '../../utils/chartFormat';

export interface ScatterPlotPoint {
  x: number;
  y: number;
  date: string;
  label: string;
}

function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const exponent = Math.floor(Math.log10(rawStep));
  const fraction = rawStep / 10 ** exponent;
  let niceFraction = 10;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  return niceFraction * 10 ** exponent;
}

/** True when both series share units and a 1:1 reference line is meaningful. */
export function scatterAxesComparable(xUnit?: string, yUnit?: string): boolean {
  const xu = (xUnit ?? '').trim().toLowerCase();
  const yu = (yUnit ?? '').trim().toLowerCase();
  if (xu && yu) return xu === yu;
  return !xu && !yu;
}

/** Min/max with human-readable tick spacing for one axis. */
export function scatterAxisBounds(values: number[], tickCount = 5): { min: number; max: number } {
  if (values.length === 0) return { min: 0, max: 1 };

  let minVal = Math.min(...values);
  let maxVal = Math.max(...values);

  if (minVal === maxVal) {
    const pad = Math.max(Math.abs(minVal) * 0.12, 1);
    return {
      min: Math.max(0, minVal - pad),
      max: maxVal + pad,
    };
  }

  const span = maxVal - minVal;
  const step = niceStep(span / Math.max(tickCount - 1, 1));
  const niceMin = Math.floor(minVal / step) * step;
  const niceMax = Math.ceil(maxVal / step) * step;

  return {
    min: Math.max(0, niceMin),
    max: niceMax <= niceMin ? niceMin + step : niceMax,
  };
}

export function scatterPointLabel(date: string, isMonthly: boolean): string {
  if (isMonthly) {
    const d = dayjs(date.slice(0, 10));
    return d.isValid() ? d.format('MMM YYYY') : date.slice(0, 7);
  }
  return formatDisplayDate(date);
}

export function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;

  const meanX = xs.reduce((sum, v) => sum + v, 0) / n;
  const meanY = ys.reduce((sum, v) => sum + v, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den === 0) return null;
  return num / den;
}

export function formatCorrelation(r: number | null): string {
  if (r == null || !Number.isFinite(r)) return '—';
  return r.toFixed(2);
}

export function formatScatterCell(value: number): string {
  return formatChartTick(value);
}
