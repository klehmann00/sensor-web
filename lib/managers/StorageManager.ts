// lib/managers/StorageManager.ts
import { ref, set, get, push, remove, update, Database, onValue, off } from 'firebase/database';

interface SensorData {
  timestamp: number;
  x: number;
  y: number;
  z: number;
  [key: string]: any;
}

class StorageManager {
  private database: Database | null = null;

  initialize(database: Database) {
    this.database = database;
  }

  async startRecordingSession(userId: string, sessionId: string, vehicleId?: string): Promise<boolean> {
    if (!this.database) throw new Error('StorageManager not initialized');

    try {
      const sessionRef = ref(this.database, `users/${userId}/sessions/${sessionId}`);
      await set(sessionRef, {
        startTime: Date.now(),
        status: 'recording',
        metadata: {
          vehicleId: vehicleId || null
        }
      });
      return true;
    } catch (error) {
      console.error('Error starting session:', error);
      return false;
    }
  }

  async endRecordingSession(userId: string, sessionId: string): Promise<boolean> {
    if (!this.database) throw new Error('StorageManager not initialized');

    try {
      const sessionRef = ref(this.database, `users/${userId}/sessions/${sessionId}`);
      const snapshot = await get(sessionRef);
      const sessionData = snapshot.val();

      await set(sessionRef, {
        ...sessionData,
        endTime: Date.now(),
        status: 'completed'
      });
      return true;
    } catch (error) {
      console.error('Error ending session:', error);
      return false;
    }
  }

  async stopRecording(userId: string, sessionId: string): Promise<boolean> {
    if (!this.database) throw new Error('StorageManager not initialized');

    try {
      const sessionRef = ref(this.database, `users/${userId}/sessions/${sessionId}`);
      await update(sessionRef, {
        endTime: Date.now(),
        status: 'completed',
        recording: false
      });
      return true;
    } catch (error) {
      console.error('Error stopping recording:', error);
      return false;
    }
  }

  async storeSensorData(
    userId: string,
    sessionId: string,
    sensorType: 'accelerometer' | 'gyroscope' | 'magnetometer',
    data: SensorData
  ): Promise<boolean> {
    if (!this.database) throw new Error('StorageManager not initialized');

    try {
      const dataRef = ref(this.database, `users/${userId}/sessions/${sessionId}/sensorData/${sensorType}`);
      await push(dataRef, data);
      return true;
    } catch (error) {
      console.error('Error storing sensor data:', error);
      return false;
    }
  }

  async storeGPSData(
    userId: string,
    sessionId: string,
    data: { mph: number; kph: number; mps: number; lat: number; lng: number; timestamp: number }
  ): Promise<boolean> {
    if (!this.database) throw new Error('StorageManager not initialized');

    try {
      const dataRef = ref(this.database, `users/${userId}/sessions/${sessionId}/sensorData/gps`);
      await push(dataRef, data);
      return true;
    } catch (error) {
      console.error('Error storing GPS data:', error);
      return false;
    }
  }

  async getSessionData(userId: string, sessionId: string): Promise<any> {
    if (!this.database) throw new Error('StorageManager not initialized');

    try {
      const sessionRef = ref(this.database, `users/${userId}/sessions/${sessionId}/sensorData`);
      const snapshot = await get(sessionRef);
      return snapshot.val();
    } catch (error) {
      console.error('Error getting session data:', error);
      return null;
    }
  }

  async getUserSessions(userId: string): Promise<any[]> {
    if (!this.database) throw new Error('StorageManager not initialized');

    try {
      // Get session metadata
      const sessionsRef = ref(this.database, `users/${userId}/sessions`);
      const sessionsSnapshot = await get(sessionsRef);

      if (!sessionsSnapshot.exists()) return [];

      const sessions: any[] = [];

      // For each session, get the data counts
      for (const sessionChild of Object.entries(sessionsSnapshot.val())) {
        const [sessionId, sessionData] = sessionChild as [string, any];

        // Get sensor data counts
        const sensorDataRef = ref(this.database, `users/${userId}/sessions/${sessionId}/sensorData`);
        const sensorSnapshot = await get(sensorDataRef);

        let accelCount = 0;
        let gyroCount = 0;
        let magCount = 0;

        if (sensorSnapshot.exists()) {
          const sensorData = sensorSnapshot.val();
          accelCount = sensorData.accelerometer ? Object.keys(sensorData.accelerometer).length : 0;
          gyroCount = sensorData.gyroscope ? Object.keys(sensorData.gyroscope).length : 0;
          magCount = sensorData.magnetometer ? Object.keys(sensorData.magnetometer).length : 0;
        }

        sessions.push({
          id: sessionId,
          startTime: sessionData.startTime,
          endTime: sessionData.endTime,
          status: sessionData.status,
          dataPoints: accelCount + gyroCount + magCount,
          accelerometerPoints: accelCount,
          gyroscopePoints: gyroCount,
          magnetometerPoints: magCount,
        });
      }

      // Sort by start time, most recent first
      return sessions.sort((a, b) => b.startTime - a.startTime);
    } catch (error) {
      console.error('Error getting user sessions:', error);
      return [];
    }
  }

