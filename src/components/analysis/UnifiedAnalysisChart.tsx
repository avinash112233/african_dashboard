import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import type { TooltipItem } from 'chart.js';
import { Line, Scatter } from 'react-chartjs-2';
import { formatDisplayDate } from '../../utils/dateFormat';
import {
  chartPluginsBase,
  formatChartTick,
  tooltipLine,
} from '../../utils/chartFormat';
import { alignSeriesByDate, unionDatesFromSeries } from '../../analysis/alignSeries';
import type { AnalysisChartMode, NormalizedSeries } from '../../analysis/types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const SERIES_COLORS = ['#2563eb', '#dc2626', '#059669', '#7c3aed'];

const tickStyle = { color: '#6b7280', font: { size: 11 } };

interface UnifiedAnalysisChartProps {
  seriesList: NormalizedSeries[];
  mode: AnalysisChartMode;
  scatterXId?: string;
  scatterYId?: string;
}

const UnifiedAnalysisChart = ({
  seriesList,
  mode,
  scatterXId,
  scatterYId,
}: UnifiedAnalysisChartProps) => {
  const active = seriesList.filter((s) => s.points.length > 0);

  if (active.length === 0) {
    return <p className="analysis-chart-empty">No data available for the selected range.</p>;
  }

  if (mode === 'scatter') {
    const xSeries = active.find((s) => s.id === scatterXId) ?? active[0];
    const ySeries = active.find((s) => s.id === scatterYId) ?? active[1] ?? active[0];
    const aligned = alignSeriesByDate([xSeries, ySeries]);
    const points = aligned.map((row) => ({
      x: row.values[xSeries.id],
      y: row.values[ySeries.id],
    }));

    return (
      <Scatter
        data={{
          datasets: [
            {
              label: `${ySeries.label} vs ${xSeries.label}`,
              data: points,
              backgroundColor: 'rgba(37, 99, 235, 0.55)',
              borderColor: '#2563eb',
              pointRadius: 4,
              pointHoverRadius: 6,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            ...chartPluginsBase,
            legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 11 } } },
            title: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx: TooltipItem<'scatter'>) => {
                  const x = ctx.parsed.x;
                  const y = ctx.parsed.y;
                  return [
                    `${xSeries.label}: ${formatChartTick(x)}`,
                    `${ySeries.label}: ${formatChartTick(y)}`,
                  ];
                },
              },
            },
          },
          scales: {
            x: {
              title: { display: true, text: xSeries.label, font: { size: 11 } },
              ticks: { ...tickStyle, callback: (v: string | number) => formatChartTick(v) },
            },
            y: {
              title: { display: true, text: ySeries.label, font: { size: 11 } },
              ticks: { ...tickStyle, callback: (v: string | number) => formatChartTick(v) },
            },
          },
        }}
      />
    );
  }

  const dates = unionDatesFromSeries(active);
  const labels = dates.map((d) => formatDisplayDate(d));
  const datasets = active.map((s, i) => {
    const byDate = new Map(s.points.map((p) => [p.time.slice(0, 10), p.value]));
    return {
      label: s.label,
      data: dates.map((d) => {
        const v = byDate.get(d);
        return v != null && Number.isFinite(v) ? Number(v.toFixed(2)) : null;
      }),
      borderColor: SERIES_COLORS[i % SERIES_COLORS.length],
      backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length],
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: 2,
      tension: 0.25,
      spanGaps: true,
      yAxisID: i === 0 ? 'y' : 'y1',
    };
  });

  const useDualAxis = active.length >= 2;

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
            position: 'top',
            labels: { boxWidth: 12, font: { size: 11 }, padding: 10 },
          },
          title: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: TooltipItem<'line'>) =>
                tooltipLine(ctx.dataset.label ?? 'Value', ctx.parsed.y),
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#374151', font: { size: 10 }, maxRotation: 35 },
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            title: { display: true, text: active[0]?.unit ?? '', font: { size: 11 } },
            ticks: { ...tickStyle, callback: (v: string | number) => formatChartTick(v) },
            grid: { color: 'rgba(0,0,0,0.06)' },
          },
          ...(useDualAxis
            ? {
                y1: {
                  type: 'linear' as const,
                  display: true,
                  position: 'right' as const,
                  title: { display: true, text: active[1]?.unit ?? '', font: { size: 11 } },
                  ticks: { ...tickStyle, callback: (v: string | number) => formatChartTick(v) },
                  grid: { drawOnChartArea: false },
                },
              }
            : {}),
        },
      }}
    />
  );
};

export default UnifiedAnalysisChart;
