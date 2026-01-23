// lib/processors/SensorProcessor.ts
interface Vector3D {
  x: number;
  y: number;
  z: number;
}

interface ProcessedData extends Vector3D {
  timestamp: number;
  magnitude?: number;
  filtered?: Vector3D;
  transformed?: Vector3D;
}

class SensorProcessor {
  private filtering = false;
  private filterAlpha = { x: 0.1, y: 0.1, z: 0.1 };
  private previousAccel: Vector3D = { x: 0, y: 0, z: 0 };
  private previousGyro: Vector3D = { x: 0, y: 0, z: 0 };

  initialize() {
    console.log('SensorProcessor initialized');
  }

  setFiltering(enabled: boolean) {
    this.filtering = enabled;
  }

  updateConfig(config: any) {
    if (config.processing?.filter) {
      this.filterAlpha = config.processing.filter;
    }
  }

  reset() {
    this.previousAccel = { x: 0, y: 0, z: 0 };
    this.previousGyro = { x: 0, y: 0, z: 0 };
  }

  processAccelerometerData(rawData: Vector3D): ProcessedData {
    const timestamp = Date.now();

    if (!this.filtering) {
      return {
        ...rawData,
        timestamp,
        magnitude: this.calculateMagnitude(rawData)
      };
    }

    // Apply low-pass filter
    const filtered = {
      x: this.applyLowPassFilter(rawData.x, this.previousAccel.x, this.filterAlpha.x),
      y: this.applyLowPassFilter(rawData.y, this.previousAccel.y, this.filterAlpha.y),
      z: this.applyLowPassFilter(rawData.z, this.previousAccel.z, this.filterAlpha.z)
    };

    this.previousAccel = filtered;

    return {
      ...rawData,
      timestamp,
      filtered,
      transformed: filtered,
      magnitude: this.calculateMagnitude(filtered)
    };
  }

  processGyroscopeData(rawData: Vector3D & { timestamp?: number }): ProcessedData {
    const timestamp = rawData.timestamp || Date.now();

    if (!this.filtering) {
      return {
        x: rawData.x,
        y: rawData.y,
        z: rawData.z,
        timestamp,
        magnitude: this.calculateMagnitude(rawData)
      };
    }

    // Apply low-pass filter
    const filtered = {
      x: this.applyLowPassFilter(rawData.x, this.previousGyro.x, this.filterAlpha.x),
      y: this.applyLowPassFilter(rawData.y, this.previousGyro.y, this.filterAlpha.y),
      z: this.applyLowPassFilter(rawData.z, this.previousGyro.z, this.filterAlpha.z)
    };

    this.previousGyro = filtered;

    return {
      x: rawData.x,
      y: rawData.y,
      z: rawData.z,
      timestamp,
      filtered,
      transformed: filtered,
      magnitude: this.calculateMagnitude(filtered)
    };
  }

  private applyLowPassFilter(current: number, previous: number, alpha: number): number {
    return alpha * current + (1 - alpha) * previous;
  }

  private calculateMagnitude(vector: Vector3D): number {
    return Math.sqrt(vector.x ** 2 + vector.y ** 2 + vector.z ** 2);
  }
}

export default new SensorProcessor();
