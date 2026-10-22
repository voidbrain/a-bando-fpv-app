import { DRONE_REST_HEIGHT, GRAVITY } from '../constants';
import { clamp } from '../math';
import { Quat, Vec3, eulerYXZ } from '../math3d';
import type { FlightMode } from '../models';
import type { CollisionWorld } from './collider';

export interface DroneState {
  p: Vec3;
  v: Vec3;
  q: Quat;
  /** Heading kept separately so angle mode can level out without losing it. */
  yaw: number;
  armed: boolean;
  mode: FlightMode;
  /** Altitude hold (angle mode, keyboard throttle). */
  hold: boolean;
}

/** Pilot command: sticks in -1..1; `throttle` is -1..1 (spring) or 0..1 (absolute collective). */
export interface PilotInput {
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
  /** True when the sticks come from a radio / gamepad (expo and rates apply). */
  gamepad: boolean;
  /** Throttle stick springs back to centre (gamepad) instead of holding an absolute collective. */
  spring: boolean;
}

export interface ControlSettings {
  /** Acro rotation rate at full stick, degrees/s (gamepad). */
  rate: number;
  expo: number;
}

export interface StepResult {
  crashed: boolean;
  /** Commanded thrust as a fraction of hover-ish scale (0..1), logged as "throttle". */
  throttle: number;
}

export const WORLD_LIMITS = { x: 250, z: 220, y: 120 } as const;
/** Impact speeds above which touching something counts as a crash, m/s. */
const WALL_CRASH_SPEED = 6;
const GROUND_CRASH_SPEED = 8;
const DRAG = 0.45;

/** The take-off spot in the active site's model frame (site metres, unscaled). */
export interface TakeoffSpot {
  x: number;
  z: number;
  /** Ground height of the pad (default 0). */
  y?: number;
}

export function createDroneState(modelScale = 1, takeoff: TakeoffSpot = { x: 0, z: 0 }): DroneState {
  const d: DroneState = {
    p: new Vec3(),
    v: new Vec3(),
    q: new Quat(),
    yaw: 0,
    armed: false,
    mode: 'angle',
    hold: true,
  };
  resetDroneState(d, modelScale, takeoff);
  return d;
}

/** Back to the take-off pad of the current site, disarmed. */
export function resetDroneState(d: DroneState, modelScale: number, takeoff: TakeoffSpot = { x: 0, z: 0 }): void {
  d.armed = false;
  d.p.set(takeoff.x * modelScale, (takeoff.y ?? 0) * modelScale + DRONE_REST_HEIGHT, takeoff.z * modelScale);
  d.v.set(0, 0, 0);
  d.yaw = -Math.PI / 2;
  d.q.setFromEuler(0, d.yaw, 0, 'YXZ');
}

/** Stick response: dead zone then blend of linear and cubic. */
export function applyExpo(v: number, expo: number): number {
  const a = Math.abs(v) < 0.03 ? 0 : v;
  return (1 - expo) * a + expo * a * a * a;
}

/** Fly one physics step: attitude (angle or acro), thrust, drag, gravity, collisions and the ground. */
export function stepDrone(d: DroneState, dt: number, input: PilotInput, cfg: ControlSettings, world: CollisionWorld | null): StepResult {
  const F = (v: number): number => (input.gamepad ? applyExpo(v, cfg.expo) : v);
  const rate = (cfg.rate * Math.PI) / 180;
  const tilt = input.gamepad ? 0.8 : 0.62;
  const target = new Quat();

  if (d.mode === 'angle') {
    d.yaw -= F(input.yaw) * 2.4 * dt;
    d.q.slerp(target.setFromEuler(-F(input.pitch) * tilt, d.yaw, -F(input.roll) * tilt, 'YXZ'), 1 - Math.exp(-dt * 14));
  } else {
    d.q
      .multiply(
        target.setFromEuler(
          -F(input.pitch) * (input.gamepad ? rate : 4) * dt,
          -F(input.yaw) * (input.gamepad ? rate * 0.8 : 3) * dt,
          -F(input.roll) * (input.gamepad ? rate : 4.5) * dt,
          'YXZ',
        ),
      )
      .normalize();
  }

  const ground = world?.groundAt?.(d.p.x, d.p.z, d.p.y) ?? 0;
  // On the ground the drone levels itself and keeps its heading.
  if (!d.armed && d.p.y < ground + 0.1) {
    d.yaw = eulerYXZ(d.q).y;
    d.q.slerp(target.setFromEuler(0, d.yaw, 0, 'YXZ'), 0.2);
  }

  const up = new Vec3(0, 1, 0).applyQuat(d.q);
  let thrust = 0;
  if (d.armed) {
    thrust =
      input.gamepad && !input.spring
        ? input.throttle * GRAVITY * 4.5
        : GRAVITY / Math.max(0.4, up.y) + input.throttle * 12 - (d.hold && !input.throttle ? d.v.y * 4 : 0);
  }
  const accel = up.scale(thrust).add(new Vec3(0, -GRAVITY, 0)).addScaled(d.v, -DRAG);
  d.v.addScaled(accel, dt);

  let crashed = false;
  for (const axis of ['x', 'y', 'z'] as const) {
    const next = d.p.clone();
    next[axis] += d.v[axis] * dt;
    if (world?.hit(next)) {
      if (Math.abs(d.v[axis]) > WALL_CRASH_SPEED) crashed = true;
      d.v[axis] *= -0.2;
      d.v.scale(0.9);
    } else {
      d.p[axis] = next[axis];
    }
  }
  // water: touching the surface ends the flight (it floats there, stopped)
  const water = world?.waterAt?.(d.p.x, d.p.z) ?? null;
  if (water !== null && d.p.y < water + 0.05) {
    crashed = true;
    d.p.y = water + 0.05;
    d.v.set(0, 0, 0);
  }
  const floor = (world?.groundAt?.(d.p.x, d.p.z, d.p.y) ?? 0) + DRONE_REST_HEIGHT;
  if (d.p.y < floor) {
    d.p.y = floor;
    if (d.v.y < -GROUND_CRASH_SPEED) crashed = true;
    if (d.v.y < 0) d.v.y = 0;
    d.v.x *= 0.9;
    d.v.z *= 0.9;
  }
  d.p.x = clamp(d.p.x, -WORLD_LIMITS.x, WORLD_LIMITS.x);
  d.p.z = clamp(d.p.z, -WORLD_LIMITS.z, WORLD_LIMITS.z);
  d.p.y = Math.min(WORLD_LIMITS.y, d.p.y);
  return { crashed, throttle: thrust / (2 * GRAVITY) };
}

export function toggleMode(d: DroneState): FlightMode {
  d.mode = d.mode === 'angle' ? 'acro' : 'angle';
  d.yaw = eulerYXZ(d.q).y;
  return d.mode;
}
