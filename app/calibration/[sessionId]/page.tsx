// app/calibration/[sessionId]/page.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useAdmin } from '@/contexts/AdminContext';
import StorageManager from '@/lib/managers/StorageManager';
import { database } from '@/lib/firebase';
import AccelerometerChart from '@/components/sensors/AccelerometerChart';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';

// Register Chart.js components and annotation plugin
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  annotationPlugin
);


interface Vector3D {
  x: number;
  y: number;
  z: number;
  timestamp?: number;
}

interface GPSData {
  mph: number;
  kph: number;
  mps: number;
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
  gpsData: GPSData[];
}

/**
 * Apply exponential moving average filter to smooth noisy data.
 * Used for orientation learning to correlate GPS with sensor data.
 * Does NOT affect final transformed data - only used for direction detection.
 *
 * EMA formula: filtered[i] = alpha * data[i] + (1 - alpha) * filtered[i-1]
 *
 * @param data - Array of values to filter
 * @param alpha - Smoothing factor (0-1). Lower = more smoothing.
 *                0.05 = heavy smoothing, 0.5 = moderate, 0.95 = minimal
 * @returns Filtered array (same length as input)
 */
function exponentialMovingAverage(data: number[], alpha: number): number[] {
  if (data.length === 0) return [];

  const result: number[] = [];
  let smoothed = data[0]; // Initialize with first value

  for (let i = 0; i < data.length; i++) {
    smoothed = alpha * data[i] + (1 - alpha) * smoothed;
    result.push(smoothed);
  }

  return result;
}

interface CalibrationResult {
  transformed: Vector3D[];
  gravityHistory: Vector3D[];
  forwardHistory: Vector3D[];
  forwardChangeRate: number[];  // How much forward vector changes per sample
  confidence: number[];
  gpsAccelDetected: boolean[];
  turningDetected: boolean[];
  forwardUpdateCount: number[];
  virtualForwardAccel: number[];
  virtualLateralAccel: number[];
  actualSampleRate: number;
  // Stability detection signals
  phoneStable: boolean[];       // Phone is not moving/rotating
  vehicleStationary: boolean[]; // Vehicle not accelerating (constant speed or stopped)
  vehicleMoving: boolean[];     // Vehicle has speed > 1 m/s
  magHeading: number[];         // Magnetometer heading in degrees
  gpsSpeedRaw: number[];  // Raw 1Hz GPS speed (stepped, not interpolated)
  gpsSpeedSmoothed: number[];  // Recursive smoothed (alpha=0.5 fixed)
  gpsSpeedFiltered: number[];  // EMA filtered (adjustable alpha)
  rawGPSAccel: number[];  // GPS acceleration from smoothed 1Hz data
  gpsDeltaTime: number[];  // Time between GPS samples (for debugging)
  gpsTimestamp: number[];  // Actual GPS timestamps (for debugging timing)
  // Linear acceleration (gravity removed, filtered with observerAlpha)
  accelLinearX_measured: number[];
  accelLinearY_measured: number[];
  accelLinearZ_measured: number[];
  // Cross-verification trifecta
  accelY_measured: number[];
  accelY_fromGyro: number[];
  accelY_fromMag: number[];
  gyroZ_measured: number[];
  gyroZ_fromAccel: number[];
  gyroZ_fromMag: number[];
  heading_measured: number[];
  heading_fromAccel: number[];
  heading_fromGyro: number[];
  // Filtered raw signals (using alpha)
  accelFilteredX: number[];
  accelFilteredY: number[];
  accelFilteredZ: number[];
  gyroFilteredX: number[];
  gyroFilteredY: number[];
  gyroFilteredZ: number[];
}

/**
 * FILTERING STRATEGY (Exponential Moving Average - EMA):
 * - Orientation learning uses EMA-FILTERED data (GPS + sensors) to find correlation
 * - Vehicle transformation uses UNFILTERED data for accuracy
 * - EMA removes high-frequency noise (vibrations) to reveal true acceleration events
 * - Filter strength adjustable via UI (alpha: 0.01-0.95, default 0.05 = heavy smoothing)
 * - EMA formula: filtered[i] = α * data[i] + (1-α) * filtered[i-1]
 */
