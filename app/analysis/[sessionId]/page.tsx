// app/analysis/[sessionId]/page.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import StorageManager from '@/lib/managers/StorageManager';
import { database } from '@/lib/firebase';
import AccelerometerChart from '@/components/sensors/AccelerometerChart';

interface Vector3D {
  x: number;
  y: number;
  z: number;
  timestamp?: number;
}

interface SessionDetail {
  sessionId: string;
  startTime: number;
  endTime?: number;
  status: string;
  accelerometerData: Vector3D[];
  gyroscopeData: Vector3D[];
  magnetometerData: Vector3D[];
}

function applyDriftCompensation(data: Vector3D[], alpha: number): Vector3D[] {
  if (data.length === 0) return [];

  const filtered: Vector3D[] = [];
  let baseline = { x: 0, y: 0, z: 0 };

  data.forEach((point) => {
    // Update baseline (exponential moving average)
    baseline.x = alpha * baseline.x + (1 - alpha) * point.x;
    baseline.y = alpha * baseline.y + (1 - alpha) * point.y;
    baseline.z = alpha * baseline.z + (1 - alpha) * point.z;

    // Subtract baseline to get motion component
    filtered.push({
      x: point.x - baseline.x,
      y: point.y - baseline.y,
      z: point.z - baseline.z,
      timestamp: point.timestamp
    });
  });

  return filtered;
}

