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
import { formatDisplayDate, normalizeAeronetDate } from '../../utils/dateFormat';
import { getAODLevelColor } from '../../utils/aodUtils';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface TimeSeriesChartProps {
  /** Daily mean AOD data (can contain missing values as undefined) */
  data?: { date: string; AOD_500nm?: number; AOD_675nm?: number; AOD_870nm?: number; AOD_1020nm?: number }[];
  /** Inclusive date range to show on the X-axis */
  startDate: dayjs.Dayjs;
  endDate: dayjs.Dayjs;
}

const TimeSeriesChart = ({ data, startDate, endDate }: TimeSeriesChartProps) => {
  const hasData = data && data.length > 0 && data.some((d) => d.AOD_500nm != null && !isNaN(d.AOD_500nm as number));

  // Build map of date -> primary AOD value (500nm preferred)
  const dateToAod = new Map<string, number>();
  if (hasData && data) {
    for (const d of data) {
      const key = normalizeAeronetDate(d.date);
      if (key === '—') continue;
      const v = d.AOD_500nm;
      if (v != null && !isNaN(v)) dateToAod.set(key, v);
    }
  }

  const start = startDate.startOf('day');
  const end = endDate.startOf('day');

  const labels: string[] = [];
  const values: (number | null)[] = [];
  for (let d = start.clone(); !d.isAfter(end, 'day'); d = d.add(1, 'day')) {
    const key = d.format('YYYY-MM-DD');
    labels.push(formatDisplayDate(key));
    values.push(dateToAod.has(key) ? (dateToAod.get(key) ?? null) : null);
  }

  // Color points by AOD level
  const pointColors = values.map((v) => (v != null ? getAODLevelColor(v) : 'rgba(150,150,150,0.5)'));

  const chartData = {
    labels,
    datasets: [
      {
        label: 'AOD 500nm (daily mean)',
        data: values,
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        pointBackgroundColor: pointColors.length ? pointColors : undefined,
        pointBorderColor: pointColors.length ? pointColors : undefined,
        pointRadius: 3,
        fill: true,
        tension: 0.4,
        spanGaps: true,
        segment: {
          borderColor: (ctx: { p0DataIndex?: number; p1DataIndex?: number; dataset?: { data?: (number | null)[] } }) => {
            const arr = ctx?.dataset?.data;
            if (!arr || ctx.p0DataIndex == null || ctx.p1DataIndex == null) return undefined;
            const v0 = arr[ctx.p0DataIndex];
            const v1 = arr[ctx.p1DataIndex];
            const hasGap = v0 == null || v1 == null;
            return hasGap ? 'rgba(150, 150, 150, 0.6)' : undefined;
          },
          borderDash: (ctx: { p0DataIndex?: number; p1DataIndex?: number; dataset?: { data?: (number | null)[] } }) => {
            const arr = ctx?.dataset?.data;
            if (!arr || ctx.p0DataIndex == null || ctx.p1DataIndex == null) return [];
            const v0 = arr[ctx.p0DataIndex];
            const v1 = arr[ctx.p1DataIndex];
            const hasGap = v0 == null || v1 == null;
            return hasGap ? [6, 4] : [];
          },
        },
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: 'Timeseries Analysis',
      },
      tooltip: {
        callbacks: {
          label: (ctx: { label?: string; parsed?: { y: number | null } }) => {
            const val = ctx.parsed?.y;
            if (val == null || (typeof val === 'number' && isNaN(val))) {
              return `${ctx.label ?? ''}: No measurement`;
            }
            return `${ctx.label ?? ''}: ${Number(val).toFixed(3)}`;
          },
        },
      },
    },
    scales: {
      y: {
        beginAtZero: false,
        title: {
          display: true,
          text: 'AOD',
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.06)',
        },
      },
      x: {
        title: {
          display: true,
          text: 'Time',
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.06)',
        },
      },
    },
  };

  return <Line data={chartData} options={options} />;
};

export default TimeSeriesChart;



