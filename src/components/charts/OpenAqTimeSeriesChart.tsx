import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import dayjs from 'dayjs';
import { formatDisplayDate } from '../../utils/dateFormat';
import { chartPluginsBase, formatChartTick } from '../../utils/chartFormat';
import type { OpenAqTimeseriesPoint } from '../../services/openaqApi';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface OpenAqTimeSeriesChartProps {
  points: OpenAqTimeseriesPoint[];
  startDate: dayjs.Dayjs;
  endDate: dayjs.Dayjs;
}

const OpenAqTimeSeriesChart = ({ points, startDate, endDate }: OpenAqTimeSeriesChartProps) => {
  const byDate = new Map(points.map((p) => [p.date, p.pm25]));

  const labels: string[] = [];
  const values: (number | null)[] = [];
  for (let d = startDate.startOf('day'); !d.isAfter(endDate.startOf('day'), 'day'); d = d.add(1, 'day')) {
    const key = d.format('YYYY-MM-DD');
    labels.push(formatDisplayDate(key));
    values.push(byDate.get(key) ?? null);
  }

  if (!values.some((v) => v != null && Number.isFinite(v))) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>
        No OpenAQ PM2.5 data in this range.
      </div>
    );
  }

  const totalDays = labels.length;
  const isLongRange = totalDays > 90;
  const maxTicksLimit = totalDays > 365 ? 10 : totalDays > 180 ? 12 : totalDays > 90 ? 14 : 16;

  return (
    <Line
      data={{
        labels,
        datasets: [
          {
            label: 'Daily mean PM2.5',
            data: values,
            borderColor: 'rgb(37, 99, 235)',
            backgroundColor: 'rgba(37, 99, 235, 0.2)',
            pointBackgroundColor: 'rgb(37, 99, 235)',
            pointRadius: isLongRange ? 1.5 : 3,
            fill: true,
            tension: 0.35,
            spanGaps: true,
          },
        ],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          ...chartPluginsBase,
          legend: { position: 'top' as const },
          title: { display: true, text: 'OpenAQ Ground PM2.5 Daily Mean Time Series' },
          tooltip: {
            callbacks: {
              label: (ctx: { parsed?: { y: number | null } }) => {
                const y = ctx.parsed?.y;
                if (y == null || !Number.isFinite(y)) return 'No PM2.5';
                return `PM2.5: ${y.toFixed(2)} µg/m³`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'PM2.5 (µg/m³)' },
            ticks: { callback: (v: string | number) => formatChartTick(v) },
            grid: { color: 'rgba(0, 0, 0, 0.06)' },
          },
          x: {
            title: { display: true, text: 'Date' },
            grid: { color: 'rgba(0, 0, 0, 0.06)' },
            ticks: {
              autoSkip: true,
              maxTicksLimit,
              maxRotation: 35,
              minRotation: 0,
            },
          },
        },
      }}
    />
  );
};

export default OpenAqTimeSeriesChart;
