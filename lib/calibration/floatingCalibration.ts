// lib/calibration/floatingCalibration.ts
// Main calibration algorithm - transforms phone sensor data to vehicle coordinates

import ngeohash from 'ngeohash';
import { Vector3D, GPSData, CalibrationResult, RoadDANSegment } from './types';

// Helper function for GPS interpolation
function interpolateGPSData(gpsData: GPSData[], targetLength: number): GPSData[] {
  if (gpsData.length === 0) {
    return Array(targetLength).fill({ mph: 0, kph: 0, mps: 0, lat: 0, lng: 0, timestamp: 0 });
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
        lat: prevGPS.lat + (nextGPS.lat - prevGPS.lat) * ratio,
        lng: prevGPS.lng + (nextGPS.lng - prevGPS.lng) * ratio,
        timestamp: i
      });
    }
  }
  return interpolated;
}

export function applyFloatingCalibration(
  accelData: Vector3D[],
  gyroData: Vector3D[],
  magData: Vector3D[],
  gpsData: GPSData[],
  alpha: number = 0.95,
  observerAlpha: number = 0.05,
  filterAlpha: number = 0.05,
  gpsSpeedAlpha: number = 0.95,
  danDecay: number = 0.95
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
    gyroFilteredZ: [],
    gravityUpdating: [],
    xPrimeFiltered: [],
    yPrimeFiltered: [],
    zPrimeFiltered: [],
    danX: [],
    roadDAN: [],
    roadDANSegments: [],
    donX: [],
    roadDON: [],
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
      lat: gpsData[i].lat,
      lng: gpsData[i].lng,
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
      lat: gpsData[i].lat,
      lng: gpsData[i].lng,
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

    // === STEP 1: DETECT GPS ACCELERATION (used for both gravity and forward learning) ===
    const virtualForwardAccel = interpolatedRawGPSAccel[i];
    const significantAccel = Math.abs(virtualForwardAccel) > 0.2;

    // === STEP 2: GRAVITY TRACKING (only when not accelerating) ===
    // Skip gravity update during acceleration to prevent contamination
    if (!significantAccel) {
      gravity.x = alpha * gravity.x + (1 - alpha) * accelFilteredX;
      gravity.y = alpha * gravity.y + (1 - alpha) * accelFilteredY;
      gravity.z = alpha * gravity.z + (1 - alpha) * accelFilteredZ;
    }
    result.gravityUpdating.push(!significantAccel);

    // === STEP 3: REMOVE GRAVITY FIRST (from raw data) ===
    const linearAccel = {
      x: accel.x - gravity.x,
      y: accel.y - gravity.y,
      z: accel.z - gravity.z
    };

    // === STEP 4: FILTER THE LINEAR ACCELERATION (gravity already removed) ===
    // This is the KEY FIX: filter the linear accel, not the raw accel!
    filteredLinearAccelX = observerAlpha * linearAccel.x + (1 - observerAlpha) * filteredLinearAccelX;
    filteredLinearAccelY = observerAlpha * linearAccel.y + (1 - observerAlpha) * filteredLinearAccelY;
    filteredLinearAccelZ = observerAlpha * linearAccel.z + (1 - observerAlpha) * filteredLinearAccelZ;

    const filteredLinearAccel = {
      x: filteredLinearAccelX,
      y: filteredLinearAccelY,
      z: filteredLinearAccelZ
    };

    // === STEP 5: FILTER GYRO (unchanged) ===
    filteredGyroX = observerAlpha * gyro.x + (1 - observerAlpha) * filteredGyroX;
    filteredGyroY = observerAlpha * gyro.y + (1 - observerAlpha) * filteredGyroY;
    filteredGyroZ = observerAlpha * gyro.z + (1 - observerAlpha) * filteredGyroZ;

    // === STEP 6: USE CLEAN GPS ACCELERATION ===
    // Use the pre-calculated clean GPS acceleration instead of recalculating
    // This avoids noise from numerical differentiation on interpolated GPS
    const currentSpeed = gps.mps;

    const rotationRate = gyro.z;
    const virtualLateralAccel = currentSpeed * rotationRate;

    result.virtualForwardAccel.push(virtualForwardAccel);
    result.virtualLateralAccel.push(virtualLateralAccel);
    result.gpsSpeedRaw.push(steppedRawGPS[i]);
    result.rawGPSAccel.push(interpolatedRawGPSAccel[i]);
    result.gpsDeltaTime.push(interpolatedGPSDeltaTime[i]);
    result.gpsTimestamp.push(interpolatedGPSTimestamp[i]);

    // === STEP 7: CROSS-VERIFICATION TRIFECTA (using FILTERED signals) ===
    // Each sensor verified by the other two
    // Note: currentSpeed and rotationRate already defined above

    // Get magnetometer heading (magData.x is already compass heading 0-360° from useSensors)
    const magIndex = Math.min(i, magData.length - 1);
    const mag = magData[magIndex] || { x: 0, y: 0, z: 0 };
    const rawMagHeading = (mag.x * Math.PI) / 180; // Convert degrees to radians
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
    // Get magnetometer sample (magIndex defined in STEP 7)
    // Note: magSample.x IS the compass heading (0-360°) from webkitCompassHeading (iOS)
    // or event.alpha (other browsers) - no calculation needed!
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
    // Debug: Log first few samples to verify values
    if (i < 5 || i === magData.length - 1) {
      console.log(`magHeading LOOP [i=${i}]:`, {
        'magSample.x': magSample.x.toFixed(1),
        'magHeadingDeg': magHeadingDeg.toFixed(1),
        'magHeadingUnwrapped': magHeadingUnwrapped.toFixed(1),
        'stored (÷10)': (magHeadingUnwrapped / 10).toFixed(2)
      });
    }
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

    // === STEP 8: FORWARD DIRECTION LEARNING (Normalized) ===
    // Use GPS-based acceleration for forward learning (significantAccel defined in STEP 1)
    if (significantAccel) {
      // Accumulate the linear acceleration direction
      // During braking (negative gpsAccel), flip the sign since accel points backward
      const sign = virtualForwardAccel > 0 ? 1 : -1;
      forward.x = alpha * forward.x + (1 - alpha) * linearAccel.x * sign;
      forward.y = alpha * forward.y + (1 - alpha) * linearAccel.y * sign;
      forward.z = alpha * forward.z + (1 - alpha) * linearAccel.z * sign;

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

    // === STEP 9: ORTHOGONALIZE FUSED FORWARD ===
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

    // === STEP 10: CALCULATE CONFIDENCE ===
    const gravityMagnitude = gravityMag;
    const forwardMagnitude = Math.sqrt(forward.x**2 + forward.y**2 + forward.z**2);

    const gravityConfidence = Math.min(1, gravityMagnitude / 9.8);
    const forwardConfidence = Math.min(1, forwardMagnitude / 0.5);

    const confidence = (gravityConfidence + forwardConfidence) / 2;

    // === STEP 11: TRANSFORM TO VEHICLE COORDINATES ===
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

    // Apply EMA filter to transformed vehicle coordinates
    if (i === 0) {
      result.xPrimeFiltered.push(transformed.x);
      result.yPrimeFiltered.push(transformed.y);
      result.zPrimeFiltered.push(transformed.z);
    } else {
      const prevX = result.xPrimeFiltered[i - 1];
      const prevY = result.yPrimeFiltered[i - 1];
      const prevZ = result.zPrimeFiltered[i - 1];
      result.xPrimeFiltered.push(alpha * prevX + (1 - alpha) * transformed.x);
      result.yPrimeFiltered.push(alpha * prevY + (1 - alpha) * transformed.y);
      result.zPrimeFiltered.push(alpha * prevZ + (1 - alpha) * transformed.z);
    }

    // DAN (Delta Acceleration Noise) - combined 3-axis RMS road roughness
    // Measures deviation from filtered signal across all axes
    const devX = accel.x - accelFilteredX;
    const devY = accel.y - accelFilteredY;
    const devZ = accel.z - accelFilteredZ;
    const deviationMagnitude = Math.sqrt(devX * devX + devY * devY + devZ * devZ);
    const deviationSquared = deviationMagnitude * deviationMagnitude;
    if (i === 0) {
      result.danX.push(Math.sqrt(deviationSquared));
    } else {
      const prevDAN = result.danX[i - 1];
      const smoothedSquare = danDecay * (prevDAN * prevDAN) + (1 - danDecay) * deviationSquared;
      result.danX.push(Math.sqrt(smoothedSquare));
    }

    // RoadDAN - 1-second average of DAN aligned with GPS updates (60 samples)
    // This is the segment-level measurement for road roughness mapping
    if (i === 0) {
      (result as any)._danAccumulator = result.danX[0];
      (result as any)._danSampleCount = 1;
      result.roadDAN.push(result.danX[0]);
    } else if (i % 60 === 0) {
      const avgDAN = (result as any)._danAccumulator / (result as any)._danSampleCount;
      result.roadDAN.push(avgDAN);
      // Create a geolocated RoadDAN segment
      const gps = interpolatedGPS[i];
      if (gps.lat !== 0 && gps.lng !== 0) {
        const segment: RoadDANSegment = {
          geohash8: ngeohash.encode(gps.lat, gps.lng, 8),
          lat: gps.lat,
          lng: gps.lng,
          roadDAN: avgDAN,
          timestamp: gps.timestamp,
          speedMph: gps.mph,
        };
        result.roadDANSegments.push(segment);
        console.log('RoadDAN segment:', segment.geohash8, 'DAN:', avgDAN.toFixed(3), 'speed:', gps.mph.toFixed(1), 'mph');
      }
      (result as any)._danAccumulator = 0;
      (result as any)._danSampleCount = 0;
    } else {
      // Accumulate and repeat last value
      (result as any)._danAccumulator += result.danX[i];
      (result as any)._danSampleCount += 1;
      result.roadDAN.push(result.roadDAN[result.roadDAN.length - 1]);
    }

    // DON (Delta Orientation Noise) - gyro-based road roughness
    const gyroDevX = gyroData[i].x - result.gyroFilteredX[i];
    const gyroDevY = gyroData[i].y - result.gyroFilteredY[i];
    const gyroDevZ = gyroData[i].z - result.gyroFilteredZ[i];
    const gyroDeviationMagnitude = Math.sqrt(gyroDevX * gyroDevX + gyroDevY * gyroDevY + gyroDevZ * gyroDevZ);
    const gyroDeviationSquared = gyroDeviationMagnitude * gyroDeviationMagnitude;

    const donDecay = 0.95;
    if (i === 0) {
      result.donX.push(Math.sqrt(gyroDeviationSquared));
    } else {
      const prevDON = result.donX[i - 1];
      const smoothedSquare = donDecay * (prevDON * prevDON) + (1 - donDecay) * gyroDeviationSquared;
      result.donX.push(Math.sqrt(smoothedSquare));
    }

    // RoadDON - 1-second average
    if (i === 0) {
      (result as any)._donAccumulator = result.donX[0];
      (result as any)._donSampleCount = 1;
      result.roadDON.push(result.donX[0]);
    } else if (i % 60 === 0) {
      const avgDON = (result as any)._donAccumulator / (result as any)._donSampleCount;
      result.roadDON.push(avgDON);
      (result as any)._donAccumulator = 0;
      (result as any)._donSampleCount = 0;
    } else {
      (result as any)._donAccumulator += result.donX[i];
      (result as any)._donSampleCount += 1;
      result.roadDON.push(result.roadDON[result.roadDON.length - 1]);
    }

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
