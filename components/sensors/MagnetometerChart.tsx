// components/sensors/MagnetometerChart.tsx
'use client';

import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface Vector3D {
  x: number;
  y: number;
  z: number;
  timestamp?: number;
}

interface MagnetometerChartProps {
  data: Vector3D[];
}

export default function MagnetometerChart({ data }: MagnetometerChartProps) {
  // Use all data provided by parent
  const recentData = useMemo(() => data, [data]);

  // Transform data for chart
  const chartData = useMemo(() => {
    const indices = recentData.map((_, index) => index.toString());
    const xValues = recentData.map(point => point.x);
    const yValues = recentData.map(point => point.y);
    const zValues = recentData.map(point => point.z);

    return {
      labels: indices,
      datasets: [
        {
          label: 'Alpha',
          data: xValues,
          borderColor: '#f97316',
          backgroundColor: 'rgba(249, 115, 22, 0.5)',
          borderWidth: 2,
          pointRadius: 0,
        },
        {
          label: 'Beta',
          data: yValues,
          borderColor: '#14b8a6',
          backgroundColor: 'rgba(20, 184, 166, 0.5)',
          borderWidth: 2,
          pointRadius: 0,
        },
        {
          label: 'Gamma',
          data: zValues,
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.5)',
          borderWidth: 2,
          pointRadius: 0,
        }
      ]
    };
  }, [recentData]);

  const options: ChartOptions<'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      x: {
        display: true,
        ticks: {
          callback: function(value, index) {
            const numValue = typeof value === 'number' ? value : parseInt(value as string);
            if (numValue % 100 === 0) {
              if (numValue >= 1000) {
                return (numValue / 1000).toFixed(1) + 'k';
              }
              return numValue.toString();
            }
            return '';
          },
          maxRotation: 0,
          autoSkip: false
        }
      },
      y: {
        min: 0,
        max: 360,
        ticks: {
          stepSize: 90,
        }
      }
    },
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
      },
      tooltip: {
        callbacks: {
          title: (context) => {
            const index = context[0].dataIndex;
            const point = recentData[index];
            return point ? new Date(point.timestamp || Date.now()).toLocaleTimeString() : '';
          },
          label: (context) => {
            const value = context.parsed.y;
            return `${context.dataset.label}: ${value !== null ? value.toFixed(2) : '0.00'}`;
          }
        }
      }
    }
  }), [recentData]);

  const isOutOfRange = (value: number) => value < 0 || value > 360;
  const hasOutOfRange = recentData.some(point =>
    isOutOfRange(point.x) || isOutOfRange(point.y) || isOutOfRange(point.z)
  );

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">Magnetometer/Orientation History</h2>
      {hasOutOfRange && (
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-800 px-3 py-2 rounded mb-2 text-sm">
          ⚠️ Values exceeding normal range (0 to 360°) detected
        </div>
      )}
      <div style={{ height: '300px' }}>
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
}
