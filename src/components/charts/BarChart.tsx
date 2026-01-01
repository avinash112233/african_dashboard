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

interface BarChartProps {
  data?: any;
}

const BarChart = ({ data }: BarChartProps) => {
  // Sample data - replace with actual API data
  const defaultLabels = ['Nairobi', 'Lagos', 'Johannesburg', 'Cairo', 'Lusaka'];
  const defaultValues = [0.45, 0.52, 0.38, 0.61, 0.41];

  const chartData = {
    labels: defaultLabels,
    datasets: [
      {
        label: 'AOD Values',
        data: defaultValues,
        backgroundColor: [
          'rgba(255, 99, 132, 0.5)',
          'rgba(54, 162, 235, 0.5)',
          'rgba(255, 206, 86, 0.5)',
          'rgba(75, 192, 192, 0.5)',
          'rgba(153, 102, 255, 0.5)',
        ],
        borderColor: [
          'rgba(255, 99, 132, 1)',
          'rgba(54, 162, 235, 1)',
          'rgba(255, 206, 86, 1)',
          'rgba(75, 192, 192, 1)',
          'rgba(153, 102, 255, 1)',
        ],
        borderWidth: 1,
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
        text: 'Bar Chart Analysis',
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: 'AOD Value',
        },
      },
      x: {
        title: {
          display: true,
          text: 'Location',
        },
      },
    },
  };

  return <Bar data={chartData} options={options} />;
};

export default BarChart;



