// lib/processors/EnhancedSensorProcessor.ts
interface Vector3D {
  x: number;
  y: number;
  z: number;
}

interface DisturbanceMetrics {
  variance: number;
  peakToPeak: number;
  rms: number;
  isDisturbance: boolean;
}

interface EnhancedProcessedData extends Vector3D {
  timestamp: number;
  filtered?: Vector3D;
  magnitude?: number;
  disturbanceMetrics?: {
    accel?: DisturbanceMetrics;
    gyro?: DisturbanceMetrics;
  };
}

class EnhancedSensorProcessor {
  private accelHistory: Vector3D[] = [];
  private gyroHistory: Vector3D[] = [];
  private maxHistorySize = 50;
  private previousAccel: Vector3D = { x: 0, y: 0, z: 0 };
  private previousGyro: Vector3D = { x: 0, y: 0, z: 0 };

  processAccelerometerData(rawData: Vector3D): EnhancedProcessedData {
    const timestamp = Date.now();

    // Add to history
    this.accelHistory.push(rawData);
    if (this.accelHistory.length > this.maxHistorySize) {
      this.accelHistory.shift();
    }

    // Calculate filtered data
    const filtered = {
      x: 0.1 * rawData.x + 0.9 * this.previousAccel.x,
      y: 0.1 * rawData.y + 0.9 * this.previousAccel.y,
      z: 0.1 * rawData.z + 0.9 * this.previousAccel.z
    };

    this.previousAccel = filtered;

    // Calculate disturbance metrics
    const disturbanceMetrics = this.calculateDisturbanceMetrics(this.accelHistory);

    return {
      ...rawData,
      timestamp,
      filtered,
      magnitude: Math.sqrt(rawData.x ** 2 + rawData.y ** 2 + rawData.z ** 2),
      disturbanceMetrics: {
        accel: disturbanceMetrics
      }
    };
  }

  processGyroscopeData(rawData: Vector3D): EnhancedProcessedData {
    const timestamp = Date.now();

    // Add to history
    this.gyroHistory.push(rawData);
    if (this.gyroHistory.length > this.maxHistorySize) {
      this.gyroHistory.shift();
    }

    // Calculate filtered data
    const filtered = {
      x: 0.1 * rawData.x + 0.9 * this.previousGyro.x,
      y: 0.1 * rawData.y + 0.9 * this.previousGyro.y,
      z: 0.1 * rawData.z + 0.9 * this.previousGyro.z
    };

    this.previousGyro = filtered;

    // Calculate disturbance metrics
    const disturbanceMetrics = this.calculateDisturbanceMetrics(this.gyroHistory);

    return {
      ...rawData,
      timestamp,
      filtered,
      magnitude: Math.sqrt(rawData.x ** 2 + rawData.y ** 2 + rawData.z ** 2),
      disturbanceMetrics: {
        gyro: disturbanceMetrics
      }
    };
  }

  private calculateDisturbanceMetrics(history: Vector3D[]): DisturbanceMetrics {
    if (history.length < 2) {
      return {
        variance: 0,
        peakToPeak: 0,
        rms: 0,
        isDisturbance: false
      };
    }

    // Calculate variance
    const magnitudes = history.map(v => Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2));
    const mean = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;
    const variance = magnitudes.reduce((sum, val) => sum + (val - mean) ** 2, 0) / magnitudes.length;

    // Calculate peak-to-peak
    const min = Math.min(...magnitudes);
    const max = Math.max(...magnitudes);
    const peakToPeak = max - min;

    // Calculate RMS
    const rms = Math.sqrt(magnitudes.reduce((sum, val) => sum + val ** 2, 0) / magnitudes.length);

    // Determine if disturbance
    const isDisturbance = variance > 0.1 || peakToPeak > 0.5;

    return {
      variance,
      peakToPeak,
      rms,
      isDisturbance
    };
  }

  reset() {
    this.accelHistory = [];
    this.gyroHistory = [];
    this.previousAccel = { x: 0, y: 0, z: 0 };
    this.previousGyro = { x: 0, y: 0, z: 0 };
  }
}

export default new EnhancedSensorProcessor();
