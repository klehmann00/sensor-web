// components/sensors/GyroscopeChart.tsx
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

interface GyroscopeChartProps {
  data: Vector3D[];
}

export default function GyroscopeChart({ data }: GyroscopeChartProps) {
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
          label: 'X',
          data: xValues,
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.5)',
          borderWidth: 2,
          pointRadius: 0,
        },
        {
          label: 'Y',
          data: yValues,
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139, 92, 246, 0.5)',
          borderWidth: 2,
          pointRadius: 0,
        },
        {
          label: 'Z',
          data: zValues,
          borderColor: '#ec4899',
          backgroundColor: 'rgba(236, 72, 153, 0.5)',
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
        min: -250,
        max: 250,
        ticks: {
          stepSize: 100,
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

  const isOutOfRange = (value: number) => value < -250 || value > 250;
  const hasOutOfRange = recentData.some(point =>
    isOutOfRange(point.x) || isOutOfRange(point.y) || isOutOfRange(point.z)
  );

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">Gyroscope History (°/s)</h2>
      {hasOutOfRange && (
        <div className="bg-yellow-100 border border-yellow-400 text-yellow-800 px-3 py-2 rounded mb-2 text-sm">
          ⚠️ Values exceeding normal range (-250 to +250 °/s) detected
        </div>
      )}
      <div style={{ height: '300px' }}>
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
}
