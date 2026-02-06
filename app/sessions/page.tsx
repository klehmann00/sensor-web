// app/sessions/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useAdmin } from '@/contexts/AdminContext';
import StorageManager from '@/lib/managers/StorageManager';
import { database } from '@/lib/firebase';
import { Vehicle, getUserVehicles } from '@/lib/firebase/vehicleDatabase';

interface Session {
  id: string;
  startTime: number;
  endTime?: number;
  status: string;
  dataPoints: number;
  accelerometerPoints: number;
  gyroscopePoints: number;
  magnetometerPoints: number;
  vehicleId?: string;
}

export default function SessionsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { isAdmin } = useAdmin();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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

  // Fetch sessions
  useEffect(() => {
    const fetchSessions = async () => {
      if (!user) return;

      setIsLoading(true);
      try {
        const userSessions = await StorageManager.getUserSessions(user.uid);
        setSessions(userSessions);
      } catch (error) {
        console.error('Error fetching sessions:', error);
      } finally {
        setIsLoading(false);
      }
    };

    if (user) {
      fetchSessions();
    }
  }, [user]);

  // Fetch vehicles
  useEffect(() => {
    const fetchVehicles = async () => {
      if (!user) return;
      try {
        const userVehicles = await getUserVehicles(user.uid);
        setVehicles(userVehicles);
      } catch (error) {
        console.error('Error fetching vehicles:', error);
      }
    };
    if (user) {
      fetchVehicles();
    }
  }, [user]);

  const getVehicleName = (vehicleId?: string) => {
    if (!vehicleId) return 'Unknown';
    const vehicle = vehicles.find(v => v.id === vehicleId);
    if (!vehicle) return 'Unknown';
    return vehicle.nickname || `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  };

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

  const handleDelete = async (sessionId: string) => {
    if (!user) return;

    const confirmed = window.confirm(
      `Delete session ${sessionId}? This cannot be undone.`
    );

    if (!confirmed) return;

    try {
      const success = await StorageManager.deleteSession(user.uid, sessionId);
      if (success) {
        // Refresh the sessions list
        const userSessions = await StorageManager.getUserSessions(user.uid);
        setSessions(userSessions);
      } else {
        alert('Failed to delete session');
      }
    } catch (error) {
      console.error('Error deleting session:', error);
      alert('Error deleting session');
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">Recording Sessions</h1>
              <p className="text-gray-600">{user.email}</p>
            </div>
            <button
              onClick={() => router.push('/dashboard')}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Back to Dashboard
            </button>
          </div>
        </div>

        {/* Sessions List */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-2xl font-bold mb-4 text-gray-800">Your Sessions</h2>

          {isLoading ? (
            <div className="text-center py-8">
              <div className="text-gray-600">Loading sessions...</div>
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-gray-600">No recording sessions yet.</div>
              <button
                onClick={() => router.push('/dashboard')}
                className="mt-4 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Start Recording
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Session ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Vehicle
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Start Time
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Duration
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Data Points
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sessions.map((session) => (
                    <tr key={session.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {session.id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {getVehicleName((session as any).vehicleId)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(session.startTime)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDuration(session.startTime, session.endTime)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            (session as any).recording === false || session.status === 'completed'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {(session as any).recording === false || session.status === 'completed' ? 'completed' : 'recording'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <div>
                          <div className="font-semibold">{session.dataPoints.toLocaleString()} total</div>
                          <div className="text-xs text-gray-400">
                            A: {session.accelerometerPoints} | G: {session.gyroscopePoints} | M: {session.magnetometerPoints}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex gap-3">
                          <button
                            onClick={() => router.push(`/calibration/${session.id}`)}
                            className="text-indigo-600 hover:text-indigo-900"
                          >
                            📐 Calibrate
                          </button>
                          {isAdmin && (
                            <button
                              onClick={() => handleDelete(session.id)}
                              className="text-red-600 hover:text-red-900"
                            >
                              🗑️ Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
