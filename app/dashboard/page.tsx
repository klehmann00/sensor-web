// app/dashboard/page.tsx
'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useSensors } from '@/lib/hooks/useSensors';
import { useAdmin } from '@/contexts/AdminContext';
import SensorDisplay from '@/components/sensors/SensorDisplay';
import AccelerometerChart from '@/components/sensors/AccelerometerChart';
import GyroscopeChart from '@/components/sensors/GyroscopeChart';
import MagnetometerChart from '@/components/sensors/MagnetometerChart';
import StorageManager from '@/lib/managers/StorageManager';
import { database } from '@/lib/firebase';
import { Vehicle, getUserVehicles, getDefaultVehicle, addVehicle } from '@/lib/firebase/vehicleDatabase';
import VehicleSelector from '@/components/vehicles/VehicleSelector';
import AddVehicleModal from '@/components/vehicles/AddVehicleModal';

interface Vector3D {
  x: number;
  y: number;
  z: number;
  timestamp?: number;
}

const MAX_RECORDING_SECONDS = 300; // 5 minutes

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const { isAdmin } = useAdmin();
  const {
    accelerometer,
    gyroscope,
    magnetometer,
    isActive,
    startSensors,
    stopSensors,
    requestPermission,
    permissionGranted,
    speed,
  } = useSensors();

  const [isRecording, setIsRecording] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [dataPoints, setDataPoints] = useState(0);
  const [recordingSecondsLeft, setRecordingSecondsLeft] = useState(MAX_RECORDING_SECONDS);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Vehicle state
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [showAddVehicleModal, setShowAddVehicleModal] = useState(false);

  // NEW: History arrays for charts (max 100 points)
  const [accelHistory, setAccelHistory] = useState<Vector3D[]>([]);
  const [gyroHistory, setGyroHistory] = useState<Vector3D[]>([]);
  const [magHistory, setMagHistory] = useState<Vector3D[]>([]);
  const MAX_HISTORY_POINTS = 100;
  const [isMobile, setIsMobile] = useState(false);

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

  // Detect mobile vs desktop
  useEffect(() => {
    const checkMobile = () => {
      const hasSensors = typeof DeviceMotionEvent !== 'undefined';
      const isSmallScreen = window.innerWidth <= 768;
      setIsMobile(hasSensors && isSmallScreen);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Load user's vehicles
  useEffect(() => {
    const loadVehicles = async () => {
      if (!user) return;
      const userVehicles = await getUserVehicles(user.uid);
      setVehicles(userVehicles);
      const defaultVehicle = await getDefaultVehicle(user.uid);
      if (defaultVehicle) {
        setSelectedVehicleId(defaultVehicle.id);
      }
    };
    loadVehicles();
  }, [user]);

  // NEW: Update history arrays when sensor data changes
  useEffect(() => {
    if (isActive && accelerometer) {
      setAccelHistory(prev => {
        const newData = {
          ...accelerometer,
          timestamp: Date.now()
        };
        const updated = [...prev, newData];
        // Keep only last MAX_HISTORY_POINTS
        return updated.slice(-MAX_HISTORY_POINTS);
      });
    }
  }, [accelerometer, isActive]);

  useEffect(() => {
    if (isActive && gyroscope) {
      setGyroHistory(prev => {
        const newData = {
          ...gyroscope,
          timestamp: Date.now()
        };
        const updated = [...prev, newData];
        return updated.slice(-MAX_HISTORY_POINTS);
      });
    }
  }, [gyroscope, isActive]);

  useEffect(() => {
    if (isActive && magnetometer) {
      setMagHistory(prev => {
        const newData = {
          ...magnetometer,
          timestamp: Date.now()
        };
        const updated = [...prev, newData];
        return updated.slice(-MAX_HISTORY_POINTS);
      });
    }
  }, [magnetometer, isActive]);

  // Store data to Firebase when recording
  useEffect(() => {
    if (isRecording && sessionId && user && isActive && accelerometer) {
      StorageManager.storeSensorData(
        user.uid,
        sessionId,
        'accelerometer',
        {
          ...accelerometer,
          timestamp: Date.now(),
        }
      );
      setDataPoints(prev => prev + 1);
    }
  }, [accelerometer, isRecording, sessionId, user, isActive]);

  // Store gyroscope data to Firebase when recording
  useEffect(() => {
    if (isRecording && sessionId && user && isActive && gyroscope) {
      StorageManager.storeSensorData(
        user.uid,
        sessionId,
        'gyroscope',
        {
          ...gyroscope,
          timestamp: Date.now(),
        }
      );
      setDataPoints(prev => prev + 1);
    }
  }, [gyroscope, isRecording, sessionId, user, isActive]);

  // Store magnetometer data to Firebase when recording
  useEffect(() => {
    if (isRecording && sessionId && user && isActive && magnetometer) {
      StorageManager.storeSensorData(
        user.uid,
        sessionId,
        'magnetometer',
        {
          ...magnetometer,
          timestamp: Date.now(),
        }
      );
      setDataPoints(prev => prev + 1);
    }
  }, [magnetometer, isRecording, sessionId, user, isActive]);

  // Store GPS speed data to Firebase when recording
  useEffect(() => {
    if (isRecording && sessionId && user && isActive && speed) {
      StorageManager.storeGPSData(
        user.uid,
        sessionId,
        {
          mph: speed.mph,
          kph: speed.kph,
          mps: speed.kph / 3.6, // Convert to m/s for calculations
          lat: speed.lat,
          lng: speed.lng,
          timestamp: Date.now(),
        }
      );
    }
  }, [speed, isRecording, sessionId, user, isActive]);

  const handleStart = async () => {
    if (!user) return;

    // Start sensors first
    const cleanup = await startSensors();
    if (!cleanup) {
      alert('Failed to start sensors. Make sure you granted permission.');
      return;
    }

    // Create session and start recording
    const newSessionId = `session_${Date.now()}`;
    await StorageManager.startRecordingSession(user.uid, newSessionId, selectedVehicleId || undefined);
    setSessionId(newSessionId);
    setIsRecording(true);
    setDataPoints(0);
    setRecordingSecondsLeft(MAX_RECORDING_SECONDS);

    // Request Wake Lock to keep screen on
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      }
    } catch (e) {
      console.warn('Wake Lock not supported or failed:', e);
    }
  };

  const handleStop = async () => {
    console.log('handleStop called', { isRecording, sessionId, userId: user?.uid });
    try {
      // Stop recording
      if (user && sessionId) {
        console.log('Calling StorageManager.stopRecording...');
        await StorageManager.stopRecording(user.uid, sessionId);
        console.log('StorageManager.stopRecording completed');
      }
      setIsRecording(false);
      console.log('Recording state set to false');

      // Stop sensors and clear history
      stopSensors();
      console.log('Sensors stopped');
      setAccelHistory([]);
      setGyroHistory([]);
      setMagHistory([]);

      // Release Wake Lock
      if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
          wakeLockRef.current = null;
        } catch (e) {
          console.warn('Failed to release Wake Lock:', e);
        }
      }
    } catch (error) {
      console.error('handleStop failed:', error);
    }
  };

  // Auto-stop timer
  useEffect(() => {
    if (!isRecording) return;

    const interval = setInterval(() => {
      setRecordingSecondsLeft(prev => {
        if (prev <= 1) {
          handleStop();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRecording]);

  const handleLogout = async () => {
    if (isRecording || isActive) {
      await handleStop();
    }
    await logout();
    router.push('/');
  };

  const handleAddVehicle = async (vehicleData: { year: number; make: string; model: string; nickname?: string }) => {
    if (!user) return;
    try {
      const newVehicleId = await addVehicle(user.uid, {
        ...vehicleData,
        isDefault: vehicles.length === 0
      });
      // Refresh vehicles list
      const updatedVehicles = await getUserVehicles(user.uid);
      setVehicles(updatedVehicles);
      setSelectedVehicleId(newVehicleId);
      setShowAddVehicleModal(false);
    } catch (e) {
      console.error('Failed to add vehicle:', e);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">Sensor Dashboard</h1>
              <p className="text-gray-600">{user.email}</p>
            </div>
            <div className="flex gap-3">
              {isAdmin && (
                <button
                  onClick={() => router.push('/admin')}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                >
                  Admin Panel
                </button>
              )}
              <button
                onClick={() => router.push('/sessions')}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                View Sessions
              </button>
              <button
                onClick={() => router.push('/roads')}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
              >
                Road Map
              </button>
              <button
                onClick={() => router.push('/live')}
                className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
              >
                🔴 Live Monitor
              </button>
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Logout
              </button>
            </div>
          </div>

          {/* Desktop Warning */}
          {!isMobile && (
            <div className="bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-3 rounded mb-4">
              ℹ️ Sensor recording is only available on mobile devices. Use a phone or tablet to record sensor data.
            </div>
          )}

          {/* Permission Warning (Mobile Only) */}
          {isMobile && !permissionGranted && (
            <div className="bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-3 rounded mb-4">
              ⚠️ Sensor permission not granted. Click "Start Recording" to request access.
            </div>
          )}

          {/* Recording Status */}
          {isRecording && (
            <div className="bg-green-100 border border-green-400 text-green-800 px-4 py-3 rounded mb-4">
              🔴 Recording... {dataPoints} data points | {Math.floor(recordingSecondsLeft / 60)}:{(recordingSecondsLeft % 60).toString().padStart(2, '0')} remaining
            </div>
          )}

          {/* GPS Speed Display */}
          {isActive && speed && (
            <div className="bg-blue-100 border border-blue-400 text-blue-800 px-4 py-3 rounded mb-4">
              🚗 Speed: {speed.mph} mph ({speed.kph} kph)
            </div>
          )}

          {/* Controls (Mobile Only) */}
          {isMobile && (
            <div className="flex flex-wrap gap-3 items-center">
              <VehicleSelector
                vehicles={vehicles}
                selectedVehicleId={selectedVehicleId}
                onSelect={setSelectedVehicleId}
                onAddNew={() => setShowAddVehicleModal(true)}
              />
              {!isRecording ? (
                <button
                  onClick={handleStart}
                  className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold"
                >
                  ▶️ Start Recording
                </button>
              ) : (
                <button
                  onClick={handleStop}
                  className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 font-semibold"
                >
                  ⏹️ Stop Recording
                </button>
              )}
            </div>
          )}
        </div>

        {/* Sensor Displays */}
        <div className="grid md:grid-cols-3 gap-6 mb-6">
          <SensorDisplay
            title="Accelerometer (m/s²)"
            data={accelerometer}
            color="#3b82f6"
          />
          <SensorDisplay
            title="Gyroscope (°/s)"
            data={gyroscope}
            color="#f59e0b"
          />
          <SensorDisplay
            title="Magnetometer (°)"
            data={magnetometer}
            color="#f97316"
          />
        </div>

        {/* Charts - NOW with history arrays */}
        {isActive && accelHistory.length > 0 && (
          <div className="space-y-6">
            <AccelerometerChart data={accelHistory.slice(-50)} />
            <GyroscopeChart data={gyroHistory.slice(-50)} />
            <MagnetometerChart data={magHistory.slice(-50)} />
          </div>
        )}
      </div>

      {/* Add Vehicle Modal */}
      <AddVehicleModal
        isOpen={showAddVehicleModal}
        onClose={() => setShowAddVehicleModal(false)}
        onSave={handleAddVehicle}
      />
    </div>
  );
}
