import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
} from 'chart.js';
import type { TooltipItem, Plugin } from 'chart.js';
import { Scatter } from 'react-chartjs-2';
import { alignSeriesByDate, prepareSeriesPairForScatter } from '../../analysis/alignSeries';
import type { NormalizedSeries } from '../../analysis/types';
import { chartPluginsBase, formatChartTick } from '../../utils/chartFormat';
import {
  formatCorrelation,
  formatScatterCell,
  pearsonCorrelation,
  scatterAxesComparable,
  scatterAxisBounds,
  scatterPointLabel,
  type ScatterPlotPoint,
} from './scatterChartUtils';
import './AnalysisChartsModal.css';

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip);

const SOURCE_COLOR: Record<string, string> = {
  aeronet: '#2563eb',
  merra2: '#16a34a',
  openaq: '#0ea5e9',
  washu: '#7c3aed',
  aaqe: '#9333ea',
  firms: '#dc2626',
};

const scatterOneToOnePlugin: Plugin<'scatter'> = {
  id: 'scatterOneToOneLine',
  beforeDatasetsDraw(chart, _args, opts: { min?: number; max?: number; enabled?: boolean } | undefined) {
    if (!opts?.enabled) return;
    const { ctx, scales } = chart;
    const xScale = scales.x;
    const yScale = scales.y;
    if (!xScale || !yScale) return;
    const min = opts?.min ?? xScale.min;
    const max = opts?.max ?? xScale.max;
    if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max)) return;

    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.moveTo(xScale.getPixelForValue(min), yScale.getPixelForValue(min));
    ctx.lineTo(xScale.getPixelForValue(max), yScale.getPixelForValue(max));
    ctx.stroke();
    ctx.restore();
  },
};

export interface ScatterCorrelationCardProps {
  xSeries: NormalizedSeries;
  ySeries: NormalizedSeries;
}

