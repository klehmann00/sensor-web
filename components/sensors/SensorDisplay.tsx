// components/sensors/SensorDisplay.tsx
'use client';

interface SensorDisplayProps {
  title: string;
  data: {
    x: number;
    y: number;
    z: number;
  };
  color?: string;
}

export default function SensorDisplay({ title, data, color = '#667eea' }: SensorDisplayProps) {
  return (
    <div className="bg-white rounded-lg shadow-lg p-6 mb-4">
      <h3 className="text-xl font-bold mb-4" style={{ color }}>
        {title}
      </h3>

      <div className="grid grid-cols-3 gap-4">
        <div className="text-center">
          <div className="text-sm text-gray-600 mb-1">X</div>
          <div className="text-3xl font-bold" style={{ color }}>
            {data.x.toFixed(2)}
          </div>
        </div>

        <div className="text-center">
          <div className="text-sm text-gray-600 mb-1">Y</div>
          <div className="text-3xl font-bold" style={{ color }}>
            {data.y.toFixed(2)}
          </div>
        </div>

        <div className="text-center">
          <div className="text-sm text-gray-600 mb-1">Z</div>
          <div className="text-3xl font-bold" style={{ color }}>
            {data.z.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}