  async getSessionDetail(userId: string, sessionId: string): Promise<any> {
    if (!this.database) throw new Error('StorageManager not initialized');

    try {
      const sessionRef = ref(this.database, `users/${userId}/sessions/${sessionId}`);
      const snapshot = await get(sessionRef);

      if (!snapshot.exists()) return null;

      const sessionData = snapshot.val();
      const sensorData = sessionData.sensorData || {};

      // Convert Firebase objects to arrays with timestamps
      const toArray = (data: any) => {
        if (!data) return [];
        return Object.values(data).map((point: any) => ({
          x: point.x || 0,
          y: point.y || 0,
          z: point.z || 0,
          timestamp: point.timestamp || Date.now()
        }));
      };

      // Convert GPS data to array
      const toGPSArray = (data: any) => {
        if (!data) return [];
        return Object.values(data).map((point: any) => ({
          mph: point.mph || 0,
          kph: point.kph || 0,
          mps: point.mps || 0,
          lat: point.lat || 0,
          lng: point.lng || 0,
          timestamp: point.timestamp || Date.now()
        }));
      };

      return {
        sessionId,
        startTime: sessionData.startTime,
        endTime: sessionData.endTime,
        status: sessionData.status,
        accelerometerData: toArray(sensorData.accelerometer),
        gyroscopeData: toArray(sensorData.gyroscope),
        magnetometerData: toArray(sensorData.magnetometer),
        gpsData: toGPSArray(sensorData.gps),
      };
    } catch (error) {
      console.error('Error getting session detail:', error);
      return null;
    }
  }

  async getAllActiveSessions(): Promise<any[]> {
    if (!this.database) throw new Error('StorageManager not initialized');

    try {
      const usersRef = ref(this.database, 'users');
      const snapshot = await get(usersRef);

      if (!snapshot.exists()) return [];

      const activeSessions: any[] = [];

      // Iterate through all users
      snapshot.forEach((userSnapshot) => {
        const userId = userSnapshot.key;
        const userData = userSnapshot.val();
        const userEmail = userData.email || 'Unknown';
        const sessions = userData.sessions || {};

        // Find active recording sessions
        Object.entries(sessions).forEach(([sessionId, sessionData]: [string, any]) => {
          if (sessionData.status === 'recording') {
            const sensorData = sessionData.sensorData || {};
            const accelCount = sensorData.accelerometer ? Object.keys(sensorData.accelerometer).length : 0;
            const gyroCount = sensorData.gyroscope ? Object.keys(sensorData.gyroscope).length : 0;
            const magCount = sensorData.magnetometer ? Object.keys(sensorData.magnetometer).length : 0;

            activeSessions.push({
              userId,
              userEmail,
              sessionId,
              startTime: sessionData.startTime,
              status: sessionData.status,
              dataPoints: accelCount + gyroCount + magCount,
            });
          }
        });
      });

      return activeSessions.sort((a, b) => b.startTime - a.startTime);
    } catch (error) {
      console.error('Error getting active sessions:', error);
      return [];
    }
  }

  listenToActiveSessions(callback: (sessions: any[]) => void): () => void {
    if (!this.database) throw new Error('StorageManager not initialized');

    const usersRef = ref(this.database, 'users');

    const listener = onValue(usersRef, (snapshot) => {
      if (!snapshot.exists()) {
        callback([]);
        return;
      }

      const activeSessions: any[] = [];

      snapshot.forEach((userSnapshot) => {
        const userId = userSnapshot.key;
        const userData = userSnapshot.val();
        const userEmail = userData.email || 'Unknown';
        const sessions = userData.sessions || {};

        Object.entries(sessions).forEach(([sessionId, sessionData]: [string, any]) => {
          if (sessionData.status === 'recording') {
            const sensorData = sessionData.sensorData || {};
            const accelCount = sensorData.accelerometer ? Object.keys(sensorData.accelerometer).length : 0;
            const gyroCount = sensorData.gyroscope ? Object.keys(sensorData.gyroscope).length : 0;
            const magCount = sensorData.magnetometer ? Object.keys(sensorData.magnetometer).length : 0;

            activeSessions.push({
              userId,
              userEmail,
              sessionId,
              startTime: sessionData.startTime,
              status: sessionData.status,
              dataPoints: accelCount + gyroCount + magCount,
            });
          }
        });
      });

      callback(activeSessions.sort((a, b) => b.startTime - a.startTime));
    });

    // Return cleanup function
    return () => off(usersRef);
  }

  listenToSessionDetail(userId: string, sessionId: string, callback: (session: any) => void): () => void {
    if (!this.database) throw new Error('StorageManager not initialized');

    const sessionRef = ref(this.database, `users/${userId}/sessions/${sessionId}`);

    const listener = onValue(sessionRef, (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }

      const sessionData = snapshot.val();
      const sensorData = sessionData.sensorData || {};

      // Convert Firebase objects to arrays with timestamps
      const toArray = (data: any) => {
        if (!data) return [];
        return Object.values(data).map((point: any) => ({
          x: point.x || 0,
          y: point.y || 0,
          z: point.z || 0,
          timestamp: point.timestamp || Date.now()
        }));
      };

      // Convert GPS data to array
      const toGPSArray = (data: any) => {
        if (!data) return [];
        return Object.values(data).map((point: any) => ({
          mph: point.mph || 0,
          kph: point.kph || 0,
          mps: point.mps || 0,
          lat: point.lat || 0,
          lng: point.lng || 0,
          timestamp: point.timestamp || Date.now()
        }));
      };

      callback({
        sessionId,
        startTime: sessionData.startTime,
        endTime: sessionData.endTime,
        status: sessionData.status,
        accelerometerData: toArray(sensorData.accelerometer),
        gyroscopeData: toArray(sensorData.gyroscope),
        magnetometerData: toArray(sensorData.magnetometer),
        gpsData: toGPSArray(sensorData.gps),
      });
    });

    // Return cleanup function
    return () => off(sessionRef);
  }

  async deleteSession(userId: string, sessionId: string): Promise<boolean> {
    if (!this.database) throw new Error('StorageManager not initialized');

    try {
      const sessionRef = ref(this.database, `users/${userId}/sessions/${sessionId}`);
      await remove(sessionRef);
      return true;
    } catch (error) {
      console.error('Error deleting session:', error);
      return false;
    }
  }
}

export default new StorageManager();
