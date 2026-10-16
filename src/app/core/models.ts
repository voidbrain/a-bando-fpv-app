import type { Vec3 } from './math3d';

/** Geodetic position of the model: how local metres relate to latitude / longitude. */
export interface Calibration {
  /** Rotation of the model's axes against true north, degrees. */
  rot: number;
  /** Shift of the geographic origin inside the model, metres. */
  dx: number;
  dz: number;
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface GeoSample extends GeoPoint {
  alt: number;
  /** Seconds from the start of the log. */
  t: number;
}

/** Decimated Blackbox telemetry, ~100 Hz. Times are seconds relative to the first GPS sample. */
export interface Telemetry {
  t: Float32Array;
  /** roll, pitch, yaw (radians, Betaflight convention: pitch positive = nose down). */
  att: Float32Array;
  /** rcCommand roll, pitch, yaw (+-500) and throttle (1000..2000). */
  rc: Float32Array;
  /** motor outputs 1..4 (48..2047). */
  mot: Float32Array;
  /** gyro roll, pitch, yaw (deg/s). */
  gyro: Float32Array;
  vbat: Float32Array;
  /** Radians to add to the IMU yaw to obtain a geographic heading (the IMU yaw has an arbitrary zero). */
  yawOff: number;
}

/** Attitude received over the live link (radians; hdg = geographic heading while moving). */
export interface LiveAttitude {
  roll: number;
  pitch: number;
  hdg: number;
}

export interface Flight {
  readonly id: string;
  name: string;
  pts: GeoSample[];
  tel: Telemetry | null;
  live: boolean;
  att: LiveAttitude | null;
  /** Local model coordinates (x east-ish, y altitude above the lowest point, z south-ish). */
  loc: Vec3[];
  /** Smoothed speed per point, m/s. */
  spd: number[];
  dur: number;
  /** Replay cursor cache (index of the segment the playhead is in). */
  cursor: number;
  /** Cached analysis results; undefined = not computed yet. */
  liftoff?: number | null;
  firstFlip?: number | null;
}

export interface FlipEvent {
  /** Middle of the move: the drone is upside down. */
  t: number;
  start: number;
  end: number;
  kind: 'roll' | 'flip';
  deg: number;
}

export type MainSource = '3d' | 'video';
export type CameraView = 'orbit' | 'chase' | 'fpv' | 'top';
export type FlightMode = 'angle' | 'acro';
