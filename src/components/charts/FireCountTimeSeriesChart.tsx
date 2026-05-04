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

interface FireCountTimeSeriesChartProps {
  dailyStats: FireDailyStats[];
  startDate: dayjs.Dayjs;
  endDate: dayjs.Dayjs;
}

const FireCountTimeSeriesChart = ({ dailyStats, startDate, endDate }: FireCountTimeSeriesChartProps) => {
  const dateToCount = new Map<string, number>();
  for (const item of dailyStats) dateToCount.set(item.date, item.count);

  const labels: string[] = [];
  const values: number[] = [];
  for (let d = startDate.startOf('day'); !d.isAfter(endDate.startOf('day'), 'day'); d = d.add(1, 'day')) {
    const key = d.format('YYYY-MM-DD');
    labels.push(formatDisplayDate(key));
    values.push(dateToCount.get(key) ?? 0);
  }

  const hasAnyFire = values.some((v) => v > 0);
  if (!hasAnyFire) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>
        No fire detections in this range.
      </div>
    );
  }

  return (
    <Line
      data={{
        labels,
        datasets: [
          {
            label: 'Fire detections per day',
            data: values,
            borderColor: 'rgb(239, 68, 68)',
            backgroundColor: 'rgba(239, 68, 68, 0.22)',
            pointBackgroundColor: 'rgb(239, 68, 68)',
            pointRadius: 3,
            fill: true,
            tension: 0.35,
          },
        ],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' as const },
          title: { display: true, text: 'Fire Count Time Series' },
        },
        scales: {
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Fire detections' },
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

export default FireCountTimeSeriesChart;
