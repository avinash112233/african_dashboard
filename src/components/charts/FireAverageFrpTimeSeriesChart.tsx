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
import type { FireDailyStats } from '../../utils/fireAnalytics';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface FireAverageFrpTimeSeriesChartProps {
  dailyStats: FireDailyStats[];
  startDate: dayjs.Dayjs;
  endDate: dayjs.Dayjs;
}

const FireAverageFrpTimeSeriesChart = ({ dailyStats, startDate, endDate }: FireAverageFrpTimeSeriesChartProps) => {
  const dateToTotalFrp = new Map<string, number | null>();
  for (const item of dailyStats) dateToTotalFrp.set(item.date, item.totalFrp);

  const labels: string[] = [];
  const values: (number | null)[] = [];
  for (let d = startDate.startOf('day'); !d.isAfter(endDate.startOf('day'), 'day'); d = d.add(1, 'day')) {
    const key = d.format('YYYY-MM-DD');
    labels.push(formatDisplayDate(key));
    values.push(dateToTotalFrp.get(key) ?? null);
  }

  const hasAnyFrp = values.some((v) => v != null && Number.isFinite(v));
  if (!hasAnyFrp) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>
        No FRP values available in this range.
      </div>
    );
  }

  return (
    <Line
      data={{
        labels,
        datasets: [
          {
            label: 'Total FRP per day',
            data: values,
            borderColor: 'rgb(249, 115, 22)',
            backgroundColor: 'rgba(249, 115, 22, 0.22)',
            pointBackgroundColor: 'rgb(249, 115, 22)',
            pointRadius: 3,
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
          legend: { position: 'top' as const },
          title: { display: true, text: 'Total FRP Time Series' },
          tooltip: {
            callbacks: {
              label: (ctx: { label?: string; parsed?: { y: number | null } }) => {
                const y = ctx.parsed?.y;
                if (y == null || !Number.isFinite(y)) return `${ctx.label ?? ''}: No FRP`;
                return `${ctx.label ?? ''}: Total FRP ${y.toFixed(2)} MW`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Total FRP (MW)' },
            grid: { color: 'rgba(0, 0, 0, 0.06)' },
          },
          x: {
            title: { display: true, text: 'Date' },
            grid: { color: 'rgba(0, 0, 0, 0.06)' },
          },
        },
      }}
    />
  );
};

export default FireAverageFrpTimeSeriesChart;