// Helper function for GPS interpolation
function interpolateGPSData(gpsData: GPSData[], targetLength: number): GPSData[] {
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

function applyFloatingCalibration(
  accelData: Vector3D[],
  gyroData: Vector3D[],
  magData: Vector3D[],
  gpsData: GPSData[],
  alpha: number = 0.95,
  observerAlpha: number = 0.05,
  filterAlpha: number = 0.05,
  gpsSpeedAlpha: number = 0.95
): CalibrationResult {
  const result: CalibrationResult = {
    transformed: [],
    gravityHistory: [],
    forwardHistory: [],
    forwardChangeRate: [],
    confidence: [],
    gpsAccelDetected: [],
    turningDetected: [],
    forwardUpdateCount: [],
    virtualForwardAccel: [],
    virtualLateralAccel: [],
    actualSampleRate: 60,
    phoneStable: [],
    vehicleStationary: [],
    vehicleMoving: [],
    magHeading: [],
    gpsSpeedRaw: [],
    gpsSpeedSmoothed: [],
    gpsSpeedFiltered: [],
    rawGPSAccel: [],
    gpsDeltaTime: [],
    gpsTimestamp: [],
    // Linear acceleration (gravity removed, filtered with observerAlpha)
    accelLinearX_measured: [],
    accelLinearY_measured: [],
    accelLinearZ_measured: [],
    // Cross-verification trifecta
    accelY_measured: [],
    accelY_fromGyro: [],
    accelY_fromMag: [],
    gyroZ_measured: [],
    gyroZ_fromAccel: [],
    gyroZ_fromMag: [],
    heading_measured: [],
    heading_fromAccel: [],
    heading_fromGyro: [],
    // Filtered raw signals (using alpha parameter)
    accelFilteredX: [],
    accelFilteredY: [],
    accelFilteredZ: [],
    gyroFilteredX: [],
    gyroFilteredY: [],
    gyroFilteredZ: []
  };

  // State variables
  let gravity = { x: 0, y: 0, z: 0 };
  let forward = { x: 0, y: 0, z: 0 };
  let prevForward = { x: 0, y: 0, z: 0 };
  let prevHeading = 0;
  let totalForwardUpdates = 0;
  let magHeadingUnwrapped = 0;  // Unwrapped heading (no 360° jumps)

  // Cross-verification trifecta state
  let integratedHeading_accel = 0;
  let integratedHeading_gyro = 0;
  let prevMagHeading = 0;

  // === FILTERED RAW ACCEL (for gravity estimation using alpha) ===
  let accelFilteredX = 0, accelFilteredY = 0, accelFilteredZ = 0;

  // === FILTERED RAW GYRO (for future calculations using filterAlpha) ===
  let gyroFilteredX = 0, gyroFilteredY = 0, gyroFilteredZ = 0;

  // === FILTERED SIGNALS FOR OBSERVERS (noise reduction with observerAlpha) ===
  // Filter LINEAR acceleration (after gravity removal), not raw accel
  let filteredLinearAccelX = 0, filteredLinearAccelY = 0, filteredLinearAccelZ = 0;
  let filteredGyroX = 0, filteredGyroY = 0, filteredGyroZ = 0;
  let filteredMagHeading = 0;

  const SAMPLE_RATE = 60;
  const deltaTime = 1 / SAMPLE_RATE;

  // === RECURSIVE SMOOTHING (gpsSmoothed) ===
  // gpsSmoothed[i] = gpsSmoothed[i-1] + (gpsRaw[i] - gpsSmoothed[i-1]) / 2
  const smoothedRawGPS: GPSData[] = [];
  let recursiveSmoothedMPS = gpsData.length > 0 ? gpsData[0].mps : 0;

  for (let i = 0; i < gpsData.length; i++) {
    if (i === 0) {
      recursiveSmoothedMPS = gpsData[i].mps;
    } else {
      recursiveSmoothedMPS = recursiveSmoothedMPS + (gpsData[i].mps - recursiveSmoothedMPS) / 2;
    }
    smoothedRawGPS.push({
      mph: recursiveSmoothedMPS * 2.237,
      kph: recursiveSmoothedMPS * 3.6,
      mps: recursiveSmoothedMPS,
      timestamp: gpsData[i].timestamp
    });
  }

  // === FILTER RAW GPS DATA (1 Hz) WITH EMA ===
  // Remove GPS measurement jitter while accepting minimal lag (~1-2 samples)
  const filteredRawGPS: GPSData[] = [];
  let smoothedMPS = gpsData.length > 0 ? gpsData[0].mps : 0; // Initialize with first value

  for (let i = 0; i < gpsData.length; i++) {
    // Apply EMA filter at 1 Hz (controlled by Orientation slider)
    // Higher gpsSpeedAlpha = more smoothing but more lag
    smoothedMPS = gpsSpeedAlpha * smoothedMPS + (1 - gpsSpeedAlpha) * gpsData[i].mps;

    filteredRawGPS.push({
      mph: smoothedMPS * 2.237,
      kph: smoothedMPS * 3.6,
      mps: smoothedMPS,
      timestamp: gpsData[i].timestamp
    });
  }

  // Track GPS delta time and timestamps at 1Hz (for debugging GPS timing issues)
  const gpsDeltaTimeArray: number[] = [];
  const gpsTimestampArray: number[] = [];
  for (let i = 0; i < smoothedRawGPS.length; i++) {
    let dt = 0;
    if (i > 0) {
      dt = (smoothedRawGPS[i].timestamp - smoothedRawGPS[i-1].timestamp) / 1000;
    }
    gpsDeltaTimeArray.push(dt);
    gpsTimestampArray.push(smoothedRawGPS[i].timestamp / 1000);  // Convert ms to seconds for readability
  }

  // Create stepped raw GPS signal (repeat each 1Hz value for ~60 samples)
  const steppedRawGPS: number[] = [];
  for (let i = 0; i < accelData.length; i++) {
    const gpsIndex = Math.floor((i / accelData.length) * gpsData.length);
    const clampedIndex = Math.min(gpsIndex, gpsData.length - 1);
    steppedRawGPS.push(gpsData[clampedIndex].mps);
  }

  // Interpolate raw, smoothed (recursive), and filtered (EMA) GPS to 60 Hz
  const interpolatedGPS = interpolateGPSData(gpsData, accelData.length);
  const interpolatedGPSSmoothed = interpolateGPSData(smoothedRawGPS, accelData.length);
  const interpolatedGPSFiltered = interpolateGPSData(filteredRawGPS, accelData.length);

  // Calculate GPS acceleration from 60Hz interpolated smoothed speed (much cleaner!)
  const ACCEL_WINDOW = 30;  // Use ±30 samples at 60Hz (1.0 second total window)
  const interpolatedRawGPSAccel: number[] = [];
  let smoothedAccel = 0;  // Recursive smoothing for acceleration (α=0.5)

  for (let i = 0; i < accelData.length; i++) {
    let accel = 0;

    if (i >= ACCEL_WINDOW && i < accelData.length - ACCEL_WINDOW) {
      // Central difference at 60Hz - fixed dt, already smooth speed
      const dt = (2 * ACCEL_WINDOW) / SAMPLE_RATE;  // 60 samples at 60Hz = 1.0 seconds
      const dv = interpolatedGPSSmoothed[i + ACCEL_WINDOW].mps - interpolatedGPSSmoothed[i - ACCEL_WINDOW].mps;
      accel = dv / dt;
    } else if (i > 0) {
      // Edge samples - simple backward difference
      const dt = 1 / SAMPLE_RATE;  // 0.0167 seconds
      const dv = interpolatedGPSSmoothed[i].mps - interpolatedGPSSmoothed[i - 1].mps;
      accel = dv / dt;
    }

    // Clamp to physically realistic vehicle limits
    // Max acceleration: 0.5G = 4.9 m/s², Max braking: 1.1G = 10.8 m/s²
    accel = Math.max(-10.8, Math.min(4.9, accel));

    // Apply recursive smoothing to acceleration (same as GPS speed smoothing)
    smoothedAccel = smoothedAccel + (accel - smoothedAccel) / 2;

    interpolatedRawGPSAccel.push(smoothedAccel);
  }

  // Step GPS delta time and timestamps to 60 Hz (show actual 1Hz timing, no interpolation)
  const interpolatedGPSDeltaTime: number[] = [];
  const interpolatedGPSTimestamp: number[] = [];
  for (let i = 0; i < accelData.length; i++) {
    const gpsIndex = Math.floor((i / accelData.length) * gpsDeltaTimeArray.length);
    const clampedIndex = Math.min(gpsIndex, gpsDeltaTimeArray.length - 1);
    interpolatedGPSDeltaTime.push(gpsDeltaTimeArray[clampedIndex]);
    interpolatedGPSTimestamp.push(gpsTimestampArray[clampedIndex]);
  }

  // Main processing loop
  for (let i = 0; i < accelData.length; i++) {
    const accel = accelData[i];
    const gyro = gyroData[i] || { x: 0, y: 0, z: 0 };
    const gps = interpolatedGPS[i];

    // Store both smoothed and filtered GPS speeds
    const gpsSmoothed = interpolatedGPSSmoothed[i];
    const gpsFiltered = interpolatedGPSFiltered[i];
    result.gpsSpeedSmoothed.push(gpsSmoothed.mps);
    result.gpsSpeedFiltered.push(gpsFiltered.mps);

    // === STEP 0: FILTER RAW ACCEL (for clean gravity estimation using alpha) ===
    accelFilteredX = alpha * accelFilteredX + (1 - alpha) * accel.x;
    accelFilteredY = alpha * accelFilteredY + (1 - alpha) * accel.y;
    accelFilteredZ = alpha * accelFilteredZ + (1 - alpha) * accel.z;

    // Store filtered accel for export
    result.accelFilteredX.push(accelFilteredX);
    result.accelFilteredY.push(accelFilteredY);
    result.accelFilteredZ.push(accelFilteredZ);

    // === FILTER RAW GYRO (for future calculations using filterAlpha) ===
    gyroFilteredX = filterAlpha * gyroFilteredX + (1 - filterAlpha) * gyro.x;
    gyroFilteredY = filterAlpha * gyroFilteredY + (1 - filterAlpha) * gyro.y;
    gyroFilteredZ = filterAlpha * gyroFilteredZ + (1 - filterAlpha) * gyro.z;

    // Store filtered gyro for export
    result.gyroFilteredX.push(gyroFilteredX);
    result.gyroFilteredY.push(gyroFilteredY);
    result.gyroFilteredZ.push(gyroFilteredZ);

    // === STEP 1: GRAVITY TRACKING (uses accelFiltered data) ===
    gravity.x = alpha * gravity.x + (1 - alpha) * accelFilteredX;
    gravity.y = alpha * gravity.y + (1 - alpha) * accelFilteredY;
    gravity.z = alpha * gravity.z + (1 - alpha) * accelFilteredZ;

    // === STEP 2: REMOVE GRAVITY FIRST (from raw data) ===
    const linearAccel = {
      x: accel.x - gravity.x,
      y: accel.y - gravity.y,
      z: accel.z - gravity.z
    };

    // === STEP 3: FILTER THE LINEAR ACCELERATION (gravity already removed) ===
    // This is the KEY FIX: filter the linear accel, not the raw accel!
    filteredLinearAccelX = observerAlpha * linearAccel.x + (1 - observerAlpha) * filteredLinearAccelX;
    filteredLinearAccelY = observerAlpha * linearAccel.y + (1 - observerAlpha) * filteredLinearAccelY;
    filteredLinearAccelZ = observerAlpha * linearAccel.z + (1 - observerAlpha) * filteredLinearAccelZ;

    const filteredLinearAccel = {
      x: filteredLinearAccelX,
      y: filteredLinearAccelY,
      z: filteredLinearAccelZ
    };

    // === STEP 4: FILTER GYRO (unchanged) ===
    filteredGyroX = observerAlpha * gyro.x + (1 - observerAlpha) * filteredGyroX;
    filteredGyroY = observerAlpha * gyro.y + (1 - observerAlpha) * filteredGyroY;
    filteredGyroZ = observerAlpha * gyro.z + (1 - observerAlpha) * filteredGyroZ;

    // === STEP 2: USE CLEAN GPS ACCELERATION ===
    // Use the pre-calculated clean GPS acceleration instead of recalculating
    // This avoids noise from numerical differentiation on interpolated GPS
    const currentSpeed = gps.mps;
    const virtualForwardAccel = interpolatedRawGPSAccel[i];

    const rotationRate = gyro.z;
    const virtualLateralAccel = currentSpeed * rotationRate;

    result.virtualForwardAccel.push(virtualForwardAccel);
    result.virtualLateralAccel.push(virtualLateralAccel);
    result.gpsSpeedRaw.push(steppedRawGPS[i]);
    result.rawGPSAccel.push(interpolatedRawGPSAccel[i]);
    result.gpsDeltaTime.push(interpolatedGPSDeltaTime[i]);
    result.gpsTimestamp.push(interpolatedGPSTimestamp[i]);

    // === STEP 3: CROSS-VERIFICATION TRIFECTA (using FILTERED signals) ===
    // Each sensor verified by the other two
    // Note: currentSpeed and rotationRate already defined above

    // Calculate magnetometer heading (atan2 of horizontal components) and filter it
    // Assuming mag.x = North, mag.y = East
    const mag = gyroData[i] || { x: 0, y: 0, z: 0 }; // TODO: Use actual magnetometer data
    const rawMagHeading = Math.atan2(mag.y, mag.x); // radians
    filteredMagHeading = observerAlpha * rawMagHeading + (1 - observerAlpha) * filteredMagHeading;

    // Calculate heading change rate from FILTERED magnetometer
    const magHeadingRate = i > 0 ? (filteredMagHeading - prevMagHeading) / deltaTime : 0;
    prevMagHeading = filteredMagHeading;

    // === DIAGNOSTIC LOGGING: VERIFY FILTERED VALUES ===

    // VERIFICATION: Make sure we're using filtered variables (check once at sample 100)
    if (i === 100) {
      console.log('\n🔍 VARIABLE CHECK - Are we using filtered values?');
      console.log('Variables in scope:', {
        hasFilteredLinearAccelY: typeof filteredLinearAccelY !== 'undefined',
        hasFilteredGyroZ: typeof filteredGyroZ !== 'undefined',
        hasFilteredLinearAccel: typeof filteredLinearAccel !== 'undefined',
        hasRawGyroZ: typeof gyro.z !== 'undefined'
      });

      console.log('Values check:', {
        'gyro.z (RAW)': gyro.z.toFixed(4),
        'filteredGyroZ (FILTERED)': filteredGyroZ.toFixed(4),
        'Difference': (gyro.z - filteredGyroZ).toFixed(4),
        'Same?': Math.abs(gyro.z - filteredGyroZ) < 0.0001 ? '❌ NOT FILTERING!' : '✓ Different (filtering working)'
      });

      console.log('Linear accel check (FIXED: now filtering linear, not raw):', {
        'accel.y (RAW with gravity)': accel.y.toFixed(3),
        'gravity.y': gravity.y.toFixed(3),
        'linearAccel.y (RAW - gravity)': linearAccel.y.toFixed(3),
        'filteredLinearAccel.y (FILTERED linear)': filteredLinearAccel.y.toFixed(3),
        'Difference': (linearAccel.y - filteredLinearAccel.y).toFixed(3),
        'Same?': Math.abs(linearAccel.y - filteredLinearAccel.y) < 0.001 ? '❌ NOT FILTERING!' : '✓ Different (filtering working)'
      });
    }

    // Periodic logging to show what's going into observer calculations
    if (i % 500 === 0 || (i >= 2800 && i <= 2900 && i % 50 === 0)) {
      console.log(`\n=== SAMPLE ${i} (${i >= 2800 && i <= 2900 ? 'TURN SECTION' : 'normal'}) ===`);

      // Show what we're working with
      console.log('RAW sensors:', {
        accelX: accel.x.toFixed(3),
        accelY: accel.y.toFixed(3),
        accelZ: accel.z.toFixed(3),
        gyroZ: gyro.z.toFixed(4)
      });

      console.log('After gravity removal:', {
        'gravity.y': gravity.y.toFixed(3),
        'linearAccel.y (RAW - gravity)': linearAccel.y.toFixed(3),
        'filteredLinearAccel.y (FILTERED linear)': filteredLinearAccel.y.toFixed(3),
        'observerAlpha': observerAlpha.toFixed(3)
      });

      console.log('Gyro (filtered):', {
        'gyro.z (RAW)': gyro.z.toFixed(4),
        'filteredGyroZ': filteredGyroZ.toFixed(4),
        'observerAlpha': observerAlpha.toFixed(3)
      });

      console.log('GPS & calculations:', {
        speed_mps: currentSpeed.toFixed(2),
        speed_mph: (currentSpeed * 2.237).toFixed(2)
      });

      console.log('Observer calculations (ABOUT TO COMPUTE):');
      console.log('  accelY_measured = filteredLinearAccel.y =', filteredLinearAccel.y.toFixed(3), '✓ (now filtering linear, not raw!)');
      console.log('  accelY_fromGyro = speed * filteredGyroZ =', currentSpeed.toFixed(2), '*', filteredGyroZ.toFixed(4), '=', (currentSpeed * filteredGyroZ).toFixed(3));
      console.log('  accelY_fromMag = speed * magHeadingRate =', currentSpeed.toFixed(2), '*', magHeadingRate.toFixed(4), '=', (currentSpeed * magHeadingRate).toFixed(3));
      console.log('');
      console.log('  gyroZ_measured = filteredGyroZ =', filteredGyroZ.toFixed(4), '✓');
      console.log('  gyroZ_fromAccel = filteredLinearAccel.y / speed =', filteredLinearAccel.y.toFixed(3), '/', currentSpeed.toFixed(2), '=',
        currentSpeed > 1 ? (filteredLinearAccel.y / currentSpeed).toFixed(4) : '0.0000 (speed too low)');
      console.log('  gyroZ_fromMag = magHeadingRate =', magHeadingRate.toFixed(4), '(from filtered mag heading change)');
    }

    // === LINEAR ACCELERATION (gravity removed, filtered) ===
    result.accelLinearX_measured.push(filteredLinearAccel.x);
    result.accelLinearY_measured.push(filteredLinearAccel.y);
    result.accelLinearZ_measured.push(filteredLinearAccel.z);

    // === LATERAL ACCELERATION TRIFECTA (using FILTERED signals) ===
    // 1. Measured from FILTERED accelerometer (after removing gravity)
    const accelY_measured = filteredLinearAccel.y;

    // 2. Predicted from FILTERED gyroscope (centripetal acceleration: a = v*ω)
    const accelY_fromGyro = currentSpeed * filteredGyroZ;

    // 3. Predicted from FILTERED magnetometer (heading change → rotation rate → centripetal accel)
    const accelY_fromMag = currentSpeed * magHeadingRate;

    result.accelY_measured.push(accelY_measured);
    result.accelY_fromGyro.push(accelY_fromGyro);
    result.accelY_fromMag.push(accelY_fromMag);

    // === ROTATION RATE TRIFECTA (using FILTERED signals) ===
    // 1. Measured from FILTERED gyroscope
    const gyroZ_measured = filteredGyroZ;

    // 2. Predicted from FILTERED accelerometer (ω = a/v, from centripetal acceleration)
    const gyroZ_fromAccel = currentSpeed > 1 ? (filteredLinearAccel.y / currentSpeed) : 0;

    // 3. Predicted from FILTERED magnetometer (heading change rate)
    const gyroZ_fromMag = magHeadingRate;

    result.gyroZ_measured.push(gyroZ_measured);
    result.gyroZ_fromAccel.push(gyroZ_fromAccel);
    result.gyroZ_fromMag.push(gyroZ_fromMag);

    // === HEADING TRIFECTA (integrated from FILTERED rates) ===
    // 1. Measured from FILTERED magnetometer
    const heading_measured = filteredMagHeading;

    // 2. Predicted from accelerometer (integrate FILTERED gyroZ_fromAccel)
    integratedHeading_accel += gyroZ_fromAccel * deltaTime;
    const heading_fromAccel = integratedHeading_accel;

    // 3. Predicted from gyroscope (integrate FILTERED gyroZ)
    integratedHeading_gyro += filteredGyroZ * deltaTime;
    const heading_fromGyro = integratedHeading_gyro;

    result.heading_measured.push(heading_measured * 180 / Math.PI); // Convert to degrees
    result.heading_fromAccel.push(heading_fromAccel * 180 / Math.PI);
    result.heading_fromGyro.push(heading_fromGyro * 180 / Math.PI);

    // === MAGNETOMETER HEADING ===
    // Get magnetometer sample (interpolate if lengths don't match)
    // Note: magSample.x IS the compass heading (0-360°) from webkitCompassHeading (iOS)
    // or event.alpha (other browsers) - no calculation needed!
    const magIndex = Math.min(i, magData.length - 1);
    const magSample = magData[magIndex] || { x: 0, y: 0, z: 0 };

    // magSample.x is already the compass heading in degrees (0-360° from magnetic north)
    const magHeadingDeg = magSample.x;

    // Unwrap heading to remove 360° jumps (maintain continuity)
    // Track cumulative offset to handle multiple wraparounds
    if (i === 0) {
      magHeadingUnwrapped = magHeadingDeg;
      prevHeading = magHeadingDeg;
    } else {
      let diff = magHeadingDeg - prevHeading;
      // Detect wraparound and adjust cumulative offset
      if (diff > 180) {
        diff -= 360;  // Wrapped from 359° to 0°, going clockwise
      } else if (diff < -180) {
        diff += 360;  // Wrapped from 0° to 359°, going counter-clockwise
      }
      magHeadingUnwrapped += diff;
      prevHeading = magHeadingDeg;
    }

    // Store scaled for display (divide by 10: 360° → 36)
    result.magHeading.push(magHeadingUnwrapped / 10);

    // === STABILITY DETECTION ===
    // Check if phone is stable (not moving/rotating significantly)
    const accelMag = Math.sqrt(accel.x**2 + accel.y**2 + accel.z**2);
    const gyroMagnitude = Math.sqrt(gyroFilteredX**2 + gyroFilteredY**2 + gyroFilteredZ**2); // Use filtered gyro
    const phoneStable = Math.abs(accelMag - 9.8) < 1.5 && gyroMagnitude < 0.3; // Low movement

    // Check vehicle state
    const vehicleStationary = Math.abs(virtualForwardAccel) < 0.1; // Not accelerating/braking
    const vehicleMoving = currentSpeed > 1.0; // Has speed > 1 m/s (~2.2 mph)

    result.phoneStable.push(phoneStable);
    result.vehicleStationary.push(vehicleStationary);
    result.vehicleMoving.push(vehicleMoving);

    // === STEP 4: FORWARD DIRECTION LEARNING (Normalized) ===
    // Use GPS-based acceleration for forward learning
    const significantAccel = Math.abs(virtualForwardAccel) > 0.2; // m/s²

    if (significantAccel) {
      // Accumulate the linear acceleration direction
      forward.x = alpha * forward.x + (1 - alpha) * linearAccel.x;
      forward.y = alpha * forward.y + (1 - alpha) * linearAccel.y;
      forward.z = alpha * forward.z + (1 - alpha) * linearAccel.z;

      // Normalize to keep it as a unit direction vector
      const forwardMag = Math.sqrt(forward.x**2 + forward.y**2 + forward.z**2);
      if (forwardMag > 0.01) {
        forward.x /= forwardMag;
        forward.y /= forwardMag;
        forward.z /= forwardMag;
      }

      totalForwardUpdates++;
    }

    // Calculate how much the forward vector changed (convergence metric)
    const forwardChange = Math.sqrt(
      (forward.x - prevForward.x)**2 +
      (forward.y - prevForward.y)**2 +
      (forward.z - prevForward.z)**2
    );
    result.forwardChangeRate.push(forwardChange);
    prevForward = { x: forward.x, y: forward.y, z: forward.z };

    // === STEP 5: ORTHOGONALIZE FUSED FORWARD ===
    const gravityMag = Math.sqrt(gravity.x**2 + gravity.y**2 + gravity.z**2);
    if (gravityMag > 0.1 && totalForwardUpdates > 0) {
      const gravityNorm = {
        x: gravity.x / gravityMag,
        y: gravity.y / gravityMag,
        z: gravity.z / gravityMag
      };
      const dot = forward.x * gravityNorm.x + forward.y * gravityNorm.y + forward.z * gravityNorm.z;
      forward.x -= dot * gravityNorm.x;
      forward.y -= dot * gravityNorm.y;
      forward.z -= dot * gravityNorm.z;
    }

    // === STEP 6: CALCULATE CONFIDENCE ===
    const gravityMagnitude = gravityMag;
    const forwardMagnitude = Math.sqrt(forward.x**2 + forward.y**2 + forward.z**2);

    const gravityConfidence = Math.min(1, gravityMagnitude / 9.8);
    const forwardConfidence = Math.min(1, forwardMagnitude / 0.5);

    const confidence = (gravityConfidence + forwardConfidence) / 2;

    // === STEP 7: TRANSFORM TO VEHICLE COORDINATES ===
    const gravityNorm = Math.sqrt(gravity.x**2 + gravity.y**2 + gravity.z**2);
    const forwardNorm = Math.sqrt(forward.x**2 + forward.y**2 + forward.z**2);

    let down = { x: 0, y: 0, z: 1 };
    let forwardDir = { x: 1, y: 0, z: 0 };

    if (gravityNorm > 0.1) {
      down = {
        x: gravity.x / gravityNorm,
        y: gravity.y / gravityNorm,
        z: gravity.z / gravityNorm
      };
    }

    if (forwardNorm > 0.1) {
      forwardDir = {
        x: forward.x / forwardNorm,
        y: forward.y / forwardNorm,
        z: forward.z / forwardNorm
      };
    }

    // Calculate lateral (cross product: forward × down)
    const lateral = {
      x: forwardDir.y * down.z - forwardDir.z * down.y,
      y: forwardDir.z * down.x - forwardDir.x * down.z,
      z: forwardDir.x * down.y - forwardDir.y * down.x
    };

    // Transform to vehicle coordinates
    const transformed = {
      x: linearAccel.x * forwardDir.x + linearAccel.y * forwardDir.y + linearAccel.z * forwardDir.z,
      y: linearAccel.x * lateral.x + linearAccel.y * lateral.y + linearAccel.z * lateral.z,
      z: linearAccel.x * down.x + linearAccel.y * down.y + linearAccel.z * down.z,
      timestamp: accel.timestamp
    };

    // Store results
    result.transformed.push(transformed);
    result.gravityHistory.push({ ...gravity, timestamp: accel.timestamp });
    result.forwardHistory.push({ ...forward, timestamp: accel.timestamp });
    result.confidence.push(confidence);
    result.gpsAccelDetected.push(significantAccel);
    result.turningDetected.push(Math.abs(rotationRate) > 0.1); // Turning if rotation > 0.1 rad/s
    result.forwardUpdateCount.push(totalForwardUpdates);
  }

  // Calculate actual sample rate
  if (accelData.length > 1 && accelData[0].timestamp && accelData[accelData.length - 1].timestamp) {
    const totalTimeMs = accelData[accelData.length - 1].timestamp! - accelData[0].timestamp!;
    const totalTimeSeconds = totalTimeMs / 1000;
    if (totalTimeSeconds > 0) {
      result.actualSampleRate = (accelData.length - 1) / totalTimeSeconds;
    }
  }

  // Clean diagnostic output (minimal)
  console.log('=== CALIBRATION SUMMARY ===');
  console.log('Samples:', accelData.length);
  console.log('Forward updates:', totalForwardUpdates);
  console.log('Gravity:', Math.sqrt(gravity.x**2 + gravity.y**2 + gravity.z**2).toFixed(2), 'm/s²');
  console.log('Forward:', Math.sqrt(forward.x**2 + forward.y**2 + forward.z**2).toFixed(3), 'm/s²');

  console.log('\n=== DATA LENGTH VERIFICATION ===');
  console.log('Input accelData length:', accelData.length);
  console.log('Output transformed length:', result.transformed.length);
  console.log('Output gravityHistory length:', result.gravityHistory.length);
  console.log('Output forwardHistory length:', result.forwardHistory.length);

  if (result.transformed.length !== accelData.length) {
    console.error('❌ LENGTH MISMATCH!', {
      input: accelData.length,
      output: result.transformed.length,
      ratio: result.transformed.length / accelData.length
    });
  }

  // === OBSERVER DATA CHECK ===
  console.log('=== OBSERVER DATA CHECK ===');
  console.log('Observer arrays created:', {
    accelY_measured: result.accelY_measured?.length || 0,
    accelY_fromGyro: result.accelY_fromGyro?.length || 0,
    accelY_fromMag: result.accelY_fromMag?.length || 0,
    gyroZ_measured: result.gyroZ_measured?.length || 0,
    gyroZ_fromAccel: result.gyroZ_fromAccel?.length || 0,
    gyroZ_fromMag: result.gyroZ_fromMag?.length || 0,
    heading_measured: result.heading_measured?.length || 0,
    heading_fromAccel: result.heading_fromAccel?.length || 0,
    heading_fromGyro: result.heading_fromGyro?.length || 0
  });

  // Sample values from turn section
  if (result.accelY_measured && result.accelY_measured.length > 2800) {
    console.log('Turn section (2800-2810) values:');
    console.log('  accelY_real:', result.accelY_measured.slice(2800, 2810).map(v => v.toFixed(2)));
    console.log('  accelY_gyro:', result.accelY_fromGyro.slice(2800, 2810).map(v => v.toFixed(2)));
    console.log('  accelY_mag:', result.accelY_fromMag.slice(2800, 2810).map(v => v.toFixed(2)));
  }

  return result;
}

export default function CalibrationAnalysisPage() {
  const router = useRouter();
  const params = useParams();
  const sessionId = params.sessionId as string;
  const { user, loading } = useAuth();
  const { isAdmin } = useAdmin();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alpha, setAlpha] = useState(0.95);
  const [orientationFilterAlpha, setOrientationFilterAlpha] = useState(0.01); // Maximum smoothing for orientation
  const [viewMode, setViewMode] = useState<'all' | 'scrollable'>('all');
  const [scrollPosition, setScrollPosition] = useState(0);
  const [windowSize, setWindowSize] = useState(200);
  const [collapsedCharts, setCollapsedCharts] = useState({
    stateTimeline: false,
    virtualVsReal: false,
    gravityForward: false
  });

  // Master Signal Viewer state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(0);
  const [filterAlpha, setFilterAlpha] = useState(0.05); // EMA filter strength
  const [observerAlpha, setObserverAlpha] = useState(0.05); // Observer filter strength (heavy smoothing)
  const [signalControls, setSignalControls] = useState<Record<string, { visible: boolean; offset: number; color: string; width?: number; yAxisID?: string; label?: string }>>({
    // Raw signals (faded)
    accelRawX: { visible: false, offset: 0, color: 'rgba(239, 68, 68, 0.3)', width: 1 },
    accelRawY: { visible: false, offset: 0, color: 'rgba(245, 158, 11, 0.3)', width: 1 },
    accelRawZ: { visible: false, offset: 0, color: 'rgba(59, 130, 246, 0.3)', width: 1 },

    // Filtered accel (solid)
    accelFilteredX: { visible: false, offset: 0, color: '#ef4444', width: 2 },
    accelFilteredY: { visible: false, offset: 0, color: '#f59e0b', width: 2 },
    accelFilteredZ: { visible: false, offset: 0, color: '#3b82f6', width: 2 },

    // Gyro raw (faded)
    gyroRawX: { visible: false, offset: 0, color: 'rgba(139, 92, 246, 0.3)', width: 1 },
    gyroRawY: { visible: false, offset: 0, color: 'rgba(236, 72, 153, 0.3)', width: 1 },
    gyroRawZ: { visible: false, offset: 0, color: 'rgba(6, 182, 212, 0.3)', width: 1 },

    // Gyro filtered (solid)
    gyroFilteredX: { visible: false, offset: 0, color: '#8b5cf6', width: 2 },
    gyroFilteredY: { visible: false, offset: 0, color: '#ec4899', width: 2 },
    gyroFilteredZ: { visible: false, offset: 0, color: '#06b6d4', width: 2 },

    // Linear acceleration (gravity removed, filtered)
    accelLinearX_measured: { visible: false, offset: 0, color: '#dc2626', width: 2 },
    accelLinearY_measured: { visible: false, offset: 0, color: '#ea580c', width: 2 },
    accelLinearZ_measured: { visible: false, offset: 0, color: '#2563eb', width: 2 },

    // Magnetometer
    magX: { visible: false, offset: 0, color: '#10b981', width: 1 },
    magY: { visible: false, offset: 0, color: '#14b8a6', width: 1 },
    magZ: { visible: false, offset: 0, color: '#22c55e', width: 1 },

    // === LATERAL ACCEL TRIFECTA (transformed to vehicle frame) ===
    accelY_real: { visible: true, offset: 0, color: '#ef4444', width: 3, label: 'accelTransY_measured' },
    accelY_gyro: { visible: true, offset: 0, color: '#f97316', width: 2, label: 'accelTransY_fromGyro' },
    accelY_mag: { visible: true, offset: 0, color: '#84cc16', width: 2, label: 'accelTransY_fromMag' },

    // === ROTATION RATE TRIFECTA ===
    gyroZ_real: { visible: false, offset: 0, color: '#3b82f6', width: 3, label: 'gyroZ_measured' },
    gyroZ_accel: { visible: false, offset: 0, color: '#06b6d4', width: 2, label: 'gyroZ_fromAccel' },
    gyroZ_mag: { visible: false, offset: 0, color: '#0891b2', width: 2, label: 'gyroZ_fromMag' },

    // === HEADING TRIFECTA ===
    heading_real: { visible: false, offset: 0, color: '#8b5cf6', width: 3, label: 'heading_measured' },
    heading_accel: { visible: false, offset: 0, color: '#a855f7', width: 2, label: 'heading_fromAccel' },
    heading_gyro: { visible: false, offset: 0, color: '#c084fc', width: 2, label: 'heading_fromGyro' },

    // Gravity estimation (should be ~9.8 m/s² pointing down)
    gravityX: { visible: true, offset: 0, color: '#86198f', width: 2, label: 'gravity_X' },
    gravityY: { visible: true, offset: 0, color: '#be123c', width: 2, label: 'gravity_Y' },
    gravityZ: { visible: true, offset: 0, color: '#0e7490', width: 2, label: 'gravity_Z' },

    // Forward vector (learned direction in phone coordinates)
    forwardX: { visible: true, offset: 0, color: '#a855f7', width: 2, label: 'forward_X (phone)' },
    forwardY: { visible: true, offset: 0, color: '#ec4899', width: 2, label: 'forward_Y (phone)' },
    forwardZ: { visible: true, offset: 0, color: '#06b6d4', width: 2, label: 'forward_Z (phone)' },

    // Transformed (primes) - MAIN SIGNALS (OUTPUT)
    xPrime: { visible: true, offset: 0, color: '#dc2626', width: 3 },
    yPrime: { visible: false, offset: 0, color: '#2563eb', width: 3 },
    zPrime: { visible: false, offset: 0, color: '#16a34a', width: 3 },

    // Virtual accelerations
    virtualForward: { visible: false, offset: 0, color: '#10b981', width: 2 },
    virtualLateral: { visible: false, offset: 0, color: '#f59e0b', width: 2 },
    rawGPSAccel: { visible: true, offset: 0, color: '#ef4444', width: 2, label: 'gpsAccelAvg' },
    gpsDeltaTime: { visible: true, offset: 0, color: '#f97316', width: 2, label: 'gpsDeltaTime (sec)' },
    gpsTimestamp: { visible: false, offset: 0, color: '#facc15', width: 2, yAxisID: 'y1', label: 'gpsTimestamp (sec)' },
    forwardLearning: { visible: true, offset: 0, color: '#10b981', width: 3, label: 'Forward Learning (1=ON)' },
    forwardConvergence: { visible: true, offset: 0, color: '#f59e0b', width: 3, label: 'Forward Convergence (→0)' },

    // Stability detection
    phoneStable: { visible: true, offset: 0, color: '#06b6d4', width: 3, label: 'Phone Stable (1=stable)' },
    vehicleStationary: { visible: true, offset: 0, color: '#8b5cf6', width: 3, label: 'Vehicle Stationary (1=no accel)' },
    vehicleMoving: { visible: true, offset: 0, color: '#ec4899', width: 3, label: 'Vehicle Moving (1=has speed)' },
    magHeading: { visible: true, offset: 0, color: '#f59e0b', width: 2, label: 'Mag Heading (degrees)' },

    // GPS Speed (right axis)
    gpsSpeedRaw: { visible: true, offset: 0, color: '#a855f7', width: 4, yAxisID: 'y1', label: 'gpsSpeedRaw (1Hz steps)' },
    gpsSpeed: { visible: false, offset: 0, color: '#8b5cf6', width: 2, yAxisID: 'y1', label: 'gpsSpeed (interpolated)' },
    gpsSpeedSmoothed: { visible: true, offset: 0, color: '#22c55e', width: 3, yAxisID: 'y1', label: 'gpsSpeedSmoothed (recursive α=0.5)' },
    gpsSpeedFiltered: { visible: false, offset: 0, color: '#06b6d4', width: 3, yAxisID: 'y1', label: 'gpsSpeedFiltered (EMA)' },

    // Confidence
    confidence: { visible: false, offset: 0, color: '#ec4899', width: 1, yAxisID: 'y1' }
  });

  // Track initial mount to avoid saving controls before loading from localStorage
  const [isInitialMount, setIsInitialMount] = useState(true);

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

  // Load signal controls from localStorage on mount (with version checking)
  useEffect(() => {
    console.log('🚀 LOAD EFFECT RUNNING - This should appear on mount!');
    const STORAGE_VERSION = 4; // GPS signal cleanup: added gpsSpeedSmoothed, renamed rawGPSAccel→gpsAccelAvg, hid gpsSpeed/virtualForward/gpsSpeedFiltered
    const savedControls = localStorage.getItem('masterSignalViewerControls');
    const savedVersion = localStorage.getItem('masterSignalViewerVersion');

    console.log('🔍 Version check - Expected:', STORAGE_VERSION, 'Saved:', savedVersion, 'Parsed:', parseInt(savedVersion || '0'));
    console.log('🔍 savedControls exists:', !!savedControls);

    if (savedControls && parseInt(savedVersion || '0') === STORAGE_VERSION) {
      try {
        const parsed = JSON.parse(savedControls);
        console.log('📂 Loading saved controls from localStorage, version matches:', STORAGE_VERSION);
        console.log('📂 Sample saved data - accelFilteredX:', parsed.accelFilteredX);
        setSignalControls(prev => ({
          ...prev,
          ...parsed // Merge saved with defaults
        }));
      } catch (e) {
        console.error('Failed to load saved signal controls:', e);
        localStorage.removeItem('masterSignalViewerControls'); // Clear corrupted data
      }
    } else {
      // Version mismatch or no version - clear old data and use defaults
      localStorage.removeItem('masterSignalViewerControls');
      localStorage.setItem('masterSignalViewerVersion', STORAGE_VERSION.toString());
    }
  }, []);
  // Save signal controls to localStorage when they change (skip initial mount)
  useEffect(() => {
    if (isInitialMount) {
      console.log('⏭️  Skipping save on initial mount');
      setIsInitialMount(false);
      return;
    }
    console.log('💾 Saving signal controls to localStorage...', Object.keys(signalControls).length, 'signals');
    localStorage.setItem('masterSignalViewerControls', JSON.stringify(signalControls));
  }, [signalControls, isInitialMount]);

  // Load filter settings from localStorage on mount
  useEffect(() => {
    const savedFilterAlpha = localStorage.getItem('masterSignalViewerFilterAlpha');
    const savedWindowSize = localStorage.getItem('masterSignalViewerWindowSize');
    const savedAlpha = localStorage.getItem('masterSignalViewerAlpha');
    const savedObserverAlpha = localStorage.getItem('masterSignalViewerObserverAlpha');
    const savedOrientationAlpha = localStorage.getItem('masterSignalViewerOrientationAlpha');

    if (savedFilterAlpha) {
      try {
        setFilterAlpha(parseFloat(savedFilterAlpha));
      } catch (e) {
        console.error('Failed to load saved filter alpha:', e);
      }
    }

    if (savedWindowSize) {
      try {
        setWindowSize(parseInt(savedWindowSize));
      } catch (e) {
        console.error('Failed to load saved window size:', e);
      }
    }

    if (savedAlpha) {
      try {
        setAlpha(parseFloat(savedAlpha));
      } catch (e) {
        console.error('Failed to load saved alpha:', e);
      }
    }

    if (savedObserverAlpha) {
      try {
        setObserverAlpha(parseFloat(savedObserverAlpha));
      } catch (e) {
        console.error('Failed to load saved observer alpha:', e);
      }
    }

    if (savedOrientationAlpha) {
      try {
        setOrientationFilterAlpha(parseFloat(savedOrientationAlpha));
      } catch (e) {
        console.error('Failed to load saved orientation alpha:', e);
      }
    }
  }, []);

  // Save filter settings to localStorage when they change (skip initial mount)
  useEffect(() => {
    if (isInitialMount) return;
    localStorage.setItem('masterSignalViewerFilterAlpha', filterAlpha.toString());
  }, [filterAlpha, isInitialMount]);

  useEffect(() => {
    if (isInitialMount) return;
    localStorage.setItem('masterSignalViewerWindowSize', windowSize.toString());
  }, [windowSize, isInitialMount]);

  useEffect(() => {
    if (isInitialMount) return;
    localStorage.setItem('masterSignalViewerAlpha', alpha.toString());
  }, [alpha, isInitialMount]);

  useEffect(() => {
    if (isInitialMount) return;
    localStorage.setItem('masterSignalViewerObserverAlpha', observerAlpha.toString());
  }, [observerAlpha, isInitialMount]);

  useEffect(() => {
    if (isInitialMount) return;
    localStorage.setItem('masterSignalViewerOrientationAlpha', orientationFilterAlpha.toString());
  }, [orientationFilterAlpha, isInitialMount]);

  // Fetch session detail
  useEffect(() => {
    const fetchSessionDetail = async () => {
      if (!user || !sessionId) return;

      setIsLoading(true);
      setError(null);
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

    if (user && sessionId) {
      fetchSessionDetail();
    }
  }, [user, sessionId]);

  // GPS data verification and debugging
  useEffect(() => {
    if (session) {
      console.log('Session data:', {
        hasGPS: !!session.gpsData,
        gpsPoints: session.gpsData?.length || 0,
        accelPoints: session.accelerometerData?.length || 0,
        gyroPoints: session.gyroscopeData?.length || 0,
        sampleGPS: session.gpsData?.[0],
        gpsWithSpeed: session.gpsData?.filter(g => g.mph > 0).length || 0
      });
    }
  }, [session]);

  // Apply floating calibration with current parameters
  const calibrationResult = useMemo(() => {
    if (!session) return null;
    return applyFloatingCalibration(
      session.accelerometerData,
      session.gyroscopeData,
      session.magnetometerData || [],
      session.gpsData || [],
      alpha,
      observerAlpha,
      filterAlpha,
      orientationFilterAlpha
    );
  }, [session, alpha, observerAlpha, filterAlpha, orientationFilterAlpha]);

  // Data slicing logic
  const getSlicedData = (data: Vector3D[]) => {
    if (viewMode === 'all' || data.length <= windowSize) {
      return data;
    }
    return data.slice(scrollPosition, scrollPosition + windowSize);
  };

  const totalDataPoints = session ? session.accelerometerData.length : 0;
  const maxScrollPosition = Math.max(0, totalDataPoints - windowSize);

  const handlePrev = () => {
    setScrollPosition(Math.max(0, scrollPosition - windowSize));
  };

  const handleNext = () => {
    setScrollPosition(Math.min(maxScrollPosition, scrollPosition + windowSize));
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

  const handleDelete = async () => {
    if (!user || !sessionId) return;

    const confirmed = window.confirm(
      `Delete session ${sessionId}? This cannot be undone.`
    );

    if (!confirmed) return;

    try {
      const success = await StorageManager.deleteSession(user.uid, sessionId);
      if (success) {
        router.push('/sessions');
      } else {
        alert('Failed to delete session');
      }
    } catch (error) {
      console.error('Error deleting session:', error);
      alert('Error deleting session');
    }
  };

  // Create confidence chart data with speed
  const confidenceChartData = useMemo(() => {
    if (!calibrationResult || !session) return null;

    // Convert confidence to Vector3D format and apply slicing
    const confidenceAsVectors = calibrationResult.confidence.map((c, i) => ({
      x: 0,
      y: c * 100, // Convert to percentage
      z: 0,
      timestamp: i
    }));
    const slicedConfidence = getSlicedData(confidenceAsVectors);

    // INTERPOLATE GPS speed to match confidence length
    let slicedSpeed: Vector3D[] = [];
    if (!session.gpsData || session.gpsData.length === 0) {
      console.warn('No GPS data available for this session');
      // Fill with zeros to match confidence length
      slicedSpeed = getSlicedData(confidenceAsVectors.map((c, i) => ({
        x: 0, y: 0, z: 0, timestamp: i
      })));
    } else {
      // Create speed array matching confidence length via interpolation
      const targetLength = calibrationResult.confidence.length;
      const gpsData = session.gpsData;
      const speedVectors: Vector3D[] = [];

      for (let i = 0; i < targetLength; i++) {
        const gpsRatio = (i / targetLength) * gpsData.length;
        const prevIndex = Math.floor(gpsRatio);
        const nextIndex = Math.min(prevIndex + 1, gpsData.length - 1);

        let speed = 0;
        if (prevIndex === nextIndex) {
          speed = gpsData[prevIndex]?.mph || 0;
        } else {
          const ratio = gpsRatio - prevIndex;
          const prevSpeed = gpsData[prevIndex]?.mph || 0;
          const nextSpeed = gpsData[nextIndex]?.mph || 0;
          speed = prevSpeed + (nextSpeed - prevSpeed) * ratio;
        }

        speedVectors.push({ x: 0, y: speed, z: 0, timestamp: i });
      }

      slicedSpeed = getSlicedData(speedVectors);
    }

    // Debug logging
    console.log('Confidence chart data:', {
      confidenceLength: slicedConfidence.length,
      speedLength: slicedSpeed.length,
      originalGPSLength: session.gpsData?.length || 0,
      scrollPosition: scrollPosition,
      viewMode: viewMode
    });

    // Use actual datapoint indices for labels
    const startIndex = viewMode === 'scrollable' ? scrollPosition : 0;
    const indices = slicedConfidence.map((_, index) => (startIndex + index).toString());

    return {
      labels: indices,
      datasets: [
        {
          label: 'Calibration Confidence (%)',
          data: slicedConfidence.map(p => p.y),
          borderColor: '#10b981',  // Green
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          yAxisID: 'y'  // Left axis (0-100%)
        },
        {
          label: 'Vehicle Speed (mph)',
          data: slicedSpeed.map(p => p.y),
          borderColor: '#8b5cf6',  // Purple
          backgroundColor: 'transparent',
          borderWidth: 3,  // Thicker line for better visibility
          pointRadius: 0,
          fill: false,
          yAxisID: 'y1'  // Right axis (0-80 mph)
        }
      ]
    };
  }, [calibrationResult, session, viewMode, scrollPosition, windowSize]);

  // Create gravity & forward vectors chart data
  const gravityForwardChartData = useMemo(() => {
    if (!calibrationResult) return null;

    const slicedGravity = getSlicedData(calibrationResult.gravityHistory);
    const slicedForward = getSlicedData(calibrationResult.forwardHistory);

    // Use actual datapoint indices for labels
    const startIndex = viewMode === 'scrollable' ? scrollPosition : 0;
    const indices = slicedGravity.map((_, index) => (startIndex + index).toString());

    return {
      labels: indices,
      datasets: [
        // Gravity vectors
        {
          label: 'Gravity X',
          data: slicedGravity.map(p => p.x),
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
        },
        {
          label: 'Gravity Y',
          data: slicedGravity.map(p => p.y),
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
        },
        {
          label: 'Gravity Z',
          data: slicedGravity.map(p => p.z),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
        },
        // Forward vectors
        {
          label: 'Forward X',
          data: slicedForward.map(p => p.x),
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139, 92, 246, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          borderDash: [3, 3],
        },
        {
          label: 'Forward Y',
          data: slicedForward.map(p => p.y),
          borderColor: '#ec4899',
          backgroundColor: 'rgba(236, 72, 153, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          borderDash: [3, 3],
        },
        {
          label: 'Forward Z',
          data: slicedForward.map(p => p.z),
          borderColor: '#06b6d4',
          backgroundColor: 'rgba(6, 182, 212, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          borderDash: [3, 3],
        }
      ]
    };
  }, [calibrationResult, viewMode, scrollPosition, windowSize]);

  // Create gravity magnitude convergence chart data
  const gravityMagnitudeData = useMemo(() => {
    if (!calibrationResult) return null;

    // Calculate magnitude at each sample
    const magnitudes = calibrationResult.gravityHistory.map((g, i) => ({
      x: 0,
      y: Math.sqrt(g.x**2 + g.y**2 + g.z**2),
      z: 0,
      timestamp: i
    }));

    const slicedMagnitudes = getSlicedData(magnitudes);
    const startIndex = viewMode === 'scrollable' ? scrollPosition : 0;
    const indices = slicedMagnitudes.map((_, index) => (startIndex + index).toString());

    return {
      labels: indices,
      datasets: [
        {
          label: 'Gravity Magnitude (m/s²)',
          data: slicedMagnitudes.map(p => p.y),
          borderColor: '#10b981',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          fill: false
        },
        {
          label: 'Target (9.8 m/s²)',
          data: slicedMagnitudes.map(() => 9.8),
          borderColor: '#ef4444',
          borderDash: [5, 5],
          backgroundColor: 'transparent',
          borderWidth: 1,
          pointRadius: 0,
          fill: false
        }
      ]
    };
  }, [calibrationResult, viewMode, scrollPosition, windowSize]);

  // Create combined acceleration analysis chart data
  const accelerationAnalysisData = useMemo(() => {
    if (!calibrationResult || !session) return null;

    // 1. GPS virtual forward acceleration (ground truth)
    const slicedGPSAccel = getSlicedData(calibrationResult.virtualForwardAccel.map((v, i) => ({
      x: 0, y: v, z: 0, timestamp: i
    })));
    console.log('Acceleration Analysis - GPS data points:', slicedGPSAccel.length);

    // 2. Raw accelerometer X, Y, Z (includes gravity)
    const slicedRawX = getSlicedData(session.accelerometerData.map((a, i) => ({
      x: 0, y: a.x, z: 0, timestamp: i
    })));
    console.log('Acceleration Analysis - Accel data points:', slicedRawX.length);
    const slicedRawY = getSlicedData(session.accelerometerData.map((a, i) => ({
      x: 0, y: a.y, z: 0, timestamp: i
    })));
    const slicedRawZ = getSlicedData(session.accelerometerData.map((a, i) => ({
      x: 0, y: a.z, z: 0, timestamp: i
    })));

    // 3. Linear acceleration X, Y, Z (gravity removed)
    const linearAccels = session.accelerometerData.map((accel, i) => {
      const grav = calibrationResult.gravityHistory[i] || {x: 0, y: 0, z: 0};
      return {
        x: accel.x - grav.x,
        y: accel.y - grav.y,
        z: accel.z - grav.z,
        timestamp: i
      };
    });

    const slicedLinearX = getSlicedData(linearAccels.map((a, i) => ({
      x: 0, y: a.x, z: 0, timestamp: i
    })));
    const slicedLinearY = getSlicedData(linearAccels.map((a, i) => ({
      x: 0, y: a.y, z: 0, timestamp: i
    })));
    const slicedLinearZ = getSlicedData(linearAccels.map((a, i) => ({
      x: 0, y: a.z, z: 0, timestamp: i
    })));

    // 4. Linear acceleration magnitude
    const linearMags = linearAccels.map((a, i) => ({
      x: 0,
      y: Math.sqrt(a.x**2 + a.y**2 + a.z**2),
      z: 0,
      timestamp: i
    }));
    const slicedLinearMag = getSlicedData(linearMags);

    // === ADD EMA FILTERING ===

    // Filter GPS virtual acceleration
    const gpsAccelArray = calibrationResult.virtualForwardAccel;
    const filteredGPSAccel = exponentialMovingAverage(gpsAccelArray, orientationFilterAlpha);

    // Filter sensor linear magnitude
    const sensorMagArray = linearMags.map(m => m.y);
    const filteredSensorMag = exponentialMovingAverage(sensorMagArray, orientationFilterAlpha);

    // Filter individual linear components
    const linearXArray = linearAccels.map(a => a.x);
    const linearYArray = linearAccels.map(a => a.y);
    const linearZArray = linearAccels.map(a => a.z);

    const filteredLinearX = exponentialMovingAverage(linearXArray, orientationFilterAlpha);
    const filteredLinearY = exponentialMovingAverage(linearYArray, orientationFilterAlpha);
    const filteredLinearZ = exponentialMovingAverage(linearZArray, orientationFilterAlpha);

    // Slice filtered data
    const slicedFilteredGPS = getSlicedData(filteredGPSAccel.map((v, i) => ({
      x: 0, y: v, z: 0, timestamp: i
    })));

    const slicedFilteredSensorMag = getSlicedData(filteredSensorMag.map((v, i) => ({
      x: 0, y: v, z: 0, timestamp: i
    })));

    const slicedFilteredLinearX = getSlicedData(filteredLinearX.map((v, i) => ({
      x: 0, y: v, z: 0, timestamp: i
    })));
    const slicedFilteredLinearY = getSlicedData(filteredLinearY.map((v, i) => ({
      x: 0, y: v, z: 0, timestamp: i
    })));
    const slicedFilteredLinearZ = getSlicedData(filteredLinearZ.map((v, i) => ({
      x: 0, y: v, z: 0, timestamp: i
    })));

    // === ADD TRANSFORMED VEHICLE COORDINATES ===

    // Get the transformed data (already calculated in calibration)
    const transformedData = calibrationResult.transformed;

    // Separate into X', Y', Z' components
    const transformedXArray = transformedData.map(t => t.x);
    const transformedYArray = transformedData.map(t => t.y);
    const transformedZArray = transformedData.map(t => t.z);

    // Apply EMA filtering to transformed data
    const filteredTransformedX = exponentialMovingAverage(transformedXArray, orientationFilterAlpha);
    const filteredTransformedY = exponentialMovingAverage(transformedYArray, orientationFilterAlpha);
    const filteredTransformedZ = exponentialMovingAverage(transformedZArray, orientationFilterAlpha);

    // Slice transformed data
    const slicedTransformedX = getSlicedData(filteredTransformedX.map((v, i) => ({
      x: 0, y: v, z: 0, timestamp: i
    })));
    const slicedTransformedY = getSlicedData(filteredTransformedY.map((v, i) => ({
      x: 0, y: v, z: 0, timestamp: i
    })));
    const slicedTransformedZ = getSlicedData(filteredTransformedZ.map((v, i) => ({
      x: 0, y: v, z: 0, timestamp: i
    })));

    // Also get raw (unfiltered) transformed for comparison
    const slicedRawTransformedX = getSlicedData(transformedXArray.map((v, i) => ({
      x: 0, y: v, z: 0, timestamp: i
    })));
    const slicedRawTransformedY = getSlicedData(transformedYArray.map((v, i) => ({
      x: 0, y: v, z: 0, timestamp: i
    })));
    const slicedRawTransformedZ = getSlicedData(transformedZArray.map((v, i) => ({
      x: 0, y: v, z: 0, timestamp: i
    })));

    const startIndex = viewMode === 'scrollable' ? scrollPosition : 0;
    const indices = slicedGPSAccel.map((_, index) => (startIndex + index).toString());

    return {
      labels: indices,
      datasets: [
        // === GPS GROUND TRUTH ===
        {
          label: '🟢 GPS Accel [FILTERED]',
          data: slicedFilteredGPS.map(p => p.y),
          borderColor: '#059669',
          backgroundColor: 'transparent',
          borderWidth: 4,
          pointRadius: 0
        },

        // === TRANSFORMED VEHICLE COORDINATES (FILTERED - THICK) ===
        {
          label: "x' Forward/Back [FILTERED]",
          data: slicedTransformedX.map(p => p.y),
          borderColor: '#dc2626',  // Red
          backgroundColor: 'transparent',
          borderWidth: 3,
          pointRadius: 0
        },
        {
          label: "y' Lateral (turn) [FILTERED]",
          data: slicedTransformedY.map(p => p.y),
          borderColor: '#2563eb',  // Blue
          backgroundColor: 'transparent',
          borderWidth: 3,
          pointRadius: 0
        },
        {
          label: "z' Vertical (bump) [FILTERED]",
          data: slicedTransformedZ.map(p => p.y),
          borderColor: '#16a34a',  // Green
          backgroundColor: 'transparent',
          borderWidth: 3,
          pointRadius: 0
        },

        // === TRANSFORMED RAW (THIN) ===
        {
          label: "x' Forward/Back [raw]",
          data: slicedRawTransformedX.map(p => p.y),
          borderColor: 'rgba(220, 38, 38, 0.3)',
          backgroundColor: 'transparent',
          borderWidth: 1,
          pointRadius: 0
        },
        {
          label: "y' Lateral [raw]",
          data: slicedRawTransformedY.map(p => p.y),
          borderColor: 'rgba(37, 99, 235, 0.3)',
          backgroundColor: 'transparent',
          borderWidth: 1,
          pointRadius: 0
        },
        {
          label: "z' Vertical [raw]",
          data: slicedRawTransformedZ.map(p => p.y),
          borderColor: 'rgba(22, 163, 74, 0.3)',
          backgroundColor: 'transparent',
          borderWidth: 1,
          pointRadius: 0
        },

        // === KEEP FILTERED SENSOR MAGNITUDE FOR COMPARISON ===
        {
          label: '🔴 Sensor Mag (phone) [FILTERED]',
          data: slicedFilteredSensorMag.map(p => p.y),
          borderColor: '#f59e0b',  // Orange
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          borderDash: [5, 5]
        },

        // Keep other phone-coordinate lines very faded (for reference only)
        {
          label: 'Linear X (phone) [FILTERED]',
          data: slicedFilteredLinearX.map(p => p.y),
          borderColor: 'rgba(153, 27, 27, 0.2)',
          backgroundColor: 'transparent',
          borderWidth: 1,
          pointRadius: 0,
          borderDash: [3, 3]
        },
        {
          label: 'Linear Y (phone) [FILTERED]',
          data: slicedFilteredLinearY.map(p => p.y),
          borderColor: 'rgba(146, 64, 14, 0.2)',
          backgroundColor: 'transparent',
          borderWidth: 1,
          pointRadius: 0,
          borderDash: [3, 3]
        },
        {
          label: 'Linear Z (phone) [FILTERED]',
          data: slicedFilteredLinearZ.map(p => p.y),
          borderColor: 'rgba(30, 58, 138, 0.2)',
          backgroundColor: 'transparent',
          borderWidth: 1,
          pointRadius: 0,
          borderDash: [3, 3]
        },

        // Raw phone coordinates - very faded
        {
          label: 'GPS Accel [raw]',
          data: slicedGPSAccel.map(p => p.y),
          borderColor: 'rgba(16, 185, 129, 0.15)',
          backgroundColor: 'transparent',
          borderWidth: 1,
          pointRadius: 0
        },
        {
          label: 'Sensor Mag [raw]',
          data: slicedLinearMag.map(p => p.y),
          borderColor: 'rgba(245, 158, 11, 0.15)',
          backgroundColor: 'transparent',
          borderWidth: 1,
          pointRadius: 0
        },
        {
          label: 'Linear X [raw]',
          data: slicedLinearX.map(p => p.y),
          borderColor: 'rgba(239, 68, 68, 0.1)',
          backgroundColor: 'transparent',
          borderWidth: 1,
          pointRadius: 0
        },
        {
          label: 'Linear Y [raw]',
          data: slicedLinearY.map(p => p.y),
          borderColor: 'rgba(245, 158, 11, 0.1)',
          backgroundColor: 'transparent',
          borderWidth: 1,
          pointRadius: 0
        },
        {
          label: 'Linear Z [raw]',
          data: slicedLinearZ.map(p => p.y),
          borderColor: 'rgba(59, 130, 246, 0.1)',
          backgroundColor: 'transparent',
          borderWidth: 1,
          pointRadius: 0
        },
        {
          label: 'Raw X (with gravity)',
          data: slicedRawX.map(p => p.y),
          borderColor: 'rgba(239, 68, 68, 0.08)',
          backgroundColor: 'transparent',
          borderWidth: 1,
          pointRadius: 0
        },
        {
          label: 'Raw Y (with gravity)',
          data: slicedRawY.map(p => p.y),
          borderColor: 'rgba(245, 158, 11, 0.08)',
          backgroundColor: 'transparent',
          borderWidth: 1,
          pointRadius: 0
        },
        {
          label: 'Raw Z (with gravity)',
          data: slicedRawZ.map(p => p.y),
          borderColor: 'rgba(59, 130, 246, 0.08)',
          backgroundColor: 'transparent',
          borderWidth: 1,
          pointRadius: 0
        }
      ]
    };
  }, [calibrationResult, session, viewMode, scrollPosition, windowSize, orientationFilterAlpha]);

  // Apply exponential moving average filter
  function applyEMAFilter(data: number[], alpha: number): number[] {
    if (data.length === 0) return [];
    const result: number[] = [];
    let smoothed = data[0];

    for (let i = 0; i < data.length; i++) {
      const val = data[i];
      if (isNaN(val) || !isFinite(val)) {
        result.push(smoothed); // Use previous valid value
        continue;
      }
      smoothed = alpha * val + (1 - alpha) * smoothed;
      result.push(smoothed);
    }
    return result;
  }

  // Helper function to unwrap angles (remove 360° jumps)
  function unwrapAngles(angles: number[]): number[] {
    if (angles.length === 0) return [];

    const unwrapped: number[] = [angles[0]];
    let offset = 0;

    for (let i = 1; i < angles.length; i++) {
      let diff = angles[i] - angles[i - 1];

      // Detect wraparound
      if (diff > 180) {
        offset -= 360;
      } else if (diff < -180) {
        offset += 360;
      }

      unwrapped.push(angles[i] + offset);
    }

    return unwrapped;
  }

  // Master Signal Viewer - Automotive-style comprehensive signal display with filtered signals
  const masterSignalViewerData = useMemo(() => {
    if (!calibrationResult || !session) return null;

    // Extract raw signals
    const rawAccelX = session.accelerometerData.map(a => a.x);
    const rawAccelY = session.accelerometerData.map(a => a.y);
    const rawAccelZ = session.accelerometerData.map(a => a.z);

    const rawGyroX = session.gyroscopeData.map(g => g.x);
    const rawGyroY = session.gyroscopeData.map(g => g.y);
    const rawGyroZ = session.gyroscopeData.map(g => g.z);

    // Magnetometer debug logging
    console.log('Magnetometer debug:', {
      hasMagData: !!session.magnetometerData,
      magLength: session.magnetometerData?.length || 0,
      firstMag: session.magnetometerData?.[0],
      lastMag: session.magnetometerData?.[session.magnetometerData.length - 1],
      sample: session.magnetometerData?.slice(0, 5)
    });

    const rawMagX = session.magnetometerData?.map(m => {
      let val = m.x;
      if (isNaN(val) || !isFinite(val)) return 0;

      // If values are huge (>100), might be in microtesla, scale down
      if (Math.abs(val) > 100) {
        val = val / 1000; // Convert µT to mT or similar
      }

      return val;
    }) || [];
    const rawMagY = session.magnetometerData?.map(m => {
      let val = m.y;
      if (isNaN(val) || !isFinite(val)) return 0;
      if (Math.abs(val) > 100) val = val / 1000;
      return val;
    }) || [];
    const rawMagZ = session.magnetometerData?.map(m => {
      let val = m.z;
      if (isNaN(val) || !isFinite(val)) return 0;
      if (Math.abs(val) > 100) val = val / 1000;
      return val;
    }) || [];

    // Apply unwrapping to remove 360° jumps
    const unwrappedMagX = unwrapAngles(rawMagX);
    const unwrappedMagY = unwrapAngles(rawMagY);
    const unwrappedMagZ = unwrapAngles(rawMagZ);

    // Scale magnetometer for display (360° becomes 36 on graph)
    const displayMagX = unwrappedMagX.map(v => v / 10);
    const displayMagY = unwrappedMagY.map(v => v / 10);
    const displayMagZ = unwrappedMagZ.map(v => v / 10);

    console.log('Magnetometer after processing:', {
      rawMagXRange: [Math.min(...rawMagX), Math.max(...rawMagX)],
      unwrappedMagXRange: [Math.min(...unwrappedMagX), Math.max(...unwrappedMagX)],
      scaledRange: [Math.min(...displayMagX), Math.max(...displayMagX)],
      note: 'Divided by 10 for display (360° → 36)',
      sampleUnwrapped: unwrappedMagX.slice(0, 10)
    });

    // Use filtered signals from calibration result (already filtered in calibration loop)
    const filteredAccelX = calibrationResult.accelFilteredX;
    const filteredAccelY = calibrationResult.accelFilteredY;
    const filteredAccelZ = calibrationResult.accelFilteredZ;

    const filteredGyroX = calibrationResult.gyroFilteredX;
    const filteredGyroY = calibrationResult.gyroFilteredY;
    const filteredGyroZ = calibrationResult.gyroFilteredZ;

    // Slice data based on scroll position
    const sliceData = (arr: number[]) => {
      if (viewMode === 'all' || arr.length <= windowSize) return arr;
      return arr.slice(scrollPosition, scrollPosition + windowSize);
    };

    // Create datasets with visibility and offset controls
    const datasets: any[] = [];

    // Helper to add dataset
    const addDataset = (key: string, data: number[], control: any) => {
  console.log(`addDataset called: ${key}`, { hasControl: !!control, visible: control?.visible, dataLength: data?.length, willAdd: !!(control && control.visible && data && data.length > 0) });
      if (!control || !control.visible) return;

      const slicedData = sliceData(data);
  console.log(`  ${key} after slice:`, slicedData.length);
      if (slicedData.length === 0) return;

  console.log(`  ✅ ${key} ADDED to chart`);
      datasets.push({
        label: control.label || key,  // Use custom label if available, otherwise use key
        data: slicedData.map(v => v + control.offset),
        borderColor: control.color,
        backgroundColor: 'transparent',
        borderWidth: control.width || 1,
        pointRadius: 0,
        yAxisID: control.yAxisID || 'y'
      });
    };

    // Add all signals
    addDataset('accelRawX', rawAccelX, signalControls.accelRawX);
    addDataset('accelRawY', rawAccelY, signalControls.accelRawY);
    addDataset('accelRawZ', rawAccelZ, signalControls.accelRawZ);

    addDataset('accelFilteredX', filteredAccelX, signalControls.accelFilteredX);
    addDataset('accelFilteredY', filteredAccelY, signalControls.accelFilteredY);
    addDataset('accelFilteredZ', filteredAccelZ, signalControls.accelFilteredZ);

    addDataset('gyroRawX', rawGyroX, signalControls.gyroRawX);
    addDataset('gyroRawY', rawGyroY, signalControls.gyroRawY);
    addDataset('gyroRawZ', rawGyroZ, signalControls.gyroRawZ);

    addDataset('gyroFilteredX', filteredGyroX, signalControls.gyroFilteredX);
    addDataset('gyroFilteredY', filteredGyroY, signalControls.gyroFilteredY);
    addDataset('gyroFilteredZ', filteredGyroZ, signalControls.gyroFilteredZ);

    const accelLinearX = calibrationResult.accelLinearX_measured;
    const accelLinearY = calibrationResult.accelLinearY_measured;
    const accelLinearZ = calibrationResult.accelLinearZ_measured;
    addDataset('accelLinearX_measured', accelLinearX, signalControls.accelLinearX_measured);
    addDataset('accelLinearY_measured', accelLinearY, signalControls.accelLinearY_measured);
    addDataset('accelLinearZ_measured', accelLinearZ, signalControls.accelLinearZ_measured);

    if (displayMagX.length > 0) {
      addDataset('magX', displayMagX, signalControls.magX);
      addDataset('magY', displayMagY, signalControls.magY);
      addDataset('magZ', displayMagZ, signalControls.magZ);
    }

    // Add gravity estimation components (should converge to ~9.8 m/s²)
    const gravityX = calibrationResult.gravityHistory.map(g => g.x);
    const gravityY = calibrationResult.gravityHistory.map(g => g.y);
    const gravityZ = calibrationResult.gravityHistory.map(g => g.z);

    console.log('Gravity vector data check:', {
      length: gravityX.length,
      gravityX_range: [Math.min(...gravityX), Math.max(...gravityX)],
      gravityY_range: [Math.min(...gravityY), Math.max(...gravityY)],
      gravityZ_range: [Math.min(...gravityZ), Math.max(...gravityZ)],
      final_magnitude: Math.sqrt(gravityX[gravityX.length-1]**2 + gravityY[gravityY.length-1]**2 + gravityZ[gravityZ.length-1]**2)
    });

    addDataset('gravityX', gravityX, signalControls.gravityX);
    addDataset('gravityY', gravityY, signalControls.gravityY);
    addDataset('gravityZ', gravityZ, signalControls.gravityZ);

    // Add forward vector components (the learned forward direction in phone coordinates)
    const forwardX = calibrationResult.forwardHistory.map(f => f.x);
    const forwardY = calibrationResult.forwardHistory.map(f => f.y);
    const forwardZ = calibrationResult.forwardHistory.map(f => f.z);

    console.log('Forward vector data check:', {
      length: forwardX.length,
      forwardX_range: [Math.min(...forwardX), Math.max(...forwardX)],
      forwardY_range: [Math.min(...forwardY), Math.max(...forwardY)],
      forwardZ_range: [Math.min(...forwardZ), Math.max(...forwardZ)],
      final_magnitude: Math.sqrt(forwardX[forwardX.length-1]**2 + forwardY[forwardY.length-1]**2 + forwardZ[forwardZ.length-1]**2),
      sample: forwardX.slice(0, 10)
    });

    addDataset('forwardX', forwardX, signalControls.forwardX);
    addDataset('forwardY', forwardY, signalControls.forwardY);
    addDataset('forwardZ', forwardZ, signalControls.forwardZ);

    // Add transformed (primes) - pre-calculated from calibration, NOT affected by filter slider
    const xPrimeData = calibrationResult.transformed.map(t => t.x);
    const yPrimeData = calibrationResult.transformed.map(t => t.y);
    const zPrimeData = calibrationResult.transformed.map(t => t.z);

    console.log('xPrime data check:', {
      length: xPrimeData.length,
      min: Math.min(...xPrimeData),
      max: Math.max(...xPrimeData),
      avg: xPrimeData.reduce((a, b) => a + b, 0) / xPrimeData.length,
      sample: xPrimeData.slice(0, 10)
    });

    addDataset('xPrime', xPrimeData, signalControls.xPrime);
    addDataset('yPrime', yPrimeData, signalControls.yPrime);
    addDataset('zPrime', zPrimeData, signalControls.zPrime);

    // Add virtual accelerations
    addDataset('virtualForward', calibrationResult.virtualForwardAccel, signalControls.virtualForward);
    addDataset('virtualLateral', calibrationResult.virtualLateralAccel, signalControls.virtualLateral);
    addDataset('rawGPSAccel', calibrationResult.rawGPSAccel, signalControls.rawGPSAccel);
    addDataset('gpsDeltaTime', calibrationResult.gpsDeltaTime, signalControls.gpsDeltaTime);
    addDataset('gpsTimestamp', calibrationResult.gpsTimestamp, signalControls.gpsTimestamp);

    // Add forward learning state (0.5 = learning, 0 = not learning)
    const forwardLearningState = calibrationResult.gpsAccelDetected.map(detected => detected ? 0.5 : 0);
    addDataset('forwardLearning', forwardLearningState, signalControls.forwardLearning);

    // Add forward vector convergence (should decrease toward 0)
    addDataset('forwardConvergence', calibrationResult.forwardChangeRate, signalControls.forwardConvergence);

    // Add stability detection signals (convert boolean to 0.5/0 for compact display)
    const phoneStableSignal = calibrationResult.phoneStable.map(s => s ? 0.5 : 0);
    const vehicleStationarySignal = calibrationResult.vehicleStationary.map(s => s ? 0.5 : 0);
    const vehicleMovingSignal = calibrationResult.vehicleMoving.map(s => s ? 0.5 : 0);
    addDataset('phoneStable', phoneStableSignal, signalControls.phoneStable);
    addDataset('vehicleStationary', vehicleStationarySignal, signalControls.vehicleStationary);
    addDataset('vehicleMoving', vehicleMovingSignal, signalControls.vehicleMoving);

    // Add magnetometer heading
    addDataset('magHeading', calibrationResult.magHeading, signalControls.magHeading);

    // === CROSS-VERIFICATION TRIFECTA DEBUG ===
    console.log('=== TRIFECTA DEBUG ===');
    console.log('Lateral Accel Trifecta:', {
      measured: {
        min: Math.min(...calibrationResult.accelY_measured),
        max: Math.max(...calibrationResult.accelY_measured),
        avg: calibrationResult.accelY_measured.reduce((a, b) => a + b, 0) / calibrationResult.accelY_measured.length
      },
      fromGyro: {
        min: Math.min(...calibrationResult.accelY_fromGyro),
        max: Math.max(...calibrationResult.accelY_fromGyro),
        avg: calibrationResult.accelY_fromGyro.reduce((a, b) => a + b, 0) / calibrationResult.accelY_fromGyro.length
      },
      fromMag: {
        min: Math.min(...calibrationResult.accelY_fromMag),
        max: Math.max(...calibrationResult.accelY_fromMag),
        avg: calibrationResult.accelY_fromMag.reduce((a, b) => a + b, 0) / calibrationResult.accelY_fromMag.length
      }
    });

    console.log('Rotation Rate Trifecta:', {
      measured: {
        min: Math.min(...calibrationResult.gyroZ_measured),
        max: Math.max(...calibrationResult.gyroZ_measured),
        avg: calibrationResult.gyroZ_measured.reduce((a, b) => a + b, 0) / calibrationResult.gyroZ_measured.length
      },
      fromAccel: {
        min: Math.min(...calibrationResult.gyroZ_fromAccel),
        max: Math.max(...calibrationResult.gyroZ_fromAccel),
        avg: calibrationResult.gyroZ_fromAccel.reduce((a, b) => a + b, 0) / calibrationResult.gyroZ_fromAccel.length
      },
      fromMag: {
        min: Math.min(...calibrationResult.gyroZ_fromMag),
        max: Math.max(...calibrationResult.gyroZ_fromMag),
        avg: calibrationResult.gyroZ_fromMag.reduce((a, b) => a + b, 0) / calibrationResult.gyroZ_fromMag.length
      }
    });

    console.log('Heading Trifecta:', {
      measured: {
        min: Math.min(...calibrationResult.heading_measured),
        max: Math.max(...calibrationResult.heading_measured),
        avg: calibrationResult.heading_measured.reduce((a, b) => a + b, 0) / calibrationResult.heading_measured.length
      },
      fromAccel: {
        min: Math.min(...calibrationResult.heading_fromAccel),
        max: Math.max(...calibrationResult.heading_fromAccel),
        avg: calibrationResult.heading_fromAccel.reduce((a, b) => a + b, 0) / calibrationResult.heading_fromAccel.length
      },
      fromGyro: {
        min: Math.min(...calibrationResult.heading_fromGyro),
        max: Math.max(...calibrationResult.heading_fromGyro),
        avg: calibrationResult.heading_fromGyro.reduce((a, b) => a + b, 0) / calibrationResult.heading_fromGyro.length
      }
    });

    // === ADD OBSERVER DATASETS TO CHART ===
    console.log('=== ADDING OBSERVER DATASETS TO CHART ===');
    console.log('Adding observer datasets:', {
      hasAccelYData: !!calibrationResult.accelY_measured,
      accelYLength: calibrationResult.accelY_measured?.length || 0,
      hasGyroZData: !!calibrationResult.gyroZ_measured,
      gyroZLength: calibrationResult.gyroZ_measured?.length || 0,
      hasHeadingData: !!calibrationResult.heading_measured,
      headingLength: calibrationResult.heading_measured?.length || 0,
      signalControlsExist: {
        accelY_real: !!signalControls.accelY_real,
        accelY_gyro: !!signalControls.accelY_gyro,
        accelY_mag: !!signalControls.accelY_mag,
        gyroZ_real: !!signalControls.gyroZ_real,
        gyroZ_accel: !!signalControls.gyroZ_accel,
        gyroZ_mag: !!signalControls.gyroZ_mag,
        heading_real: !!signalControls.heading_real,
        heading_accel: !!signalControls.heading_accel,
        heading_gyro: !!signalControls.heading_gyro
      }
    });

    // Add trifecta datasets with conditional checks
    if (calibrationResult.accelY_measured) {
      addDataset('accelY_real', calibrationResult.accelY_measured, signalControls.accelY_real);
      addDataset('accelY_gyro', calibrationResult.accelY_fromGyro, signalControls.accelY_gyro);
      addDataset('accelY_mag', calibrationResult.accelY_fromMag, signalControls.accelY_mag);
    }

    if (calibrationResult.gyroZ_measured) {
      addDataset('gyroZ_real', calibrationResult.gyroZ_measured, signalControls.gyroZ_real);
      addDataset('gyroZ_accel', calibrationResult.gyroZ_fromAccel, signalControls.gyroZ_accel);
      addDataset('gyroZ_mag', calibrationResult.gyroZ_fromMag, signalControls.gyroZ_mag);
    }

    if (calibrationResult.heading_measured) {
      addDataset('heading_real', calibrationResult.heading_measured, signalControls.heading_real);
      addDataset('heading_accel', calibrationResult.heading_fromAccel, signalControls.heading_accel);
      addDataset('heading_gyro', calibrationResult.heading_fromGyro, signalControls.heading_gyro);
    }

    // Add GPS speed (right axis) - interpolate to match accelerometer length FIRST
    let interpolatedGPSSpeed: number[] = [];

    console.log('GPS interpolation debug:', {
      hasGPSData: !!session.gpsData,
      gpsLength: session.gpsData?.length || 0,
      accelLength: session.accelerometerData.length,
      firstGPS: session.gpsData?.[0],
      lastGPS: session.gpsData?.[session.gpsData.length - 1]
    });

    if (session.gpsData && session.gpsData.length > 0) {
      const targetLength = session.accelerometerData.length;

      for (let i = 0; i < targetLength; i++) {
        const gpsRatio = (i / targetLength) * session.gpsData.length;
        const prevIndex = Math.floor(gpsRatio);
        const nextIndex = Math.min(prevIndex + 1, session.gpsData.length - 1);

        let speed = 0;
        if (prevIndex === nextIndex) {
          speed = session.gpsData[prevIndex]?.mph || 0;
        } else {
          const ratio = gpsRatio - prevIndex;
          const prevSpeed = session.gpsData[prevIndex]?.mph || 0;
          const nextSpeed = session.gpsData[nextIndex]?.mph || 0;
          speed = prevSpeed + (nextSpeed - prevSpeed) * ratio;
        }

        interpolatedGPSSpeed.push(speed);
      }

      console.log('GPS speed interpolation result:', {
        outputLength: interpolatedGPSSpeed.length,
        min: Math.min(...interpolatedGPSSpeed),
        max: Math.max(...interpolatedGPSSpeed),
        avg: interpolatedGPSSpeed.reduce((a, b) => a + b, 0) / interpolatedGPSSpeed.length,
        sample: interpolatedGPSSpeed.slice(0, 10)
      });
    } else {
      interpolatedGPSSpeed = Array(session.accelerometerData.length).fill(0);
    }

    // NOW slice it like all other signals
    // Add raw stepped GPS (1 Hz)
    const gpsSpeedRawMPH = calibrationResult.gpsSpeedRaw.map(mps => mps * 2.237);
    addDataset('gpsSpeedRaw', gpsSpeedRawMPH, signalControls.gpsSpeedRaw);

    addDataset('gpsSpeed', interpolatedGPSSpeed, signalControls.gpsSpeed);

    // Add smoothed GPS speed (recursive, alpha=0.5 fixed)
    const gpsSpeedSmoothedMPH = calibrationResult.gpsSpeedSmoothed.map(mps => mps * 2.237);
    addDataset('gpsSpeedSmoothed', gpsSpeedSmoothedMPH, signalControls.gpsSpeedSmoothed);

    // Add filtered GPS speed (convert m/s to mph for display)
    const gpsSpeedFilteredMPH = calibrationResult.gpsSpeedFiltered.map(mps => mps * 2.237);
    addDataset('gpsSpeedFiltered', gpsSpeedFilteredMPH, signalControls.gpsSpeedFiltered);

    // Add confidence
    const confidencePercent = calibrationResult.confidence.map(c => c * 100);
    addDataset('confidence', confidencePercent, signalControls.confidence);

    // Create labels
    const startIndex = viewMode === 'scrollable' ? scrollPosition : 0;
    const dataLength = viewMode === 'all' ? session.accelerometerData.length : Math.min(windowSize, session.accelerometerData.length - scrollPosition);
    const labels = Array.from({length: dataLength}, (_, i) => (startIndex + i).toString());

    return { labels, datasets };
  }, [calibrationResult, session, viewMode, scrollPosition, windowSize, signalControls, filterAlpha]);

  // Mouse handlers for drag scrolling
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !calibrationResult) return;
    const delta = Math.floor((dragStart - e.clientX) * 2); // pixels to data points
    const maxScroll = calibrationResult.transformed.length - windowSize;
    setScrollPosition(Math.max(0, Math.min(maxScroll, scrollPosition + delta)));
    setDragStart(e.clientX);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    // Disabled: Mouse wheel zoom interferes with trackpad scrolling
    // User can still drag left/right to pan
    return;
  };

  const toggleSignal = (key: string) => {
    setSignalControls({
      ...signalControls,
      [key]: { ...signalControls[key], visible: !signalControls[key].visible }
    });
  };

  const updateOffset = (key: string, offset: number) => {
    setSignalControls(prev => ({
      ...prev,
      [key]: { ...prev[key], offset }
    }));
  };

  // Custom plugin to draw vertical crosshair and floating labels above datapoints
  const crosshairLabelsPlugin = {
    id: 'crosshairLabels',
    afterDraw(chart: any) {
      const { ctx, tooltip, chartArea, scales } = chart;

      // Only draw if tooltip is active (user is hovering)
      if (!tooltip || !tooltip._active || tooltip._active.length === 0) return;

      const x = tooltip._active[0].element.x;

      ctx.save();

      // Draw vertical crosshair line
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw label box above each datapoint
      tooltip._active.forEach((activePoint: any) => {
        const dataset = chart.data.datasets[activePoint.datasetIndex];
        const meta = chart.getDatasetMeta(activePoint.datasetIndex);
        if (!meta.visible) return;

        const point = meta.data[activePoint.index];
        const value = dataset.data[activePoint.index];

        // Get signal key to find offset
        const datasetLabel = dataset.label || '';
        const signalKey = Object.keys(signalControls).find(key => {
          const control = signalControls[key];
          return (control.label || key) === datasetLabel;
        });

        // Subtract offset to show true value
        const offset = signalKey ? signalControls[signalKey].offset : 0;
        const trueValue = value - offset;

        const labelText = `${datasetLabel}: ${trueValue.toFixed(3)}`;

        // Measure text
        ctx.font = 'bold 11px Arial';
        const textWidth = ctx.measureText(labelText).width;

        // Position above the datapoint
        const labelY = point.y - 20;

        // Draw text with no background or border
        ctx.fillStyle = dataset.borderColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, point.x, labelY);
      });

      ctx.restore();
    }
  };

  // Create reference frame visualization chart data
  const referenceFrameChartData = useMemo(() => {
    if (!calibrationResult) return null;

    const slicedData = getSlicedData(calibrationResult.transformed);
    console.log('Vehicle Reference Frame - data points:', slicedData.length);

    // Use actual datapoint indices for labels
    const startIndex = viewMode === 'scrollable' ? scrollPosition : 0;
    const indices = slicedData.map((_, index) => (startIndex + index).toString());

    const xPrimeValues = slicedData.map(point => point.x);
    const yPrimeValues = slicedData.map(point => point.y);
    const zPrimeValues = slicedData.map(point => point.z);
    const zeroLine = slicedData.map(() => 0);

    return {
      labels: indices,
      datasets: [
        // Zero reference line (single dashed gray line at y=0)
        {
          label: 'Zero Reference',
          data: zeroLine,
          borderColor: '#9ca3af',
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [8, 4],
          pointRadius: 0,
          fill: false,
        },
        // Transformed data (colored solid lines)
        {
          label: 'x\' (forward/back)',
          data: xPrimeValues,
          borderColor: '#ef4444',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
        },
        {
          label: 'y\' (lateral)',
          data: yPrimeValues,
          borderColor: '#3b82f6',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
        },
        {
          label: 'z\' (vertical)',
          data: zPrimeValues,
          borderColor: '#10b981',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
        }
      ]
    };
  }, [calibrationResult, viewMode, scrollPosition, windowSize]);

  // Create state timeline chart data
  const stateTimelineData = useMemo(() => {
    if (!calibrationResult) return null;

    // Apply slicing and add vertical offsets
    const slicedGPSAccel = getSlicedData(calibrationResult.gpsAccelDetected.map((v, i) => ({
      x: 0,
      y: v ? 1.0 : 0.0,  // Bottom line: GPS Accel Detected
      z: 0,
      timestamp: i
    })));

    const slicedTurning = getSlicedData(calibrationResult.turningDetected.map((v, i) => ({
      x: 0,
      y: v ? 1.4 : 0.4,  // Middle line: Turning Detected
      z: 0,
      timestamp: i
    })));

    // Forward update happens when GPS accel detected
    const forwardUpdates = calibrationResult.gpsAccelDetected.map((v, i) =>
      v ? 1.8 : 0.8  // Top line: Forward Update
    );
    const slicedForwardUpdates = getSlicedData(forwardUpdates.map((v, i) => ({ x: 0, y: v, z: 0, timestamp: i })));

    // Use actual datapoint indices for labels
    const startIndex = viewMode === 'scrollable' ? scrollPosition : 0;
    const indices = slicedGPSAccel.map((_, index) => (startIndex + index).toString());

    return {
      labels: indices,
      datasets: [
        {
          label: 'GPS Accel Detected',
          data: slicedGPSAccel.map(p => p.y),
          borderColor: '#10b981',  // Green
          backgroundColor: 'transparent',
          stepped: true,
          borderWidth: 2,
          pointRadius: 0,
          fill: false
        },
        {
          label: 'Turning Detected',
          data: slicedTurning.map(p => p.y),
          borderColor: '#3b82f6',  // Blue
          backgroundColor: 'transparent',
          stepped: true,
          borderWidth: 2,
          pointRadius: 0,
          fill: false
        },
        {
          label: 'Forward Update',
          data: slicedForwardUpdates.map(p => p.y),
          borderColor: '#f59e0b',  // Orange
          backgroundColor: 'transparent',
          stepped: true,
          borderWidth: 2,
          pointRadius: 0,
          fill: false
        }
      ]
    };
  }, [calibrationResult, viewMode, scrollPosition, windowSize]);

  // Create virtual vs real acceleration comparison chart
  const virtualVsRealData = useMemo(() => {
    if (!calibrationResult || !session) return null;

    // Get real accelerometer linear acceleration (remove gravity)
    const slicedRealAccel = getSlicedData(session.accelerometerData.map((accel, i) => {
      const grav = calibrationResult.gravityHistory[i] || { x: 0, y: 0, z: 0 };
      // Project onto forward direction for comparison
      const forward = calibrationResult.forwardHistory[i] || { x: 1, y: 0, z: 0 };
      const forwardMag = Math.sqrt(forward.x ** 2 + forward.y ** 2 + forward.z ** 2);
      if (forwardMag < 0.1) return { x: 0, y: 0, z: 0, timestamp: i };

      const linearAccel = {
        x: accel.x - grav.x,
        y: accel.y - grav.y,
        z: accel.z - grav.z
      };

      // Project onto forward direction
      const forwardAccel = (linearAccel.x * forward.x + linearAccel.y * forward.y + linearAccel.z * forward.z) / forwardMag;

      return { x: 0, y: forwardAccel, z: 0, timestamp: i };
    }));

    const slicedVirtualForward = getSlicedData(calibrationResult.virtualForwardAccel.map((v, i) => ({
      x: 0,
      y: v,
      z: 0,
      timestamp: i
    })));

    // Use actual datapoint indices for labels
    const startIndex = viewMode === 'scrollable' ? scrollPosition : 0;
    const indices = slicedVirtualForward.map((_, index) => (startIndex + index).toString());

    return {
      labels: indices,
      datasets: [
        {
          label: 'GPS Virtual Forward Accel (m/s²)',
          data: slicedVirtualForward.map(p => p.y),
          borderColor: '#10b981',  // Green
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          fill: false
        },
        {
          label: 'Real Sensor Forward Accel (m/s²)',
          data: slicedRealAccel.map(p => p.y),
          borderColor: '#ef4444',  // Red
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          fill: false
        }
      ]
    };
  }, [calibrationResult, session, viewMode, scrollPosition, windowSize]);

  const avgConfidence = calibrationResult
    ? calibrationResult.confidence.reduce((a, b) => a + b, 0) / calibrationResult.confidence.length
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
        <div className="max-w-7xl mx-auto">
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
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-2 mb-2">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">📐 Floating Calibration Analysis</h1>
              <p className="text-xs text-gray-600">Adaptive vehicle coordinate transformation</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => router.push('/sessions')}
                className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
              >
                Back to Sessions
              </button>
              {isAdmin && (
                <button
                  onClick={handleDelete}
                  className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700"
                >
                  🗑️ Delete
                </button>
              )}
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="text-center py-8">
              <div className="text-gray-600">Loading session data...</div>
            </div>
          </div>
        ) : session && calibrationResult ? (
          <>
            {/* Session Metadata */}
            <div className="bg-white rounded-lg shadow-lg p-2 mb-2">
              <h2 className="text-xl font-bold mb-3 text-gray-800">Session Information</h2>
              <div className="grid md:grid-cols-4 gap-3">
                <div>
                  <div className="text-xs text-gray-600">Session ID</div>
                  <div className="font-semibold text-sm text-gray-800">{session.sessionId}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-600">Start Time</div>
                  <div className="font-semibold text-sm text-gray-800">{formatDate(session.startTime)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-600">Duration</div>
                  <div className="font-semibold text-sm text-gray-800">
                    {formatDuration(session.startTime, session.endTime)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-600">Data Points</div>
                  <div className="font-semibold text-sm text-gray-800">
                    {session.accelerometerData.length.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>

            {/* Master Signal Viewer - Automotive-style comprehensive display */}
            {masterSignalViewerData && (
              <div className="bg-white rounded-lg shadow-lg p-4 mb-6">
                <h2 className="text-xl font-bold mb-3 text-gray-800">
                  🎛️ Master Signal Viewer
                </h2>
                <p className="text-sm text-gray-600 mb-3">
                  <strong>Automotive-style multi-signal analysis.</strong> Toggle signals, adjust offsets to align.
                  <strong>Controls:</strong> Drag to scroll | +/− buttons to zoom | Mousewheel/trackpad to zoom
                </p>

                {/* Controls - All in one row */}
                <div className="flex flex-wrap gap-4 mb-3 items-center bg-gray-50 p-3 rounded">
                  {/* Zoom Controls */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Zoom:</span>
                    <button
                      onClick={() => setWindowSize(Math.max(100, windowSize - 100))}
                      className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                    >
                      + In
                    </button>
                    <button
                      onClick={() => setWindowSize(Math.min(totalDataPoints, windowSize + 100))}
                      className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                    >
                      − Out
                    </button>
                    <span className="text-xs text-gray-600">{windowSize} pts</span>
                  </div>

                  {/* Presets */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Presets:</span>
                    <button onClick={() => setWindowSize(200)} className="px-2 py-1 bg-gray-200 rounded text-xs">200</button>
                    <button onClick={() => setWindowSize(500)} className="px-2 py-1 bg-gray-200 rounded text-xs">500</button>
                    <button onClick={() => setWindowSize(1000)} className="px-2 py-1 bg-gray-200 rounded text-xs">1k</button>
                    <button onClick={() => setWindowSize(2000)} className="px-2 py-1 bg-gray-200 rounded text-xs">2k</button>
                    <button onClick={() => setWindowSize(totalDataPoints)} className="px-2 py-1 bg-gray-200 rounded text-xs">All</button>
                  </div>

                  {/* View Mode Toggle */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setViewMode('all');
                        setScrollPosition(0);
                      }}
                      className={`px-3 py-1 rounded text-sm font-semibold ${
                        viewMode === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      All Data
                    </button>
                    <button
                      onClick={() => setViewMode('scrollable')}
                      className={`px-3 py-1 rounded text-sm font-semibold ${
                        viewMode === 'scrollable' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      Scrollable
                    </button>
                  </div>

                  {/* Export Settings */}
                  <button
                    onClick={() => {
                      const exported = JSON.stringify(signalControls, null, 2);
                      console.log('=== SIGNAL CONTROLS EXPORT ===');
                      console.log(exported);
                      console.log('=== Copy the above to update defaults ===');
                      navigator.clipboard.writeText(exported);
                      alert('Signal settings copied to clipboard and logged to console!');
                    }}
                    className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-semibold"
                  >
                    📋 Export
                  </button>

                  {/* Accel Filter */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Accel Filter:</span>
                    <input
                      type="range"
                      min="0.90"
                      max="0.99"
                      step="0.01"
                      value={alpha}
                      onChange={(e) => setAlpha(parseFloat(e.target.value))}
                      className="w-32"
                    />
                    <span className="text-xs text-gray-600">
                      α={alpha.toFixed(2)}
                    </span>
                  </div>

                  {/* Gyro Filter Strength */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Gyro Filter:</span>
                    <input
                      type="range"
                      min="0.50"
                      max="0.99"
                      step="0.01"
                      value={filterAlpha}
                      onChange={(e) => setFilterAlpha(parseFloat(e.target.value))}
                      className="w-32"
                    />
                    <span className="text-xs text-gray-600">
                      α={filterAlpha.toFixed(2)} ({filterAlpha > 0.90 ? 'Heavy' : filterAlpha > 0.70 ? 'Medium' : 'Light'})
                    </span>
                  </div>

                  {/* Observer Filter Strength */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Observer:</span>
                    <input
                      type="range"
                      min="0.01"
                      max="0.20"
                      step="0.01"
                      value={observerAlpha}
                      onChange={(e) => setObserverAlpha(parseFloat(e.target.value))}
                      className="w-32"
                    />
                    <span className="text-xs text-gray-600">
                      α={observerAlpha.toFixed(2)} ({observerAlpha > 0.15 ? 'Heavy' : observerAlpha > 0.08 ? 'Medium' : 'Light'} smoothing)
                    </span>
                  </div>

                  {/* Orientation Filter */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Orientation:</span>
                    <input
                      type="range"
                      min="0.01"
                      max="0.95"
                      step="0.01"
                      value={orientationFilterAlpha}
                      onChange={(e) => setOrientationFilterAlpha(parseFloat(e.target.value))}
                      className="w-32"
                    />
                    <span className="text-xs text-gray-600">
                      α={orientationFilterAlpha.toFixed(2)} ({orientationFilterAlpha > 0.7 ? 'Heavy' : orientationFilterAlpha > 0.3 ? 'Medium' : 'Light'})
                    </span>
                  </div>

                  {/* Reset Settings */}
                  <button
                    onClick={() => {
                      localStorage.removeItem('masterSignalViewerControls');
                      window.location.reload();
                    }}
                    className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                  >
                    Reset Settings
                  </button>
                </div>

                {/* Signal Controls Panel - Readable Size with Tall Scroll Box */}
                <div className="grid grid-cols-4 gap-1 mb-2 max-h-64 overflow-y-auto bg-gray-50 p-2 rounded text-xs">
                  {(() => {
                  console.log('🔍 Signal controls keys:', Object.keys(signalControls).length, 'signals');
                  console.log('🔍 accelLinear keys:', Object.keys(signalControls).filter(k => k.includes('accelLinear')));
                  return Object.entries(signalControls);
                })().map(([key, control]) => (
                    <div key={key} className="flex items-center gap-1 py-1">
                      <input
                        type="checkbox"
                        checked={control.visible}
                        onChange={(e) => setSignalControls(prev => ({
                          ...prev,
                          [key]: { ...prev[key], visible: e.target.checked }
                        }))}
                        className="w-3 h-3"
                      />
                      <div
                        className="w-3 h-3 rounded"
                        style={{ backgroundColor: control.color.replace('rgba', 'rgb').replace(/, 0\.\d+\)/, ')') }}
                      />
                      <span className="text-[10px] min-w-[80px]" title={control.label || key}>
                        {control.label || key}
                      </span>
                      <input
                        type="range"
                        min="-30"
                        max="30"
                        step="1"
                        value={control.offset}
                        onChange={(e) => {
                          const newOffset = parseInt(e.target.value);
                          setSignalControls(prev => ({
                            ...prev,
                            [key]: { ...prev[key], offset: newOffset }
                          }));
                        }}
                        onDoubleClick={() => {
                          setSignalControls(prev => ({
                            ...prev,
                            [key]: { ...prev[key], offset: 0 }
                          }));
                        }}
                        className="w-32"
                        style={{ height: '4px' }}
                        title={`Offset: ${control.offset} (double-click to reset)`}
                      />
                      <span className="text-[10px] font-semibold text-gray-700 w-6 text-right">
                        {control.offset}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Interactive Chart with drag/zoom */}
                <div
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  onWheel={handleWheel}
                  style={{
                    height: '1200px',
                    cursor: isDragging ? 'grabbing' : 'grab',
                    userSelect: 'none'
                  }}
                >
                  <Line
                    data={masterSignalViewerData}
                    plugins={[crosshairLabelsPlugin]}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      animation: false,
                      interaction: {
                        mode: 'index',
                        intersect: false
                      },
                      scales: {
                        x: {
                          display: true,
                          grid: { display: false },
                          title: {
                            display: true,
                            text: viewMode === 'scrollable'
                              ? `Datapoint Index (showing ${scrollPosition} to ${scrollPosition + windowSize})`
                              : 'Datapoint Index (all data)'
                          },
                          ticks: {
                            callback: function(value, index) {
                              const label = this.chart.data.labels?.[index] as string || index.toString();
                              const numValue = parseInt(label);
                              const totalPoints = viewMode === 'all' ? calibrationResult.transformed.length : windowSize;

                              let tickInterval;
                              if (viewMode === 'scrollable') {
                                tickInterval = Math.max(50, Math.floor(windowSize / 5));
                              } else {
                                if (totalPoints < 1000) tickInterval = 200;
                                else if (totalPoints < 3000) tickInterval = 500;
                                else if (totalPoints < 6000) tickInterval = 1000;
                                else tickInterval = 2000;
                              }

                              if (numValue % tickInterval === 0) {
                                if (numValue >= 1000) {
                                  return (numValue / 1000).toFixed(1) + 'k';
                                }
                                return numValue.toString();
                              }
                              return '';
                            },
                            maxRotation: 0,
                            autoSkip: false
                          }
                        },
                        y: {
                          position: 'left',
                          min: -30,
                          max: 30,
                          ticks: {
                            stepSize: 10
                          },
                          title: {
                            display: true,
                            text: 'Acceleration (m/s²) / Rotation (rad/s) / Heading (°)'
                          },
                          grid: {
                            color: (context) => {
                              if (context.tick.value === 0) return 'rgba(0, 0, 0, 0.3)';
                              return 'rgba(0, 0, 0, 0.05)';
                            }
                          }
                        },
                        y1: {
                          position: 'right',
                          min: 0,
                          max: 80,
                          title: {
                            display: true,
                            text: 'Speed (mph) / Confidence (%)'
                          },
                          grid: {
                            display: false
                          }
                        }
                      },
                      plugins: {
                        legend: {
                          display: true,
                          position: 'top' as const,
                          labels: {
                            boxWidth: 20,
                            font: { size: 10 },
                            usePointStyle: true,
                            padding: 10
                          }
                        },
                        tooltip: {
                          enabled: false,  // Disable default tooltip
                          mode: 'index',
                          intersect: false,
                          callbacks: {
                            label: function(context: any) {
                              const datasetLabel = context.dataset.label || '';
                              const value = context.parsed.y;

                              // Find the signal key from the label to get the offset
                              const signalKey = Object.keys(signalControls).find(key => {
                                const control = signalControls[key];
                                return (control.label || key) === datasetLabel;
                              });

                              // Subtract the offset to show the true value
                              const offset = signalKey ? signalControls[signalKey].offset : 0;
                              const trueValue = value - offset;

                              return datasetLabel + ': ' + trueValue.toFixed(3);
                            }
                          }
                        }
                      }
                    }}
                  />
                </div>

                {/* Instructions */}
                <div className="mt-3 text-xs text-gray-600 bg-blue-50 p-2 rounded">
                  <strong>Controls:</strong> Drag left/right to scroll • Mouse wheel to zoom in/out •
                  Toggle checkboxes to show/hide signals • Sliders adjust vertical offset for clarity
                </div>
              </div>
            )}
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
