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
import { chartPluginsBase } from '../../utils/chartFormat';
import type { WashUTimeseriesPoint } from '../../services/washuApi';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface WashUTimeSeriesChartProps {
  points: WashUTimeseriesPoint[];
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  title?: string;
  granularity?: 'monthly' | 'annual';
  emptyMessage?: string;
}

function normalizeRange(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): { startYear: number; startMonth: number; endYear: number; endMonth: number } {
  let sy = startYear;
  let sm = Math.max(1, Math.min(12, startMonth));
  let ey = endYear;
  let em = Math.max(1, Math.min(12, endMonth));
  if (sy > ey || (sy === ey && sm > em)) {
    [sy, ey] = [ey, sy];
    [sm, em] = [em, sm];
  }
  return { startYear: sy, startMonth: sm, endYear: ey, endMonth: em };
}

function buildMonthlySeries(
  points: WashUTimeseriesPoint[],
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
) {
  const byPeriod = new Map(points.map((p) => [p.period, p.pm25]));
  const labels: string[] = [];
  const values: (number | null)[] = [];
  const tooltips: string[] = [];

  let y = startYear;
  let m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    const period = `${y}-${String(m).padStart(2, '0')}`;
    labels.push(`${MONTHS[m - 1]} ${y}`);
    tooltips.push(period);
    values.push(byPeriod.get(period) ?? null);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  return { labels, values, tooltips };
}

function buildAnnualSeries(points: WashUTimeseriesPoint[], startYear: number, endYear: number) {
  const byPeriod = new Map(points.map((p) => [String(p.year ?? p.period), p.pm25]));
  const labels: string[] = [];
  const values: (number | null)[] = [];
  const tooltips: string[] = [];
  for (let y = startYear; y <= endYear; y += 1) {
    const key = String(y);
    labels.push(key);
    tooltips.push(key);
    values.push(byPeriod.get(key) ?? null);
  }
  return { labels, values, tooltips };
}

const WashUTimeSeriesChart = ({
  points,
  startYear,
  startMonth,
  endYear,
  endMonth,
  title = 'WashU monthly PM2.5',
  granularity = 'monthly',
  emptyMessage,
}: WashUTimeSeriesChartProps) => {
  const range = normalizeRange(startYear, startMonth, endYear, endMonth);
  const { labels, values, tooltips } =
    granularity === 'annual'
      ? buildAnnualSeries(points, range.startYear, range.endYear)
      : buildMonthlySeries(
          points,
          range.startYear,
          range.startMonth,
          range.endYear,
          range.endMonth
        );

  const hasAnyData = values.some((v) => v != null && Number.isFinite(v));
  const monthCount = labels.length;
  const showEveryMonth = monthCount <= 18;
  const tickStep = monthCount <= 12 ? 1 : monthCount <= 24 ? 2 : monthCount <= 36 ? 3 : 4;

  if (!hasAnyData) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#94a3b8',
          fontSize: 12,
          textAlign: 'center',
          padding: '0 16px',
        }}
      >
        No WashU PM2.5 data in this range.
        {emptyMessage ?? (granularity === 'annual'
          ? ' Adjust the year range and click Apply.'
          : ' Adjust the range and click Apply — first load downloads monthly NetCDF files from AWS.')}
      </div>
    );
  }

  return (
    <Line
      data={{
        labels,
        datasets: [
          {
            label: 'PM2.5 (µg/m³)',
            data: values,
            borderColor: '#756bb1',
            backgroundColor: 'rgba(117, 107, 177, 0.15)',
            pointBackgroundColor: '#756bb1',
            pointBorderColor: '#5a4d96',
            pointRadius: 4,
            pointHoverRadius: 5,
            spanGaps: false,
            tension: 0.15,
            fill: true,
          },
        ],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          ...chartPluginsBase,
          title: { display: true, text: title, font: { size: 14, weight: 'bold' } },
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => {
                const idx = items[0]?.dataIndex ?? 0;
                return tooltips[idx] ?? labels[idx] ?? '';
              },
              label: (item) => {
                const v = item.parsed.y;
                if (v == null || !Number.isFinite(v)) return 'PM2.5: no data';
                return `PM2.5: ${v.toFixed(2)} µg/m³`;
              },
            },
          },
        },
        scales: {
          x: {
            title: { display: true, text: granularity === 'annual' ? 'Year' : 'Month', font: { size: 12, weight: 'bold' } },
            ticks: {
              autoSkip: !showEveryMonth,
              maxRotation: 45,
              minRotation: monthCount > 12 ? 35 : 0,
              maxTicksLimit: showEveryMonth ? monthCount : Math.ceil(monthCount / tickStep),
              callback: (_value, index) => {
                if (index < 0 || index >= labels.length) return '';
                if (showEveryMonth || index % tickStep === 0 || index === labels.length - 1) {
                  return labels[index];
                }
                return '';
              },
            },
            grid: { display: false },
          },
          y: {
            title: { display: true, text: 'µg/m³' },
            beginAtZero: true,
          },
        },
      }}
    />
  );
};

export default WashUTimeSeriesChart;
