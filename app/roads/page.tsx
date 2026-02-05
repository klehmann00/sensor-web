'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { getAllRoads, RoadCell } from '@/lib/firebase/roadDatabase';
import dynamic from 'next/dynamic';

const RoadsMap = dynamic(() => import('./RoadsMap'), {
  ssr: false,
  loading: () => <div className="h-full bg-gray-100 flex items-center justify-center">Loading map...</div>
});

export default function RoadsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [roads, setRoads] = useState<RoadCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
    }
  }, [user, authLoading, router]);

  // Load roads from Firebase
  useEffect(() => {
    const loadRoads = async () => {
      try {
        const roadData = await getAllRoads();
        setRoads(roadData);
      } catch (e) {
        console.error('Failed to load roads:', e);
        setError('Failed to load road data');
      } finally {
        setLoading(false);
      }
    };

    if (user) {
      loadRoads();
    }
  }, [user]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/dashboard')}
            className="text-gray-600 hover:text-gray-800"
          >
            &larr; Dashboard
          </button>
          <h1 className="text-xl font-semibold">Road Roughness Map</h1>
        </div>
        <div className="text-sm text-gray-500">
          {loading ? 'Loading...' : `${roads.length} road cells`}
        </div>
      </div>

      {/* Legend */}
      <div className="bg-white border-b px-4 py-2 flex items-center gap-6 text-sm">
        <span className="text-gray-600">Roughness:</span>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full" style={{ backgroundColor: 'rgb(34, 197, 94)' }}></div>
          <span>Smooth</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full" style={{ backgroundColor: 'rgb(234, 179, 8)' }}></div>
          <span>Moderate</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full" style={{ backgroundColor: 'rgb(239, 68, 68)' }}></div>
          <span>Rough</span>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1">
        {error ? (
          <div className="h-full flex items-center justify-center text-red-600">
            {error}
          </div>
        ) : loading ? (
          <div className="h-full flex items-center justify-center text-gray-600">
            Loading road data...
          </div>
        ) : (
          <RoadsMap roads={roads} />
        )}
      </div>
    </div>
  );
}
