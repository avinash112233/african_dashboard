import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

interface WavelengthBarChartProps {
  data?: { AOD_500nm?: number; AOD_675nm?: number; AOD_870nm?: number; AOD_1020nm?: number }[];
}

const WavelengthBarChart = ({ data }: WavelengthBarChartProps) => {
  const wavelengths = [
    { key: 'AOD_500nm', label: '500 nm' },
    { key: 'AOD_675nm', label: '675 nm' },
    { key: 'AOD_870nm', label: '870 nm' },
    { key: 'AOD_1020nm', label: '1020 nm' },
  ] as const;
  const hasData = data && data.length > 0 && data.some((d) =>
    wavelengths.some((w) => (d[w.key] ?? null) != null && !isNaN(d[w.key] as number))
  );
  const values = hasData
    ? wavelengths.map((w) => {
        const vals = data!.map((d) => d[w.key]).filter((v) => v != null && !isNaN(v));
        return vals.length > 0 ? vals.reduce((a, b) => a! + b!, 0)! / vals.length : null;
      })
    : [null, null, null, null];

  const chartData = {
    labels: wavelengths.map((w) => w.label),
    datasets: [
      {
        label: 'Mean AOD',
        data: values,
        backgroundColor: [
          'rgba(59, 130, 246, 0.6)',
          'rgba(34, 197, 94, 0.6)',
          'rgba(234, 179, 8, 0.6)',
          'rgba(239, 68, 68, 0.6)',
        ],
        borderColor: [
          'rgb(59, 130, 246)',
          'rgb(34, 197, 94)',
          'rgb(234, 179, 8)',
          'rgb(239, 68, 68)',
        ],
        borderWidth: 1,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' as const },
      title: {
        display: true,
        text: 'AOD by Wavelength',
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: { display: true, text: 'AOD Value' },
      },
      x: {
        title: { display: true, text: 'Wavelength' },
      },
    },
  };

  return <Bar data={chartData} options={options} />;
};

export default WavelengthBarChart;
