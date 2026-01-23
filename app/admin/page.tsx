// app/admin/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useAdmin } from '@/contexts/AdminContext';
import { ref, get } from 'firebase/database';
import { database } from '@/lib/firebase';
import StorageManager from '@/lib/managers/StorageManager';

interface UserData {
  email: string;
  isAdmin: boolean;
  createdAt: number;
}

export default function AdminPage() {
  const { user, loading } = useAuth();
  const { isAdmin, loading: adminLoading } = useAdmin();
  const router = useRouter();
  const [users, setUsers] = useState<Record<string, UserData>>({});
  const [sessions, setSessions] = useState<any[]>([]);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
    }

    if (!adminLoading && !isAdmin) {
      router.push('/dashboard');
    }
  }, [user, loading, isAdmin, adminLoading, router]);

  useEffect(() => {
    const loadAdminData = async () => {
      if (!database) return;

      try {
        // Initialize StorageManager
        StorageManager.initialize(database);

        // Load users
        const usersRef = ref(database, 'users');
        const usersSnapshot = await get(usersRef);
        if (usersSnapshot.exists()) {
          const usersData = usersSnapshot.val();
          setUsers(usersData);

          // Load sessions from each user
          const sessionsList = [];
          for (const userId in usersData) {
            const userSessions = await StorageManager.getUserSessions(userId);
            for (const session of userSessions) {
              sessionsList.push({
                userId,
                userEmail: usersData[userId].email,
                ...session
              });
            }
          }

          setSessions(sessionsList);
        }
      } catch (error) {
        console.error('Error loading admin data:', error);
      }
    };

    if (isAdmin) {
      loadAdminData();
    }
  }, [isAdmin]);

  const handleDeleteSession = async (userId: string, sessionId: string) => {
    const confirmed = window.confirm(
      `Delete session ${sessionId}? This cannot be undone.`
    );

    if (!confirmed) return;

    try {
      const success = await StorageManager.deleteSession(userId, sessionId);
      if (success) {
        // Refresh sessions list
        setSessions(sessions.filter(s => !(s.userId === userId && s.id === sessionId)));
      } else {
        alert('Failed to delete session');
      }
    } catch (error) {
      console.error('Error deleting session:', error);
      alert('Error deleting session');
    }
  };

  if (loading || adminLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-2xl text-gray-700">Loading...</div>
      </main>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <main className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold text-gray-800">Admin Panel</h1>

            <button
              onClick={() => router.push('/dashboard')}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              Back to Dashboard
            </button>
          </div>
        </div>

        {/* Users Section */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-2xl font-bold mb-4 text-gray-800">Users</h2>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-2 text-left">Email</th>
                  <th className="px-4 py-2 text-left">Admin</th>
                  <th className="px-4 py-2 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(users).map(([uid, userData]) => (
                  <tr key={uid} className="border-b">
                    <td className="px-4 py-2">{userData.email}</td>
                    <td className="px-4 py-2">
                      {userData.isAdmin ? (
                        <span className="text-green-600 font-semibold">Yes</span>
                      ) : (
                        <span className="text-gray-600">No</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {new Date(userData.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sessions Section */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-2xl font-bold mb-4 text-gray-800">Session Management</h2>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-2 text-left">Session ID</th>
                  <th className="px-4 py-2 text-left">User Email</th>
                  <th className="px-4 py-2 text-left">Start Time</th>
                  <th className="px-4 py-2 text-left">Data Points</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-sm">{session.id}</td>
                    <td className="px-4 py-2">{session.userEmail || users[session.userId]?.email || session.userId}</td>
                    <td className="px-4 py-2">
                      {new Date(session.startTime).toLocaleString()}
                    </td>
                    <td className="px-4 py-2">
                      <div className="text-sm">
                        <div className="font-semibold">{session.dataPoints?.toLocaleString() || 0} total</div>
                        {session.accelerometerPoints !== undefined && (
                          <div className="text-xs text-gray-500">
                            A: {session.accelerometerPoints} | G: {session.gyroscopePoints} | M: {session.magnetometerPoints}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`px-2 py-1 rounded text-sm ${
                          session.status === 'completed'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {session.status}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => handleDeleteSession(session.userId, session.id)}
                        className="text-red-600 hover:text-red-900 font-medium"
                      >
                        🗑️ Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {sessions.length === 0 && (
              <p className="text-gray-600 text-center py-4">No sessions found</p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