export default function AccelerometerAnalysisPage() {
  const router = useRouter();
  const params = useParams();
  const sessionId = params.sessionId as string;
  const { user, loading } = useAuth();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alpha, setAlpha] = useState(0.98);
  const [viewMode, setViewMode] = useState<'all' | 'scrollable'>('all');
  const [scrollPosition, setScrollPosition] = useState(0);

  // Auth guard
  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
    }
  }, [user, loading, router]);

  // Initialize storage manager
  useEffect(() => {
    StorageManager.initialize(database);
  }, []);

  // Fetch session detail
  useEffect(() => {
    const fetchSessionDetail = async () => {
      if (!user || !sessionId) return;

      setIsLoading(true);
      setError(null);
      try {
        const sessionDetail = await StorageManager.getSessionDetail(user.uid, sessionId);
        if (!sessionDetail) {
          setError('Session not found');
        } else {
          setSession(sessionDetail);
        }
      } catch (error) {
        console.error('Error fetching session detail:', error);
        setError('Failed to load session data');
      } finally {
        setIsLoading(false);
      }
    };

    if (user && sessionId) {
      fetchSessionDetail();
    }
  }, [user, sessionId]);

  // Apply drift compensation with current alpha value
  const compensatedData = useMemo(() => {
    if (!session) return [];
    return applyDriftCompensation(session.accelerometerData, alpha);
  }, [session, alpha]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatDuration = (startTime: number, endTime?: number) => {
    if (!endTime) return 'In Progress';
    const durationMs = endTime - startTime;
    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  // Data slicing logic
  const WINDOW_SIZE = 50;
  const getSlicedData = (data: Vector3D[]) => {
    if (viewMode === 'all' || data.length <= WINDOW_SIZE) {
      return data;
    }
    return data.slice(scrollPosition, scrollPosition + WINDOW_SIZE);
  };

  const totalDataPoints = session ? session.accelerometerData.length : 0;
  const maxScrollPosition = Math.max(0, totalDataPoints - WINDOW_SIZE);

  const handlePrev = () => {
    setScrollPosition(Math.max(0, scrollPosition - WINDOW_SIZE));
  };

  const handleNext = () => {
    setScrollPosition(Math.min(maxScrollPosition, scrollPosition + WINDOW_SIZE));
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="text-red-600 text-center">
              <h2 className="text-2xl font-bold mb-4">Error</h2>
              <p>{error}</p>
              <button
                onClick={() => router.push('/sessions')}
                className="mt-4 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Back to Sessions
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">📊 Accelerometer Analysis</h1>
              <p className="text-gray-600">Drift Compensation Filter</p>
            </div>
            <button
              onClick={() => router.push(`/sessions/${sessionId}`)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Back to Session
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="text-center py-8">
              <div className="text-gray-600">Loading session data...</div>
            </div>
          </div>
        ) : session ? (
          <>
            {/* Session Metadata */}
            <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
              <h2 className="text-2xl font-bold mb-4 text-gray-800">Session Information</h2>
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <div className="text-sm text-gray-600">Session ID</div>
                  <div className="font-semibold text-gray-800">{session.sessionId}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Start Time</div>
                  <div className="font-semibold text-gray-800">{formatDate(session.startTime)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Duration</div>
                  <div className="font-semibold text-gray-800">
                    {formatDuration(session.startTime, session.endTime)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Accelerometer Data Points</div>
                  <div className="font-semibold text-gray-800">
                    {session.accelerometerData.length.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>

            {/* Alpha Slider Control */}
            <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
              <h2 className="text-2xl font-bold mb-4 text-gray-800">Filter Settings</h2>
              <div className="max-w-2xl">
                <label className="block text-lg font-semibold text-gray-700 mb-3">
                  Drift Compensation (α): <span className="text-blue-600">{alpha.toFixed(2)}</span>
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="0.99"
                  step="0.01"
                  value={alpha}
                  onChange={(e) => setAlpha(parseFloat(e.target.value))}
                  className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <div className="flex justify-between text-sm text-gray-600 mt-2">
                  <span>0.50 (More responsive)</span>
                  <span>0.99 (More stable)</span>
                </div>
                <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-gray-700">
                    <strong>About Drift Compensation:</strong> This filter removes slow-changing drift from the
                    accelerometer signal while preserving rapid motions. Higher α values (closer to 0.99) provide
                    better drift removal but slower response to actual motion. Lower values are more responsive but
                    may retain some drift.
                  </p>
                </div>
              </div>
            </div>

            {/* Data View Controls */}
            {totalDataPoints > WINDOW_SIZE && (
              <div className="bg-white rounded-lg shadow-lg p-6">
                <h2 className="text-2xl font-bold mb-4 text-gray-800">Data View Controls</h2>

                {/* Toggle Buttons */}
                <div className="flex gap-3 mb-4">
                  <button
                    onClick={() => {
                      setViewMode('all');
                      setScrollPosition(0);
                    }}
                    className={`px-4 py-2 rounded-lg font-semibold ${
                      viewMode === 'all'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    All Data
                  </button>
                  <button
                    onClick={() => setViewMode('scrollable')}
                    className={`px-4 py-2 rounded-lg font-semibold ${
                      viewMode === 'scrollable'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    Scrollable View ({WINDOW_SIZE} pts)
                  </button>
                </div>

                {/* Scrollable Controls */}
                {viewMode === 'scrollable' && (
                  <div className="space-y-4">
                    {/* Navigation Buttons */}
                    <div className="flex items-center gap-4">
                      <button
                        onClick={handlePrev}
                        disabled={scrollPosition === 0}
                        className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                      >
                        ◀ Prev {WINDOW_SIZE}
                      </button>
                      <div className="flex-1 text-center text-gray-700 font-semibold">
                        Viewing points {scrollPosition + 1} to{' '}
                        {Math.min(scrollPosition + WINDOW_SIZE, totalDataPoints)} of{' '}
                        {totalDataPoints.toLocaleString()} total
                      </div>
                      <button
                        onClick={handleNext}
                        disabled={scrollPosition >= maxScrollPosition}
                        className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                      >
                        Next {WINDOW_SIZE} ▶
                      </button>
                    </div>

                    {/* Position Slider */}
                    <div>
                      <input
                        type="range"
                        min="0"
                        max={maxScrollPosition}
                        step="1"
                        value={scrollPosition}
                        onChange={(e) => setScrollPosition(parseInt(e.target.value))}
                        className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                      />
                      <div className="flex justify-between text-sm text-gray-600 mt-1">
                        <span>Start (0)</span>
                        <span>End ({maxScrollPosition})</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Side-by-Side Charts */}
            {session.accelerometerData.length > 0 ? (
              <div className="grid lg:grid-cols-2 gap-6">
                {/* Raw Data Chart */}
                <div>
                  <div className="bg-white rounded-lg shadow-lg p-4 mb-2">
                    <h3 className="text-lg font-bold text-gray-700">Raw Accelerometer Data</h3>
                    <p className="text-sm text-gray-600">Original unfiltered sensor readings</p>
                  </div>
                  <AccelerometerChart data={getSlicedData(session.accelerometerData)} />
                </div>

                {/* Compensated Data Chart */}
                <div>
                  <div className="bg-white rounded-lg shadow-lg p-4 mb-2">
                    <h3 className="text-lg font-bold text-gray-700">Drift-Compensated Accelerometer Data</h3>
                    <p className="text-sm text-gray-600">Filtered to remove sensor drift (α = {alpha.toFixed(2)})</p>
                  </div>
                  <AccelerometerChart data={getSlicedData(compensatedData)} />
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-lg p-6">
                <div className="text-center text-gray-600">
                  No accelerometer data available for this session.
                </div>
              </div>
            )}

            {/* Analysis Info */}
            <div className="bg-white rounded-lg shadow-lg p-6 mt-6">
              <h2 className="text-xl font-bold mb-4">About This Analysis</h2>
              <ul className="list-disc list-inside space-y-2 text-gray-700">
                <li>
                  <strong>Exponential Moving Average Filter:</strong> Tracks and removes slow-changing baseline drift
                </li>
                <li>
                  <strong>Real-time Processing:</strong> Adjust α slider to see immediate changes in filtered data
                </li>
                <li>
                  <strong>Motion Extraction:</strong> Isolates dynamic motion components from static gravity/drift
                </li>
                <li>
                  <strong>Use Cases:</strong> Step detection, gesture recognition, activity classification
                </li>
              </ul>
            </div>
          </>
        ) : (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="text-center text-gray-600">Session not found.</div>
          </div>
        )}
      </div>
    </div>
  );
}
