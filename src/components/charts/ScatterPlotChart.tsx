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
  const hasData = !!data && data.some((d) => d.AOD_500nm != null && d.AOD_675nm != null && !isNaN(d.AOD_500nm as number) && !isNaN(d.AOD_675nm as number));
  const points =
    hasData && data
      ? data
          .map((d) => ({
            x: d.AOD_500nm as number | undefined,
            y: d.AOD_675nm as number | undefined,
          }))
          .filter((p) => p.x != null && p.y != null && !isNaN(p.x) && !isNaN(p.y))
      : [];

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

  if (!hasData) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>
        No AOD data in this range.
      </div>
    );
  }

  return <Scatter data={chartData} options={options} />;
};

export default ScatterPlotChart;



