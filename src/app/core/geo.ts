import { METRES_PER_DEG_LAT, siteOrigin } from './constants';
import { RAD, DEG } from './math';
import type { Calibration, GeoPoint } from './models';

/** Metres per degree of longitude at `lat`. */
export const metresPerDegLon = (lat: number): number => 111320 * Math.cos((lat * Math.PI) / 180);

/** Latitude/longitude -> local model metres [x, z], around the given geographic origin. */
export function toLocalAt(origin: GeoPoint, lat: number, lon: number, cal: Calibration): [number, number] {
  const e = (lon - origin.lon) * metresPerDegLon(origin.lat);
  const n = (lat - origin.lat) * METRES_PER_DEG_LAT;
  const a = cal.rot * RAD;
  return [e * Math.cos(a) + n * Math.sin(a) + cal.dx, e * Math.sin(a) - n * Math.cos(a) + cal.dz];
}

/** Local model metres -> [latitude, longitude]. Inverse of {@link toLocalAt}. */
export function toGeoAt(origin: GeoPoint, x: number, z: number, cal: Calibration): [number, number] {
  const a = cal.rot * RAD;
  const X = x - cal.dx;
  const Z = z - cal.dz;
  return [
    origin.lat + (X * Math.sin(a) - Z * Math.cos(a)) / METRES_PER_DEG_LAT,
    origin.lon + (X * Math.cos(a) + Z * Math.sin(a)) / metresPerDegLon(origin.lat),
  ];
}

export interface CalibrationSolution {
  calibration: Calibration;
  /** Distance between the real corner and its model corner after solving (error is split between both corners), metres. */
  cornerError: number;
  /** model distance / real distance between the two corners (1 = the model has the right size). */
  distanceRatio: number;
}

export interface PlanePoint {
  x: number;
  z: number;
}

/**
 * Solve rotation and shift from two real corners (geographic) and the matching model corners (metres).
 * A similarity fit with fixed scale: the rotation comes from the direction between the corners, the shift centres the
 * remaining error between them. Returns null when the corners are too close together to give a stable rotation.
 */
export function solveCalibration(real1: GeoPoint, real2: GeoPoint, model1: PlanePoint, model2: PlanePoint, origin: GeoPoint = siteOrigin()): CalibrationSolution | null {
  const en = (p: GeoPoint): [number, number] => [(p.lon - origin.lon) * metresPerDegLon(origin.lat), (p.lat - origin.lat) * METRES_PER_DEG_LAT];
  const a = en(real1);
  const b = en(real2);
  const de = b[0] - a[0];
  const dn = b[1] - a[1];
  const dx = model2.x - model1.x;
  const dz = model2.z - model1.z;
  if (Math.hypot(de, dn) < 20) return null;
  let rot = Math.atan2(dz, dx) - Math.atan2(-dn, de);
  rot = ((((rot + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const rotate = (e: [number, number]): [number, number] => [e[0] * c + e[1] * s, e[0] * s - e[1] * c];
  const l1 = rotate(a);
  const l2 = rotate(b);
  const calibration: Calibration = {
    rot: rot * DEG,
    dx: (model1.x - l1[0] + (model2.x - l2[0])) / 2,
    dz: (model1.z - l1[1] + (model2.z - l2[1])) / 2,
  };
  const cornerError = Math.hypot(model1.x - l1[0] - calibration.dx, model1.z - l1[1] - calibration.dz);
  return { calibration, cornerError, distanceRatio: Math.hypot(dx, dz) / Math.hypot(de, dn) };
}

/** Local velocity (model axes) -> geographic course in degrees [0, 360). */
export function courseDegrees(vx: number, vz: number, cal: Calibration): number {
  const a = cal.rot * RAD;
  const east = vx * Math.cos(a) + vz * Math.sin(a);
  const north = vx * Math.sin(a) - vz * Math.cos(a);
  return (Math.atan2(east, north) * DEG + 360) % 360;
}

// ---- origin-aware shorthands: they read the *active* site origin (core/constants -> siteOrigin) ----

/** {@link toLocalAt} with the active site origin. */
export function toLocal(lat: number, lon: number, cal: Calibration): [number, number] {
  return toLocalAt(siteOrigin(), lat, lon, cal);
}

/** {@link toGeoAt} with the active site origin. */
export function toGeo(x: number, z: number, cal: Calibration): [number, number] {
  return toGeoAt(siteOrigin(), x, z, cal);
}

/**
 * The calibration that turns everything it places by `deg` about `pivot` (model metres): the logged path pivots on a
 * point that must not move (its pinned start) while its other end is aimed somewhere else.
 */
export function rotateCalibrationAbout(cal: Calibration, pivot: { x: number; z: number }, deg: number): Calibration {
  const a = deg * RAD, c = Math.cos(a), s = Math.sin(a);
  const ox = cal.dx - pivot.x, oz = cal.dz - pivot.z;
  return { rot: cal.rot + deg, dx: pivot.x + ox * c - oz * s, dz: pivot.z + ox * s + oz * c };
}

/** The turn (degrees) that aims the line from `pivot` through `from` at `to`, about the vertical. */
export function turnTowards(pivot: { x: number; z: number }, from: { x: number; z: number }, to: { x: number; z: number }): number {
  return (Math.atan2(to.z - pivot.z, to.x - pivot.x) - Math.atan2(from.z - pivot.z, from.x - pivot.x)) * DEG;
}
