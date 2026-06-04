import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import type { TooltipItem } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { Bar } from 'react-chartjs-2';
import dayjs from 'dayjs';
import { getAqiBarLabelColor, getAqiCategory } from '../../utils/aqiUtils';

/** Register chart.js components only — datalabels is scoped to this chart via `plugins={[ChartDataLabels]}`. */
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export interface AAQEForecastBarPoint {
  date: string;
  aqi: number;
}

interface AAQEThreeDayForecastChartProps {
  points: AAQEForecastBarPoint[];
}

const AAQEThreeDayForecastChart = ({ points }: AAQEThreeDayForecastChartProps) => {
  const labels = points.map((p) =>
    dayjs(p.date).format('ddd, MMM DD, YYYY')
  );
  const values = points.map((p) => Math.round(p.aqi));
  const colors = points.map((p) => getAqiCategory(p.aqi).color);

  return (
    <Bar
      plugins={[ChartDataLabels]}
      data={{
        labels,
        datasets: [
          {
            label: '3-Day AQI Forecast',
            data: values,
            backgroundColor: colors,
            borderColor: '#ffffff',
            borderWidth: 2,
            borderRadius: 6,
            barPercentage: 0.5,
            categoryPercentage: 0.6,
            maxBarThickness: 90,
          },
        ],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: { top: 10, bottom: 10, left: 15, right: 15 },
        },
        plugins: {
          legend: { display: false },
          title: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: TooltipItem<'bar'>) => {
                const y = ctx.parsed.y;
                const n = typeof y === 'number' ? y : Number(y);
                return `AQI: ${Number.isFinite(n) ? n.toFixed(2) : '—'}`;
              },
            },
          },
          datalabels: {
            display: true,
            color: (ctx) => {
              const val = ctx.dataset.data[ctx.dataIndex];
              return typeof val === 'number' ? getAqiBarLabelColor(val) : '#111827';
            },
            anchor: 'center',
            align: 'center',
            font: { size: 20, weight: 'bold' },
            formatter: (value) =>
              typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '',
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#000000', font: { size: 12 } },
          },
          y: {
            beginAtZero: true,
            suggestedMax: 120,
            ticks: { stepSize: 10, color: '#6b7280' },
            grid: { color: 'rgba(0,0,0,0.12)' },
          },
        },
      }}
    />
  );
};

export default AAQEThreeDayForecastChart;
