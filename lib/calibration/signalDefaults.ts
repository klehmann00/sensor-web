// lib/calibration/signalDefaults.ts
// Default signal controls configuration for Master Signal Viewer

import { SignalControls } from './types';

export const STORAGE_VERSION = 10;

export const defaultSignalControls: SignalControls = {
  // Raw accel (faded)
  accelRawX: { visible: true, offset: 25, color: 'rgba(239, 68, 68, 0.3)', width: 1 },
  accelRawY: { visible: true, offset: 29, color: 'rgba(245, 158, 11, 0.3)', width: 1 },
  accelRawZ: { visible: true, offset: 25, color: 'rgba(59, 130, 246, 0.3)', width: 1 },

  // Filtered accel (solid)
  accelFilteredX: { visible: true, offset: 25, color: '#ef4444', width: 2 },
  accelFilteredY: { visible: true, offset: 29, color: '#f59e0b', width: 2 },
  accelFilteredZ: { visible: true, offset: 25, color: '#3b82f6', width: 2 },

  // Gyro raw (faded)
  gyroRawX: { visible: false, offset: 14, color: 'rgba(139, 92, 246, 0.3)', width: 1 },
  gyroRawY: { visible: false, offset: 12, color: 'rgba(236, 72, 153, 0.3)', width: 1 },
  gyroRawZ: { visible: false, offset: 10, color: 'rgba(6, 182, 212, 0.3)', width: 1 },

  // Gyro filtered (solid)
  gyroFilteredX: { visible: false, offset: 14, color: '#8b5cf6', width: 2 },
  gyroFilteredY: { visible: false, offset: 12, color: '#ec4899', width: 2 },
  gyroFilteredZ: { visible: false, offset: 10, color: '#06b6d4', width: 2 },

  // Linear acceleration (gravity removed, filtered)
  accelLinearX_measured: { visible: false, offset: 0, color: '#dc2626', width: 2 },
  accelLinearY_measured: { visible: false, offset: 0, color: '#ea580c', width: 2 },
  accelLinearZ_measured: { visible: false, offset: 0, color: '#2563eb', width: 2 },

  // Magnetometer
  magX: { visible: false, offset: 0, color: '#10b981', width: 1 },
  magY: { visible: false, offset: 0, color: '#14b8a6', width: 1 },
  magZ: { visible: false, offset: 0, color: '#22c55e', width: 1 },

  // Lateral accel trifecta
  accelY_real: { visible: false, offset: 0, color: '#ef4444', width: 3, label: 'accelTransY_measured' },
  accelY_gyro: { visible: false, offset: 0, color: '#f97316', width: 2, label: 'accelTransY_fromGyro' },
  accelY_mag: { visible: false, offset: 0, color: '#84cc16', width: 2, label: 'accelTransY_fromMag' },

  // Rotation rate trifecta
  gyroZ_real: { visible: false, offset: 0, color: '#3b82f6', width: 3, label: 'gyroZ_measured' },
  gyroZ_accel: { visible: false, offset: 0, color: '#06b6d4', width: 2, label: 'gyroZ_fromAccel' },
  gyroZ_mag: { visible: false, offset: 0, color: '#0891b2', width: 2, label: 'gyroZ_fromMag' },

  // Heading trifecta
  heading_real: { visible: false, offset: 0, color: '#8b5cf6', width: 3, label: 'heading_measured' },
  heading_accel: { visible: false, offset: 0, color: '#a855f7', width: 2, label: 'heading_fromAccel' },
  heading_gyro: { visible: false, offset: 0, color: '#c084fc', width: 2, label: 'heading_fromGyro' },

  // Gravity estimation
  gravityX: { visible: true, offset: -12, color: '#86198f', width: 2, label: 'gravity_X' },
  gravityY: { visible: true, offset: -12, color: '#be123c', width: 2, label: 'gravity_Y' },
  gravityZ: { visible: true, offset: -12, color: '#0e7490', width: 2, label: 'gravity_Z' },

  // Forward vector (phone coords)
  forwardX: { visible: true, offset: -7, color: 'rgba(239, 68, 68, 0.5)', width: 2, label: 'forward_X (phone)' },
  forwardY: { visible: true, offset: -7, color: 'rgba(245, 158, 11, 0.5)', width: 2, label: 'forward_Y (phone)' },
  forwardZ: { visible: true, offset: -7, color: 'rgba(59, 130, 246, 0.5)', width: 2, label: 'forward_Z (phone)' },

  // Transformed primes (raw - faded)
  xPrime: { visible: true, offset: -23, color: 'rgba(239, 68, 68, 0.3)', width: 1 },
  yPrime: { visible: true, offset: -25, color: 'rgba(245, 158, 11, 0.3)', width: 1 },
  zPrime: { visible: true, offset: -27, color: 'rgba(59, 130, 246, 0.3)', width: 1 },

  // Transformed primes (filtered - solid)
  xPrimeFiltered: { visible: true, offset: -23, color: '#ef4444', width: 2 },
  yPrimeFiltered: { visible: true, offset: -25, color: '#f59e0b', width: 2 },
  zPrimeFiltered: { visible: true, offset: -27, color: '#3b82f6', width: 2 },

  // DAN (road roughness)
  danX: { visible: true, offset: 25, color: '#10b981', width: 2, label: 'DAN (road roughness)' },
  roadDAN: { visible: true, offset: 25, color: '#f59e0b', width: 3, label: 'RoadDAN (1-sec avg)' },

  // Virtual accelerations
  virtualForward: { visible: false, offset: 0, color: '#10b981', width: 2 },
  virtualLateral: { visible: false, offset: 0, color: '#f59e0b', width: 2 },
  rawGPSAccel: { visible: true, offset: 0, color: '#ef4444', width: 2, label: 'gpsAccelAvg' },
  gpsDeltaTime: { visible: false, offset: 0, color: '#f97316', width: 2, label: 'gpsDeltaTime (sec)' },
  gpsTimestamp: { visible: false, offset: 0, color: '#facc15', width: 2, yAxisID: 'y1', label: 'gpsTimestamp (sec)' },
  forwardLearning: { visible: true, offset: 5, color: '#10b981', width: 3, label: 'Forward Learning (1=ON)' },
  forwardConvergence: { visible: false, offset: 0, color: '#f59e0b', width: 3, label: 'Forward Convergence (→0)' },

  // Stability detection
  phoneStable: { visible: true, offset: 4, color: '#06b6d4', width: 3, label: 'Phone Stable (1=stable)' },
  vehicleStationary: { visible: true, offset: 3, color: '#8b5cf6', width: 3, label: 'Vehicle Stationary (1=no accel)' },
  vehicleMoving: { visible: true, offset: 2, color: '#ec4899', width: 3, label: 'Vehicle Moving (1=has speed)' },
  gravityUpdating: { visible: true, offset: 1, color: '#f43f5e', width: 3, label: 'Gravity Updating (1=ON)' },
  magHeading: { visible: true, offset: 0, color: '#f59e0b', width: 2, label: 'Mag Heading (degrees)' },

  // GPS Speed (right axis)
  gpsSpeedRaw: { visible: false, offset: 0, color: '#a855f7', width: 4, yAxisID: 'y1', label: 'gpsSpeedRaw (1Hz steps)' },
  gpsSpeed: { visible: false, offset: 0, color: '#8b5cf6', width: 2, yAxisID: 'y1', label: 'gpsSpeed (interpolated)' },
  gpsSpeedSmoothed: { visible: true, offset: 0, color: '#22c55e', width: 3, yAxisID: 'y1', label: 'gpsSpeedSmoothed (recursive α=0.5)' },
  gpsSpeedFiltered: { visible: false, offset: 0, color: '#06b6d4', width: 3, yAxisID: 'y1', label: 'gpsSpeedFiltered (EMA)' },

  // Confidence
  confidence: { visible: false, offset: 0, color: '#ec4899', width: 1, yAxisID: 'y1' }
};
