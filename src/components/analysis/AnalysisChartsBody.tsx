import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import type { TooltipItem } from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { formatDisplayDate } from '../../utils/dateFormat';
import { chartPluginsBase, formatChartTick, tooltipLine } from '../../utils/chartFormat';
import { alignSeriesByDate, unionDatesFromSeries } from '../../analysis/alignSeries';
import type { AnalysisVariableId, NormalizedSeries } from '../../analysis/types';
import './AnalysisChartsModal.css';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Title, Tooltip, Legend
);

const SOURCE_COLOR: Record<string, string> = {
  aeronet: '#2563eb',
  merra2:  '#16a34a',
  aaqe:    '#9333ea',
  firms:   '#dc2626',
};
const SERIES_COLORS = ['#2563eb', '#dc2626', '#059669', '#7c3aed', '#ea580c'];

// ── Individual chart card ────────────────────────────────────────────────────

interface SingleChartCardProps { series: NormalizedSeries; }

function SingleChartCard({ series }: SingleChartCardProps) {
  const color  = SOURCE_COLOR[series.source] ?? '#6b7280';
  const dates  = unionDatesFromSeries([series]);
  const labels = dates.map(formatDisplayDate);
  const byDate = new Map(series.points.map((p) => [p.time.slice(0, 10), p.value]));
  const data   = dates.map((d) => {
    const v = byDate.get(d);
    return v != null && Number.isFinite(v) ? Number(v.toFixed(3)) : null;
  });

  const isCounts = series.source === 'firms';
  const yLabel   = series.unit ? `${series.label} (${series.unit})` : series.label;

  const scales = {
    x: {
      grid: { display: false },
      title: { display: true, text: 'Date', font: { size: 11 }, color: '#9ca3af' },
      ticks: { color: '#6b7280', font: { size: 11 }, maxRotation: 40, maxTicksLimit: 10 },
    },
    y: {
      title: { display: true, text: yLabel, font: { size: 11 }, color: '#6b7280' },
      ticks: { color: '#6b7280', font: { size: 11 }, callback: (v: string | number) => formatChartTick(v) },
      grid: { color: 'rgba(0,0,0,0.06)' },
      beginAtZero: isCounts,
    },
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      ...chartPluginsBase,
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<'line' | 'bar'>) =>
            tooltipLine(series.label, ctx.parsed.y, series.unit),
        },
      },
    },
    scales,
  };

  if (series.points.length === 0) {
    return (
      <div className="acm-card" data-chart-label={series.label}>
        <div className="acm-card-header">
          <span className="acm-dot" style={{ background: color }} />
          <span className="acm-card-title">{series.label}</span>
          <span className="acm-card-unit">{series.unit}</span>
        </div>
        <div className="acm-chart-empty">No data for this period</div>
      </div>
    );
  }

  return (
    <div className="acm-card" data-chart-label={series.label}>
      <div className="acm-card-header">
        <span className="acm-dot" style={{ background: color }} />
        <span className="acm-card-title">{series.label}</span>
        <span className="acm-card-unit">{series.unit}</span>
        <span className="acm-card-count">{series.points.length} pts</span>
      </div>
      <div className="acm-chart-area">
        {isCounts ? (
          <Bar
            data={{ labels, datasets: [{ data, backgroundColor: `${color}99`, borderColor: color, borderWidth: 1, borderRadius: 3 }] }}
            options={options as never}
          />
        ) : (
          <Line
            data={{ labels, datasets: [{ data, borderColor: color, backgroundColor: `${color}20`, pointRadius: 3, pointHoverRadius: 5, borderWidth: 2, tension: 0.25, fill: true, spanGaps: true }] }}
            options={options as never}
          />
        )}
      </div>
    </div>
  );
}

// ── Scatter card ─────────────────────────────────────────────────────────────

interface ScatterCardProps { xSeries: NormalizedSeries; ySeries: NormalizedSeries; }

function ScatterCard({ xSeries, ySeries }: ScatterCardProps) {
  const aligned = alignSeriesByDate([xSeries, ySeries]);
  const points  = aligned.map((row) => ({ x: row.values[xSeries.id], y: row.values[ySeries.id] }));
  const color   = SOURCE_COLOR[xSeries.source] ?? '#2563eb';
  const title   = `${ySeries.label} vs ${xSeries.label}`;

  return (
    <div className="acm-card acm-card-wide" data-chart-label={title}>
      <div className="acm-card-header">
        <span className="acm-dot" style={{ background: color }} />
        <span className="acm-card-title">{title}</span>
        <span className="acm-card-count">{points.length} co-located days</span>
      </div>
      <div className="acm-chart-area">
        {points.length === 0 ? (
          <div className="acm-chart-empty">No co-located data (need overlapping dates in both series)</div>
        ) : (
          <Line
            data={{ datasets: [{ type: 'scatter' as never, data: points as never, backgroundColor: `${color}88`, borderColor: color, pointRadius: 4, pointHoverRadius: 6 }] }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                ...chartPluginsBase,
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: (ctx: TooltipItem<'line'>) =>
                      `${xSeries.label}: ${formatChartTick(ctx.parsed.x)}  |  ${ySeries.label}: ${formatChartTick(ctx.parsed.y)}`,
                  },
                },
              },
              scales: {
                x: {
                  title: { display: true, text: xSeries.unit ? `${xSeries.label} (${xSeries.unit})` : xSeries.label, font: { size: 12 }, color: '#374151' },
                  ticks: { color: '#6b7280', font: { size: 11 }, callback: (v: string | number) => formatChartTick(v) },
                  grid: { color: 'rgba(0,0,0,0.06)' },
                },
                y: {
                  title: { display: true, text: ySeries.unit ? `${ySeries.label} (${ySeries.unit})` : ySeries.label, font: { size: 12 }, color: '#374151' },
                  ticks: { color: '#6b7280', font: { size: 11 }, callback: (v: string | number) => formatChartTick(v) },
                  grid: { color: 'rgba(0,0,0,0.06)' },
                },
              },
            } as never}
          />
        )}
      </div>
    </div>
  );
}

