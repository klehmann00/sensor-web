// app/sessions/[sessionId]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import StorageManager from '@/lib/managers/StorageManager';
import { database } from '@/lib/firebase';
import AccelerometerChart from '@/components/sensors/AccelerometerChart';
import GyroscopeChart from '@/components/sensors/GyroscopeChart';
import MagnetometerChart from '@/components/sensors/MagnetometerChart';

interface Vector3D {
  x: number;
  y: number;
  z: number;
  timestamp: number;
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

export default function SessionDetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const sessionId = params.sessionId as string;
  const isLiveMode = searchParams.get('live') === 'true';
  const { user, loading } = useAuth();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  // Fetch session detail (static or live)
  useEffect(() => {
    if (!user || !sessionId) return;

    setIsLoading(true);
    setError(null);

    if (isLiveMode) {
      // Set up real-time listener for live mode
      const unsubscribe = StorageManager.listenToSessionDetail(
        user.uid,
        sessionId,
        (sessionDetail) => {
          if (!sessionDetail) {
            setError('Session not found');
          } else {
            setSession(sessionDetail);
          }
          setIsLoading(false);
        }
      );

      return () => {
        unsubscribe();
      };
    } else {
      // One-time fetch for static view
      const fetchSessionDetail = async () => {
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

      fetchSessionDetail();
    }
  }, [user, sessionId, isLiveMode]);

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

  const toggleLiveMode = () => {
    if (isLiveMode) {
      router.push(`/sessions/${sessionId}`);
    } else {
      router.push(`/sessions/${sessionId}?live=true`);
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

  const maxScrollPosition = session
    ? Math.max(0, Math.max(
        session.accelerometerData.length,
        session.gyroscopeData.length,
        session.magnetometerData.length
      ) - WINDOW_SIZE)
    : 0;

  const handlePrev = () => {
    setScrollPosition(Math.max(0, scrollPosition - WINDOW_SIZE));
  };

  const handleNext = () => {
    setScrollPosition(Math.min(maxScrollPosition, scrollPosition + WINDOW_SIZE));
  };

  const totalDataPoints = session
    ? Math.max(
        session.accelerometerData.length,
        session.gyroscopeData.length,
        session.magnetometerData.length
      )
    : 0;

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
        <div className="max-w-6xl mx-auto">
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
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold text-gray-800">Session Details</h1>
                {isLiveMode && (
                  <div className="flex items-center gap-2 bg-red-100 px-3 py-1 rounded-full">
                    <div className="animate-pulse w-2 h-2 bg-red-600 rounded-full"></div>
                    <span className="text-xs font-semibold text-red-600 uppercase">LIVE</span>
                  </div>
                )}
              </div>
              <p className="text-gray-600">{user.email}</p>
            </div>
            <div className="flex gap-3">
              {session && session.status === 'recording' && (
                <button
                  onClick={toggleLiveMode}
                  className={`px-4 py-2 rounded-lg font-semibold ${
                    isLiveMode
                      ? 'bg-gray-600 text-white hover:bg-gray-700'
                      : 'bg-orange-600 text-white hover:bg-orange-700'
                  }`}
                >
                  {isLiveMode ? '⏸️ Stop Live Mode' : '🔴 Enable Live Mode'}
                </button>
              )}
              <button
                onClick={() => router.push(`/analysis/${sessionId}`)}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
              >
                📊 Analyze
              </button>
              <button
                onClick={() => router.push(`/calibration/${sessionId}`)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                📐 Calibrate
              </button>
              <button
                onClick={() => router.push('/sessions')}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Back to Sessions
              </button>
            </div>
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
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-600">Session ID</div>
                  <div className="font-semibold text-gray-800">{session.sessionId}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Status</div>
                  <div>
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        session.status === 'completed'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {session.status}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Start Time</div>
                  <div className="font-semibold text-gray-800">{formatDate(session.startTime)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">End Time</div>
                  <div className="font-semibold text-gray-800">
                    {session.endTime ? formatDate(session.endTime) : 'In Progress'}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Duration</div>
                  <div className="font-semibold text-gray-800">
                    {formatDuration(session.startTime, session.endTime)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Total Data Points</div>
                  <div className="font-semibold text-gray-800">
                    {(
                      session.accelerometerData.length +
                      session.gyroscopeData.length +
                      session.magnetometerData.length
                    ).toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    A: {session.accelerometerData.length.toLocaleString()} |
                    G: {session.gyroscopeData.length.toLocaleString()} |
                    M: {session.magnetometerData.length.toLocaleString()}
                  </div>
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

            {/* Charts */}
            <div className="space-y-6">
              {session.accelerometerData.length > 0 && (
                <AccelerometerChart data={getSlicedData(session.accelerometerData)} />
              )}
              {session.gyroscopeData.length > 0 && (
                <GyroscopeChart data={getSlicedData(session.gyroscopeData)} />
              )}
              {session.magnetometerData.length > 0 && (
                <MagnetometerChart data={getSlicedData(session.magnetometerData)} />
              )}

              {session.accelerometerData.length === 0 &&
                session.gyroscopeData.length === 0 &&
                session.magnetometerData.length === 0 && (
                  <div className="bg-white rounded-lg shadow-lg p-6">
                    <div className="text-center text-gray-600">
                      No sensor data available for this session.
                    </div>
                  </div>
                )}
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
