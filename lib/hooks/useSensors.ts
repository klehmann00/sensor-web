// lib/hooks/useSensors.ts
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import SensorProcessor from '../processors/SensorProcessor';
import EnhancedSensorProcessor from '../processors/EnhancedSensorProcessor';

interface Vector3D {
  x: number;
  y: number;
  z: number;
}

interface SensorData {
  accelerometer: Vector3D;
  gyroscope: Vector3D;
  magnetometer: Vector3D;
  processedAccel: any;
  processedGyro: any;
  isActive: boolean;
  speed: { mph: number; kph: number; lat: number; lng: number } | null;
}

export const useSensors = () => {
  const [sensorData, setSensorData] = useState<SensorData>({
    accelerometer: { x: 0, y: 0, z: 0 },
    gyroscope: { x: 0, y: 0, z: 0 },
    magnetometer: { x: 0, y: 0, z: 0 },
    processedAccel: null,
    processedGyro: null,
    isActive: false,
    speed: null
  });
  const [permissionGranted, setPermissionGranted] = useState(false);

  // Store cleanup functions to prevent memory leaks
  const motionCleanupRef = useRef<(() => void) | null>(null);
  const orientationCleanupRef = useRef<(() => void) | null>(null);
  const gpsWatchIdRef = useRef<number | null>(null);

  const requestPermission = useCallback(async () => {
    if (typeof window === 'undefined') return false;

    // Check if DeviceMotionEvent exists and has requestPermission
    if (
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof (DeviceMotionEvent as any).requestPermission === 'function'
    ) {
      try {
        const permission = await (DeviceMotionEvent as any).requestPermission();
        const granted = permission === 'granted';
        setPermissionGranted(granted);

        // Also request orientation permission on iOS
        if (granted && typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
          await (DeviceOrientationEvent as any).requestPermission();
        }

        return granted;
      } catch (error) {
        console.error('Permission request failed:', error);
        return false;
      }
    } else {
      // Permission not required (non-iOS or older browser)
      setPermissionGranted(true);
      return true;
    }
  }, []);

  const startSensors = useCallback(async () => {
    // Clean up any existing listeners first
    if (motionCleanupRef.current) {
      motionCleanupRef.current();
      motionCleanupRef.current = null;
    }
    if (orientationCleanupRef.current) {
      orientationCleanupRef.current();
      orientationCleanupRef.current = null;
    }
    if (gpsWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      gpsWatchIdRef.current = null;
    }

    if (!permissionGranted) {
      const granted = await requestPermission();
      if (!granted) return false;
    }

    // Handle device motion (accelerometer + gyroscope)
    const handleMotion = (event: DeviceMotionEvent) => {
      const accel = event.accelerationIncludingGravity;
      const gyro = event.rotationRate;

      if (accel) {
        const accelData = {
          x: accel.x || 0,
          y: accel.y || 0,
          z: accel.z || 0
        };

        const gyroData = gyro
          ? { x: gyro.alpha || 0, y: gyro.beta || 0, z: gyro.gamma || 0 }
          : { x: 0, y: 0, z: 0 };

        const processedAccel = SensorProcessor.processAccelerometerData(accelData);
        const processedGyro = SensorProcessor.processGyroscopeData(gyroData);

        setSensorData(prev => ({
          ...prev,
          accelerometer: accelData,
          gyroscope: gyroData,
          processedAccel,
          processedGyro,
          isActive: true
        }));
      }
    };

    // Handle device orientation (magnetometer/compass)
    const handleOrientation = (event: DeviceOrientationEvent) => {
      // Get absolute compass heading
      // iOS Safari provides webkitCompassHeading (0-360° from magnetic north)
      // Other browsers: event.alpha is absolute only if event.absolute === true
      let compassHeading = event.alpha || 0;

      // iOS: Use webkitCompassHeading if available (always absolute)
      if ((event as any).webkitCompassHeading !== undefined) {
        compassHeading = (event as any).webkitCompassHeading;

        // Debug once: Confirm we're using iOS absolute compass
        if (!(window as any).__compassDebugLogged) {
          const msg = '✅ COMPASS: Using iOS webkitCompassHeading (absolute from magnetic north)';
          console.log(msg);
          alert(msg);
          (window as any).__compassDebugLogged = true;
        }
      }
      // Android/Other: Warn if not absolute
      else if (event.absolute === false) {
        if (!(window as any).__compassDebugLogged) {
          const msg = '⚠️ COMPASS: Relative orientation (NOT compass-referenced). Heading is relative to starting direction.';
          console.warn(msg);
          alert(msg);
          (window as any).__compassDebugLogged = true;
        }
      }
      // Using alpha with absolute=true
      else {
        if (!(window as any).__compassDebugLogged) {
          const msg = '✅ COMPASS: Using event.alpha with absolute=true (compass-referenced)';
          console.log(msg);
          alert(msg);
          (window as any).__compassDebugLogged = true;
        }
      }

      const magnetometerData = {
        x: compassHeading,     // Compass heading (0-360°) from magnetic north
        y: event.beta || 0,    // Front-to-back tilt (-180 to 180°)
        z: event.gamma || 0,   // Left-to-right tilt (-90 to 90°)
      };

      // Debug: Log compass heading every 60 samples (~1 second)
      if (!(window as any).__compassSampleCount) {
        (window as any).__compassSampleCount = 0;
      }
      (window as any).__compassSampleCount++;
      if ((window as any).__compassSampleCount % 60 === 0) {
        console.log('COMPASS DEBUG:', {
          webkitCompassHeading: (event as any).webkitCompassHeading,
          eventAlpha: event.alpha,
          savedHeading: compassHeading,
          absolute: event.absolute
        });
      }

      setSensorData(prev => ({
        ...prev,
        magnetometer: magnetometerData
      }));
    };

    window.addEventListener('devicemotion', handleMotion);
    window.addEventListener('deviceorientation', handleOrientation);

    // Start GPS tracking
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const speedMps = position.coords.speed || 0; // meters per second
          const speedMph = speedMps * 2.23694; // Convert to mph
          const speedKph = speedMps * 3.6;     // Convert to kph

          setSensorData(prev => ({
            ...prev,
            speed: {
              mph: Math.round(speedMph * 10) / 10, // Round to 1 decimal
              kph: Math.round(speedKph * 10) / 10,
              lat: position.coords.latitude,
              lng: position.coords.longitude
            }
          }));
        },
        (error) => {
          console.warn('GPS error:', error.message);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 1000,
          timeout: 5000
        }
      );
      gpsWatchIdRef.current = watchId;
    }

    const motionCleanup = () => {
      window.removeEventListener('devicemotion', handleMotion);
    };

    const orientationCleanup = () => {
      window.removeEventListener('deviceorientation', handleOrientation);
    };

    const gpsCleanup = () => {
      if (gpsWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        gpsWatchIdRef.current = null;
      }
    };

    // Store cleanup functions in refs
    motionCleanupRef.current = motionCleanup;
    orientationCleanupRef.current = orientationCleanup;

    return () => {
      motionCleanup();
      orientationCleanup();
      gpsCleanup();
      setSensorData(prev => ({ ...prev, isActive: false }));
    };
  }, [permissionGranted, requestPermission]);

  const stopSensors = useCallback(() => {
    // Call the cleanup functions to remove event listeners
    if (motionCleanupRef.current) {
      motionCleanupRef.current();
      motionCleanupRef.current = null;
    }
    if (orientationCleanupRef.current) {
      orientationCleanupRef.current();
      orientationCleanupRef.current = null;
    }
    if (gpsWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      gpsWatchIdRef.current = null;
    }
    setSensorData(prev => ({ ...prev, isActive: false }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (motionCleanupRef.current) {
        motionCleanupRef.current();
        motionCleanupRef.current = null;
      }
      if (orientationCleanupRef.current) {
        orientationCleanupRef.current();
        orientationCleanupRef.current = null;
      }
      if (gpsWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        gpsWatchIdRef.current = null;
      }
    };
  }, []);

  return {
    ...sensorData,
    startSensors,
    stopSensors,
    requestPermission,
    permissionGranted
  };
};
