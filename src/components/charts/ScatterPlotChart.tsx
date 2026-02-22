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

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface ScatterPlotChartProps {
  data?: { date: string; AOD_500nm?: number; AOD_675nm?: number; AOD_870nm?: number; AOD_1020nm?: number }[];
}

const ScatterPlotChart = ({ data }: ScatterPlotChartProps) => {
  const hasData = data && data.length > 0 && data.some((d) => (d.AOD_500nm ?? d.AOD_675nm) != null);
  const points = hasData
    ? data!.map((d) => ({
        x: d.AOD_500nm ?? d.AOD_675nm ?? 0,
        y: d.AOD_675nm ?? d.AOD_870nm ?? d.AOD_500nm ?? 0,
      })).filter((p) => !isNaN(p.x) && !isNaN(p.y))
    : Array.from({ length: 30 }, (_, i) => ({ x: i * 0.02 + 0.2, y: Math.random() * 0.3 + 0.1 }));

  const chartData = {
    datasets: [
      {
        label: 'Spectral AOD Correlation (AOD 500nm vs 675nm)',
        data: points,
        backgroundColor: 'rgba(255, 99, 132, 0.5)',
        borderColor: 'rgba(255, 99, 132, 1)',
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
        text: 'Scatter Plot Analysis',
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: 'AOD 675nm',
        },
      },
      x: {
        title: {
          display: true,
          text: 'AOD 500nm',
        },
      },
    },
  };

  return <Scatter data={chartData} options={options} />;
};

export default ScatterPlotChart;



