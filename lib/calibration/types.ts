// lib/calibration/types.ts
// Type definitions for calibration system

export interface Vector3D {
  x: number;
  y: number;
  z: number;
  timestamp?: number;
}

export interface GPSData {
  mph: number;
  kph: number;
  mps: number;
  lat: number;
  lng: number;
  timestamp: number;
}

export interface RoadDANSegment {
  geohash8: string;
  lat: number;
  lng: number;
  roadDAN: number;
  timestamp: number;
  speedMph: number;
}

export interface SessionDetail {
  sessionId: string;
  startTime: number;
  endTime?: number;
  status: string;
  accelerometerData: Vector3D[];
  gyroscopeData: Vector3D[];
  magnetometerData: Vector3D[];
  gpsData: GPSData[];
}

export interface CalibrationResult {
  transformed: Vector3D[];
  gravityHistory: Vector3D[];
  forwardHistory: Vector3D[];
  forwardChangeRate: number[];
  confidence: number[];
  gpsAccelDetected: boolean[];
  turningDetected: boolean[];
  forwardUpdateCount: number[];
  virtualForwardAccel: number[];
  virtualLateralAccel: number[];
  actualSampleRate: number;
  phoneStable: boolean[];
  vehicleStationary: boolean[];
  vehicleMoving: boolean[];
  magHeading: number[];
  gpsSpeedRaw: number[];
  gpsSpeedSmoothed: number[];
  gpsSpeedFiltered: number[];
  rawGPSAccel: number[];
  gpsDeltaTime: number[];
  gpsTimestamp: number[];
  accelLinearX_measured: number[];
  accelLinearY_measured: number[];
  accelLinearZ_measured: number[];
  accelY_measured: number[];
  accelY_fromGyro: number[];
  accelY_fromMag: number[];
  gyroZ_measured: number[];
  gyroZ_fromAccel: number[];
  gyroZ_fromMag: number[];
  heading_measured: number[];
  heading_fromAccel: number[];
  heading_fromGyro: number[];
  accelFilteredX: number[];
  accelFilteredY: number[];
  accelFilteredZ: number[];
  gyroFilteredX: number[];
  gyroFilteredY: number[];
  gyroFilteredZ: number[];
  gravityUpdating: boolean[];
  xPrimeFiltered: number[];
  yPrimeFiltered: number[];
  zPrimeFiltered: number[];
  danX: number[];
  roadDAN: number[];
  roadDANSegments: RoadDANSegment[];
}

export interface SignalControl {
  visible: boolean;
  offset: number;
  color: string;
  width?: number;
  yAxisID?: string;
  label?: string;
}

export type SignalControls = Record<string, SignalControl>;
