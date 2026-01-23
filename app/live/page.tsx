// app/live/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import StorageManager from '@/lib/managers/StorageManager';
import { database } from '@/lib/firebase';

interface ActiveSession {
  userId: string;
  userEmail: string;
  sessionId: string;
  startTime: number;
  status: string;
  dataPoints: number;
}

export default function LiveMonitorPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [filteredSessions, setFilteredSessions] = useState<ActiveSession[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>('all');
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

  // Set up real-time listener
  useEffect(() => {
    if (!user) return;

    setIsLoading(true);

    const unsubscribe = StorageManager.listenToActiveSessions((sessions) => {
      setActiveSessions(sessions);
      setIsLoading(false);
    });

    return () => {
      unsubscribe();
    };
  }, [user]);

  // Filter sessions by user
  useEffect(() => {
    if (selectedUser === 'all') {
      setFilteredSessions(activeSessions);
    } else {
      setFilteredSessions(activeSessions.filter(s => s.userEmail === selectedUser));
    }
  }, [activeSessions, selectedUser]);

  // Get unique user emails for filter
  const uniqueUsers = Array.from(new Set(activeSessions.map(s => s.userEmail)));

  const formatTimeAgo = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ago`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
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
          <div className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">🔴 Live Monitoring Dashboard</h1>
              <p className="text-gray-600">Real-time active recording sessions</p>
            </div>
            <button
              onClick={() => router.push('/dashboard')}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Back to Dashboard
            </button>
          </div>

          {/* User Filter */}
          {uniqueUsers.length > 0 && (
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700">Filter by user:</label>
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Users ({activeSessions.length})</option>
                {uniqueUsers.map((email) => (
                  <option key={email} value={email}>
                    {email} ({activeSessions.filter(s => s.userEmail === email).length})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Active Sessions List */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-gray-800">Active Sessions</h2>
            <div className="flex items-center gap-2">
              <div className="animate-pulse w-3 h-3 bg-red-600 rounded-full"></div>
              <span className="text-sm text-gray-600">Live Updates</span>
            </div>
          </div>

          {isLoading ? (
            <div className="text-center py-8">
              <div className="text-gray-600">Loading active sessions...</div>
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-gray-600">
                {selectedUser === 'all'
                  ? 'No active recording sessions'
                  : `No active sessions for ${selectedUser}`}
              </div>
              <button
                onClick={() => router.push('/dashboard')}
                className="mt-4 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Start Recording
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredSessions.map((session) => (
                <div
                  key={`${session.userId}-${session.sessionId}`}
                  className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="animate-pulse w-2 h-2 bg-red-600 rounded-full"></div>
                        <span className="text-xs font-semibold text-red-600 uppercase">LIVE</span>
                      </div>

                      <div className="grid md:grid-cols-2 gap-3 mb-3">
                        <div>
                          <div className="text-xs text-gray-500">User</div>
                          <div className="font-semibold text-gray-800">{session.userEmail}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Session ID</div>
                          <div className="font-mono text-sm text-gray-700">{session.sessionId}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Started</div>
                          <div className="text-sm text-gray-700">
                            {formatTimeAgo(session.startTime)}
                            <div className="text-xs text-gray-400">{formatDate(session.startTime)}</div>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Data Points</div>
                          <div className="text-lg font-bold text-blue-600">
                            {session.dataPoints.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => router.push(`/sessions/${session.sessionId}?live=true`)}
                      className="ml-4 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold whitespace-nowrap"
                    >
                      👁️ Watch
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="bg-white rounded-lg shadow-lg p-6 mt-6">
          <h2 className="text-xl font-bold mb-4">About Live Monitoring</h2>
          <ul className="list-disc list-inside space-y-2 text-gray-700">
            <li>Real-time updates using Firebase listeners</li>
            <li>Shows all active recording sessions across all users</li>
            <li>Data point counter updates automatically</li>
            <li>Click "Watch" to view live session details with charts</li>
            <li>Filter by user email to focus on specific users</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