// ── Combined comparison chart (shown in UI + exported to PDF) ─────────────────

interface CombinedChartProps { seriesList: NormalizedSeries[]; }

function CombinedChart({ seriesList }: CombinedChartProps) {
  const dates    = unionDatesFromSeries(seriesList);
  const labels   = dates.map(formatDisplayDate);
  const useDual  = seriesList.length >= 2;

  const datasets = seriesList.map((s, i) => {
    const byDate = new Map(s.points.map((p) => [p.time.slice(0, 10), p.value]));
    return {
      label: `${s.label}${s.unit ? ` (${s.unit})` : ''}`,
      data: dates.map((d) => {
        const v = byDate.get(d);
        return v != null && Number.isFinite(v) ? Number(v.toFixed(3)) : null;
      }),
      borderColor: SERIES_COLORS[i % SERIES_COLORS.length],
      backgroundColor: `${SERIES_COLORS[i % SERIES_COLORS.length]}15`,
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: 2,
      tension: 0.25,
      spanGaps: true,
      fill: false,
      yAxisID: i === 0 ? 'y' : 'y1',
    };
  });

  return (
    <Line
      data={{ labels, datasets }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          ...chartPluginsBase,
          legend: {
            display: true,
            position: 'bottom',
            labels: { boxWidth: 12, font: { size: 11 }, padding: 14, usePointStyle: true, pointStyleWidth: 12 },
          },
          tooltip: {
            callbacks: {
              label: (ctx: TooltipItem<'line'>) =>
                tooltipLine(ctx.dataset.label ?? '', ctx.parsed.y),
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            title: { display: true, text: 'Date', font: { size: 11 }, color: '#9ca3af' },
            ticks: { color: '#374151', font: { size: 10 }, maxRotation: 35 },
          },
          y: {
            type: 'linear' as const,
            position: 'left' as const,
            title: { display: true, text: seriesList[0]?.unit ?? '', font: { size: 11 }, color: '#6b7280' },
            ticks: { color: '#6b7280', font: { size: 11 }, callback: (v: string | number) => formatChartTick(v) },
            grid: { color: 'rgba(0,0,0,0.06)' },
          },
          ...(useDual ? {
            y1: {
              type: 'linear' as const,
              position: 'right' as const,
              title: { display: true, text: seriesList[1]?.unit ?? '', font: { size: 11 }, color: '#6b7280' },
              ticks: { color: '#6b7280', font: { size: 11 }, callback: (v: string | number) => formatChartTick(v) },
              grid: { drawOnChartArea: false },
            },
          } : {}),
        },
      } as never}
    />
  );
}

// ── Inline charts body (individual series + scatter + combined comparison) ────

export interface AnalysisChartsBodyProps {
  seriesList: NormalizedSeries[];
  loading: boolean;
  scatterX: AnalysisVariableId;
  scatterY: AnalysisVariableId;
}

/**
 * Renders all available analysis charts (individual series, scatter correlation,
 * combined comparison) inline — no modal, no "Open Charts" click required.
 */
const AnalysisChartsBody = ({ seriesList, loading, scatterX, scatterY }: AnalysisChartsBodyProps) => {
  const active  = seriesList.filter((s) => s.points.length > 0);
  const xSeries = seriesList.find((s) => s.variable === scatterX) ?? seriesList[0];
  const ySeries = seriesList.find((s) => s.variable === scatterY) ?? seriesList[1];

  if (loading) {
    return (
      <div className="acm-loading">
        <div className="acm-spinner" />
        <span>Loading analysis data…</span>
      </div>
    );
  }

  if (seriesList.length === 0) {
    return <p className="acm-empty">Select variables above to see charts.</p>;
  }

  if (active.length === 0) {
    return <p className="acm-empty">No data available for the selected variables in this period.</p>;
  }

  return (
    <>
      <div className="acm-section-label">Individual Series</div>
      <div className="acm-grid">
        {active.map((s) => (
          <SingleChartCard key={s.id} series={s} />
        ))}
      </div>

      {active.length >= 2 && xSeries && ySeries && xSeries.id !== ySeries.id && (
        <>
          <div className="acm-section-label" style={{ marginTop: 24 }}>Scatter Correlation</div>
          <div className="acm-grid acm-grid-scatter">
            <ScatterCard xSeries={xSeries} ySeries={ySeries} />
          </div>
        </>
      )}

      {active.length >= 2 && (
        <>
          <div className="acm-section-label" style={{ marginTop: 24 }}>Combined Comparison</div>
          <div className="acm-combined-chart">
            <CombinedChart seriesList={active} />
          </div>
        </>
      )}
    </>
  );
};

export default AnalysisChartsBody;
