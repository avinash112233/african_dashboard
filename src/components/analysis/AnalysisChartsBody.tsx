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
import {
  combinedChartUsesMonthlyMeans,
  prepareSeriesListForCombinedChart,
  unionDatesFromSeries,
} from '../../analysis/alignSeries';
import type { AnalysisVariableId, NormalizedSeries } from '../../analysis/types';
import ScatterCorrelationCard from './ScatterCorrelationCard';
import './AnalysisChartsModal.css';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Title, Tooltip, Legend
);

const SOURCE_COLOR: Record<string, string> = {
  aeronet: '#2563eb',
  merra2:  '#16a34a',
  openaq:  '#0ea5e9',
  washu:   '#7c3aed',
  aaqe:    '#9333ea',
  firms:   '#dc2626',
};

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

// ── Combined comparison chart (shown in UI + exported to PDF) ─────────────────

interface CombinedChartProps {
  seriesList: NormalizedSeries[];
  monthlyMeans?: boolean;
}

function CombinedChart({ seriesList, monthlyMeans = false }: CombinedChartProps) {
  const prepared = prepareSeriesListForCombinedChart(seriesList);
  const dates = unionDatesFromSeries(prepared);
  const labels = dates.map(formatDisplayDate);
  const units = [...new Set(prepared.map((s) => s.unit).filter(Boolean))];
  const useDual = units.length > 1 && prepared.length >= 2;
  const primaryUnit = units[0] ?? '';
  const secondaryUnit = units[1] ?? '';

  const datasets = prepared.map((s) => {
    const byDate = new Map(s.points.map((p) => [p.time.slice(0, 10), p.value]));
    const color = SOURCE_COLOR[s.source] ?? '#6b7280';
    const yAxisID = !useDual ? 'y' : s.unit === primaryUnit ? 'y' : 'y1';
    const pointCount = s.points.length;
    return {
      label: `${s.label}${s.unit ? ` (${s.unit})` : ''}`,
      data: dates.map((d) => {
        const v = byDate.get(d);
        return v != null && Number.isFinite(v) ? Number(v.toFixed(3)) : null;
      }),
      borderColor: color,
      backgroundColor: `${color}22`,
      pointRadius: pointCount <= 3 ? 6 : 3,
      pointHoverRadius: pointCount <= 3 ? 8 : 5,
      borderWidth: 2,
      tension: 0.25,
      spanGaps: false,
      fill: false,
      yAxisID,
    };
  });

  return (
    <>
      {monthlyMeans && (
        <p className="acm-scatter-caption acm-combined-caption">
          WashU is monthly only — daily series are averaged by month so all sources share the same time step.
        </p>
      )}
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
              title: { display: true, text: monthlyMeans ? 'Month' : 'Date', font: { size: 11 }, color: '#9ca3af' },
              ticks: { color: '#374151', font: { size: 10 }, maxRotation: 35 },
            },
            y: {
              type: 'linear' as const,
              position: 'left' as const,
              title: {
                display: true,
                text: useDual ? primaryUnit : prepared[0]?.unit ?? '',
                font: { size: 11 },
                color: '#6b7280',
              },
              ticks: { color: '#6b7280', font: { size: 11 }, callback: (v: string | number) => formatChartTick(v) },
              grid: { color: 'rgba(0,0,0,0.06)' },
            },
            ...(useDual
              ? {
                  y1: {
                    type: 'linear' as const,
                    position: 'right' as const,
                    title: { display: true, text: secondaryUnit, font: { size: 11 }, color: '#6b7280' },
                    ticks: {
                      color: '#6b7280',
                      font: { size: 11 },
                      callback: (v: string | number) => formatChartTick(v),
                    },
                    grid: { drawOnChartArea: false },
                  },
                }
              : {}),
          },
        } as never}
      />
    </>
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
          <div className="acm-section-label acm-section-label--spaced">Scatter Correlation</div>
          <div className="acm-grid acm-grid-scatter">
            <ScatterCorrelationCard xSeries={xSeries} ySeries={ySeries} />
          </div>
        </>
      )}

      {active.length >= 2 && (
        <>
          <div className="acm-section-label acm-section-label--spaced">Combined Comparison</div>
          <div className="acm-combined-chart">
            <CombinedChart
              seriesList={active}
              monthlyMeans={combinedChartUsesMonthlyMeans(active)}
            />
          </div>
        </>
      )}
    </>
  );
};

export default AnalysisChartsBody;