export default function ScatterCorrelationCard({ xSeries, ySeries }: ScatterCorrelationCardProps) {
  const [preparedX, preparedY] = prepareSeriesPairForScatter(xSeries, ySeries);
  const aligned = alignSeriesByDate([preparedX, preparedY]);
  const isMonthly =
    preparedX.points.some((p) => p.time.endsWith('-01')) &&
    preparedY.points.some((p) => p.time.endsWith('-01'));

  const rows: ScatterPlotPoint[] = aligned.map((row) => ({
    date: row.date,
    x: row.values[preparedX.id],
    y: row.values[preparedY.id],
    label: scatterPointLabel(row.date, isMonthly),
  }));

  const xColor = SOURCE_COLOR[xSeries.source] ?? '#2563eb';
  const yColor = SOURCE_COLOR[ySeries.source] ?? '#16a34a';
  const countLabel = isMonthly ? 'months' : 'days';
  const xValues = rows.map((row) => row.x);
  const yValues = rows.map((row) => row.y);
  const comparableAxes = scatterAxesComparable(xSeries.unit, ySeries.unit);
  const xBounds = rows.length > 0
    ? scatterAxisBounds(comparableAxes ? [...xValues, ...yValues] : xValues)
    : { min: 0, max: 1 };
  const yBounds = rows.length > 0
    ? scatterAxisBounds(comparableAxes ? [...xValues, ...yValues] : yValues)
    : { min: 0, max: 1 };
  const oneToOneBounds = comparableAxes ? xBounds : undefined;
  const scatterPoints = rows.map((row) => ({ x: row.x, y: row.y }));
  const correlation = pearsonCorrelation(xValues, yValues);
  const xHeaderUnit = xSeries.unit ? ` (${xSeries.unit})` : '';
  const yHeaderUnit = ySeries.unit ? ` (${ySeries.unit})` : '';

  return (
    <div className="acm-card acm-card-wide acm-scatter-card" data-chart-label={`${ySeries.label} vs ${xSeries.label}`}>
      <div className="acm-scatter-header">
        <div className="acm-scatter-header-main">
          <div className="acm-scatter-legend">
            <span className="acm-scatter-legend-item">
              <span className="acm-dot" style={{ background: xColor }} />
              <span className="acm-scatter-legend-name">{xSeries.label}</span>
            </span>
            <span className="acm-scatter-legend-vs">vs</span>
            <span className="acm-scatter-legend-item">
              <span className="acm-dot" style={{ background: yColor }} />
              <span className="acm-scatter-legend-name">{ySeries.label}</span>
            </span>
          </div>
          <p className="acm-scatter-caption acm-scatter-caption--header">
            {comparableAxes
              ? 'Dashed line = 1:1 agreement when units match. Hover a point for values.'
              : 'Different units — points show co-located trend only (no 1:1 line). Hover for values.'}
          </p>
        </div>
        <div className="acm-scatter-stats">
          <span className="acm-scatter-stat">
            <span className="acm-scatter-stat-label">n</span>
            <span className="acm-scatter-stat-value">{rows.length}</span>
            <span className="acm-scatter-stat-unit">{countLabel}</span>
          </span>
          <span className="acm-scatter-stat">
            <span className="acm-scatter-stat-label">r</span>
            <span className="acm-scatter-stat-value">{formatCorrelation(correlation)}</span>
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="acm-chart-empty acm-scatter-empty">
          No co-located data — both series need overlapping {isMonthly ? 'months' : 'dates'} in this range.
        </div>
      ) : (
        <div className="acm-scatter-layout">
          <div className="acm-scatter-chart-panel">
            <div className="acm-chart-area acm-scatter-chart-area">
              <Scatter
                plugins={[scatterOneToOnePlugin]}
                data={{
                  datasets: [
                    {
                      label: `${ySeries.label} vs ${xSeries.label}`,
                      data: scatterPoints,
                      backgroundColor: `${xColor}cc`,
                      borderColor: '#ffffff',
                      borderWidth: 2,
                      pointRadius: 6,
                      pointHoverRadius: 8,
                      hoverBackgroundColor: yColor,
                      hoverBorderColor: '#ffffff',
                      hoverBorderWidth: 2,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  layout: { padding: { top: 6, right: 12, bottom: 4, left: 4 } },
                  plugins: {
                    ...chartPluginsBase,
                    scatterOneToOneLine: {
                      enabled: comparableAxes,
                      min: oneToOneBounds?.min,
                      max: oneToOneBounds?.max,
                    },
                    legend: { display: false },
                    tooltip: {
                      backgroundColor: 'rgba(17, 24, 39, 0.92)',
                      titleFont: { size: 12, weight: 'bold' },
                      bodyFont: { size: 12 },
                      padding: 10,
                      callbacks: {
                        title: (items: TooltipItem<'scatter'>[]) => {
                          const idx = items[0]?.dataIndex;
                          return idx != null ? rows[idx]?.label ?? '' : '';
                        },
                        label: (ctx: TooltipItem<'scatter'>) => {
                          const idx = ctx.dataIndex;
                          const row = rows[idx];
                          if (!row) return '';
                          return [
                            `${xSeries.label}: ${formatChartTick(row.x)}${xSeries.unit ? ` ${xSeries.unit}` : ''}`,
                            `${ySeries.label}: ${formatChartTick(row.y)}${ySeries.unit ? ` ${ySeries.unit}` : ''}`,
                          ];
                        },
                      },
                    },
                  },
                  scales: {
                    x: {
                      type: 'linear' as const,
                      min: xBounds.min,
                      max: xBounds.max,
                      title: {
                        display: true,
                        text: `${xSeries.label}${xHeaderUnit}`,
                        font: { size: 11, weight: '600' },
                        color: xColor,
                        padding: { top: 10 },
                      },
                      ticks: {
                        color: '#64748b',
                        font: { size: 11 },
                        maxTicksLimit: 6,
                        callback: (v: string | number) => formatChartTick(v),
                      },
                      grid: { color: 'rgba(148, 163, 184, 0.15)' },
                      border: { color: 'rgba(148, 163, 184, 0.3)' },
                    },
                    y: {
                      type: 'linear' as const,
                      min: yBounds.min,
                      max: yBounds.max,
                      title: {
                        display: true,
                        text: `${ySeries.label}${yHeaderUnit}`,
                        font: { size: 11, weight: '600' },
                        color: yColor,
                        padding: { bottom: 6 },
                      },
                      ticks: {
                        color: '#64748b',
                        font: { size: 11 },
                        maxTicksLimit: 6,
                        callback: (v: string | number) => formatChartTick(v),
                      },
                      grid: { color: 'rgba(148, 163, 184, 0.15)' },
                      border: { color: 'rgba(148, 163, 184, 0.3)' },
                    },
                  },
                } as never}
              />
            </div>
          </div>

          <div className="acm-scatter-table-panel">
            <div className="acm-scatter-table-wrap">
              <table className="acm-scatter-table">
                <thead>
                  <tr>
                    <th scope="col">{isMonthly ? 'Month' : 'Date'}</th>
                    <th scope="col" className="acm-scatter-table-col-x">
                      <span className="acm-scatter-col-head">
                        <span className="acm-dot acm-dot--sm" style={{ background: xColor }} />
                        {xSeries.label}
                      </span>
                      {xSeries.unit ? <span className="acm-scatter-col-unit">{xSeries.unit}</span> : null}
                    </th>
                    <th scope="col" className="acm-scatter-table-col-y">
                      <span className="acm-scatter-col-head">
                        <span className="acm-dot acm-dot--sm" style={{ background: yColor }} />
                        {ySeries.label}
                      </span>
                      {ySeries.unit ? <span className="acm-scatter-col-unit">{ySeries.unit}</span> : null}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.date}>
                      <th scope="row">{row.label}</th>
                      <td className="acm-scatter-table-col-x">{formatScatterCell(row.x)}</td>
                      <td className="acm-scatter-table-col-y">{formatScatterCell(row.y)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
