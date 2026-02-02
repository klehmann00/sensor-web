// lib/calibration/helpers.ts
// Helper functions for calibration calculations

import { GPSData } from './types';

/**
 * Apply exponential moving average filter to smooth noisy data.
 * EMA formula: filtered[i] = alpha * data[i] + (1 - alpha) * filtered[i-1]
 *
 * @param data - Array of values to filter
 * @param alpha - Smoothing factor (0-1). Lower = more smoothing.
 * @returns Filtered array (same length as input)
 */
export function exponentialMovingAverage(data: number[], alpha: number): number[] {
  if (data.length === 0) return [];

  const result: number[] = [];
  let smoothed = data[0];

  for (let i = 0; i < data.length; i++) {
    smoothed = alpha * data[i] + (1 - alpha) * smoothed;
    result.push(smoothed);
  }

  return result;
}

/**
 * Interpolate GPS data to match a target length (e.g., 60Hz sensor data)
 */
export function interpolateGPSData(gpsData: GPSData[], targetLength: number): GPSData[] {
  if (gpsData.length === 0) {
    return Array(targetLength).fill({ mph: 0, kph: 0, mps: 0, timestamp: 0 });
  }

  if (gpsData.length === targetLength) {
    return gpsData;
  }

  const interpolated: GPSData[] = [];
  for (let i = 0; i < targetLength; i++) {
    const gpsRatio = (i / targetLength) * gpsData.length;
    const prevIndex = Math.floor(gpsRatio);
    const nextIndex = Math.min(prevIndex + 1, gpsData.length - 1);

    if (prevIndex === nextIndex) {
      interpolated.push(gpsData[prevIndex]);
    } else {
      const ratio = gpsRatio - prevIndex;
      const prevGPS = gpsData[prevIndex];
      const nextGPS = gpsData[nextIndex];
      interpolated.push({
        mph: prevGPS.mph + (nextGPS.mph - prevGPS.mph) * ratio,
        kph: prevGPS.kph + (nextGPS.kph - prevGPS.kph) * ratio,
        mps: prevGPS.mps + (nextGPS.mps - prevGPS.mps) * ratio,
        timestamp: i
      });
    }
  }
  return interpolated;
}

/**
 * Unwrap angles to remove 360° jumps (maintain continuity)
 */
export function unwrapAngles(angles: number[]): number[] {
  if (angles.length === 0) return [];

  const unwrapped: number[] = [angles[0]];
  let offset = 0;

  for (let i = 1; i < angles.length; i++) {
    let diff = angles[i] - angles[i - 1];

    if (diff > 180) {
      offset -= 360;
    } else if (diff < -180) {
      offset += 360;
    }

    unwrapped.push(angles[i] + offset);
  }

  return unwrapped;
}
