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
  data?: any;
}

const ScatterPlotChart = ({ data }: ScatterPlotChartProps) => {
  // Sample data - replace with actual API data
  const generateSampleData = () => {
    return Array.from({ length: 50 }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 1,
    }));
  };

  const chartData = {
    datasets: [
      {
        label: 'AOD vs PM2.5',
        data: generateSampleData(),
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
          text: 'AOD',
        },
      },
      x: {
        title: {
          display: true,
          text: 'PM2.5 (μg/m³)',
        },
      },
    },
  };

  return <Scatter data={chartData} options={options} />;
};

export default ScatterPlotChart;



