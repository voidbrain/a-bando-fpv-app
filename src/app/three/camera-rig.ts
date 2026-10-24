import * as THREE from 'three';
import { clamp } from '../core/math';
import type { Quat, Vec3 } from '../core/math3d';
import type { CameraView } from '../core/models';

/** Orbit / top camera state. */
export interface OrbitState {
  tg: THREE.Vector3;
  /** Azimuth, polar angle (from straight up) and distance. */
  th: number;
  ph: number;
  rad: number;
  /** The user panned away: stop following the drone until the view is recentred (double-click / reset). */
  manual?: boolean;
}

export const DEFAULT_FOV = 60;
export const FPV_FOV = 100;
export const RAD_MIN = 8;
export const RAD_MAX = 520;
export const createOrbitState = (view: CameraView | 'default' = 'default'): OrbitState =>
  view === 'top' ? { tg: new THREE.Vector3(0, 0, 0), th: -1.1, ph: 1, rad: 260 } : { tg: new THREE.Vector3(-10, 2, 0), th: -1.1, ph: 1, rad: 330 };

export const fovFor = (view: CameraView): number => (view === 'fpv' ? FPV_FOV : DEFAULT_FOV);

export interface FollowSubject {
  p: Vec3;
  q: Quat;
}

export interface PlaceOptions {
  /** Orbit / top views auto-pan to keep the drone centred. */
  orbitFollow: boolean;
  /** Rotation of the model against true north, degrees (the top view is north-up). */
  calRotDeg: number;
  /** FPV up-tilt in degrees; 0 for GPS-only replays (their orientation has no real camera angle to correct). */
  fpvTiltDeg: number;
}

const tiltQ = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

/** Position and aim camera `c` for `view` following `f`. `dt` drives the smooth follow. */
export function placeCamera(c: THREE.PerspectiveCamera, view: CameraView, st: OrbitState, f: FollowSubject, o: PlaceOptions, dt: number): void {
  c.up.set(0, 1, 0);
  if (o.orbitFollow && !st.manual && (view === 'orbit' || view === 'top')) {
    const k = 1 - Math.exp(-dt * 5);
    st.tg.x += (f.p.x - st.tg.x) * k;
    st.tg.z += (f.p.z - st.tg.z) * k;
    st.tg.y += (f.p.y - st.tg.y) * k;
  }
  if (view === 'orbit') {
    c.position.set(st.tg.x + st.rad * Math.sin(st.ph) * Math.sin(st.th), st.tg.y + st.rad * Math.cos(st.ph), st.tg.z + st.rad * Math.sin(st.ph) * Math.cos(st.th));
    c.lookAt(st.tg);
  } else if (view === 'top') {
    const a = (o.calRotDeg * Math.PI) / 180;
    c.up.set(Math.sin(a), 0, -Math.cos(a)); // straight down, true north up
    c.position.set(st.tg.x, st.rad, st.tg.z);
    c.lookAt(st.tg.x, 0, st.tg.z);
  } else if (view === 'fpv') {
    tmpQ.set(f.q.x, f.q.y, f.q.z, f.q.w);
    c.position.set(f.p.x, f.p.y, f.p.z).add(tmpV.set(0, 0.03, -0.07).applyQuaternion(tmpQ));
    c.quaternion.copy(tmpQ);
    if (o.fpvTiltDeg) c.quaternion.multiply(tiltQ.setFromAxisAngle(X_AXIS, (o.fpvTiltDeg * Math.PI) / 180));
  } else {
    tmpQ.set(f.q.x, f.q.y, f.q.z, f.q.w);
    const yaw = tmpE.setFromQuaternion(tmpQ, 'YXZ').y;
    const want = new THREE.Vector3(f.p.x + Math.sin(yaw) * 6, f.p.y + 2.5, f.p.z + Math.cos(yaw) * 6);
    c.position.lerp(want, 1 - Math.exp(-dt * 5));
    c.lookAt(f.p.x, f.p.y + 0.5, f.p.z);
  }
}

/**
 * Set an orbit about `target` that puts the camera exactly at `cam`: leaving the chase camera for the orbit (to look
 * around the drone) starts from the very same view, no jump.
 */
export function orbitFromCamera(st: OrbitState, cam: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }): void {
  const dx = cam.x - target.x, dy = cam.y - target.y, dz = cam.z - target.z;
  const r = Math.hypot(dx, dy, dz) || RAD_MIN;
  st.tg.set(target.x, target.y, target.z);
  st.rad = clamp(r, RAD_MIN, RAD_MAX);
  st.ph = clamp(Math.acos(clamp(dy / r, -1, 1)), 0.1, 1.5);
  st.th = Math.atan2(dx, dz);
  st.manual = false;
}

/** Left-drag: turn around the target (orbit view). */
export function orbitRotate(st: OrbitState, dx: number, dy: number): void {
  st.th -= dx * 0.006;
  st.ph = clamp(st.ph + dy * 0.005, 0.1, 1.5);
}

/** Right-drag / shift-drag / any drag in the top view: slide the target over the ground, in screen directions. */
export function orbitPan(st: OrbitState, dx: number, dy: number, view: CameraView, calRotDeg: number): void {
  st.manual = true; // a pan means "look over there": the follow would pull the view straight back otherwise
  const k = st.rad * 0.0016;
  const t = view === 'top' ? (-calRotDeg * Math.PI) / 180 : st.th;
  st.tg.x += -dx * k * Math.cos(t) - dy * k * Math.sin(t);
  st.tg.z += dx * k * Math.sin(t) - dy * k * Math.cos(t);
}

export function orbitZoom(st: OrbitState, wheelDeltaY: number): void {
  st.rad = clamp(st.rad * (1 + wheelDeltaY * 0.001), RAD_MIN, RAD_MAX);
}

/** Two-finger pinch: `previous` / `current` are the finger distances. */
export function orbitPinch(st: OrbitState, previous: number, current: number): void {
  if (previous && current) st.rad = clamp((st.rad * previous) / current, RAD_MIN, RAD_MAX);
}
