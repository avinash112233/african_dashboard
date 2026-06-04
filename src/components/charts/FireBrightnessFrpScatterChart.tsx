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
import { Scatter } from 'react-chartjs-2';
import { chartPluginsBase, formatChartTick } from '../../utils/chartFormat';
import { sampleForChart } from '../../utils/samplePoints';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

interface FireScatterPoint {
  x: number;
  y: number;
  confidence?: string;
}

interface FireBrightnessFrpScatterChartProps {
  points: FireScatterPoint[];
}

const confidenceColor = (confidence?: string) => {
  const c = (confidence ?? '').toLowerCase();
  if (c === 'high' || c === 'h') return 'rgba(220, 38, 38, 0.72)';
  if (c === 'nominal' || c === 'n') return 'rgba(249, 115, 22, 0.68)';
  return 'rgba(59, 130, 246, 0.62)';
};

function isScatterRaw(value: unknown): value is FireScatterPoint {
  if (!value || typeof value !== 'object') return false;
  const p = value as { x?: unknown; y?: unknown };
  return typeof p.x === 'number' && Number.isFinite(p.x) && typeof p.y === 'number' && Number.isFinite(p.y);
}

const SCATTER_CHART_MAX = 400;

const FireBrightnessFrpScatterChart = ({ points }: FireBrightnessFrpScatterChartProps) => {
  const chartPoints = sampleForChart(points, SCATTER_CHART_MAX);

  if (!chartPoints.length) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>
        No brightness/FRP pairs available.
      </div>
    );
  }

  return (
    <Scatter
      data={{
        datasets: [
          {
            label: 'Brightness vs FRP',
            data: chartPoints,
            backgroundColor: chartPoints.map((p) => confidenceColor(p.confidence)),
            borderColor: 'rgba(190, 24, 93, 0.9)',
            pointRadius: 3,
            pointHoverRadius: 5,
          },
        ],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          ...chartPluginsBase,
          legend: { position: 'top' as const },
          title: {
            display: true,
            text:
              points.length > SCATTER_CHART_MAX
                ? `Brightness vs FRP (${chartPoints.length} of ${points.length} shown)`
                : 'Brightness vs FRP Scatter Plot',
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                if (!isScatterRaw(ctx.raw)) return '';
                const raw = ctx.raw;
                const confidence = raw.confidence ? `, confidence: ${raw.confidence}` : '';
                return `Brightness: ${raw.x.toFixed(2)}, FRP: ${raw.y.toFixed(2)} MW${confidence}`;
              },
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: 'Brightness' },
            ticks: { callback: (v: string | number) => formatChartTick(v) },
            grid: { color: 'rgba(0, 0, 0, 0.06)' },
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'FRP (MW)' },
            ticks: { callback: (v: string | number) => formatChartTick(v) },
            grid: { color: 'rgba(0, 0, 0, 0.06)' },
          },
        },
      }}
    />
  );
};

export default FireBrightnessFrpScatterChart;
