import type { FlightMode } from '../models';
import type { PilotInput } from '../sim/drone-physics';

export interface AxisMap {
  /** Gamepad axis index, -1 = unassigned. */
  a: number;
  inv: boolean;
}

export interface RadioMapping {
  roll: AxisMap;
  pitch: AxisMap;
  thr: AxisMap;
  yaw: AxisMap;
  arm: AxisMap;
  mode: AxisMap;
  /** Throttle stick springs back to centre (a gamepad) rather than staying where you leave it (a radio). */
  spring: boolean;
  /** Acro rate at full stick, deg/s. */
  rate: number;
  expo: number;
}

export type MappingPreset = 'radio' | 'gamepad';

export const RADIO_PRESETS: Record<MappingPreset, () => RadioMapping> = {
  /** RadioMaster Zorro (EdgeTX USB joystick): AETR on axes 0..3, SA = arm on axis 4. */
  radio: () => ({
    roll: { a: 0, inv: false },
    pitch: { a: 1, inv: true },
    thr: { a: 2, inv: false },
    yaw: { a: 3, inv: false },
    arm: { a: 4, inv: false },
    mode: { a: -1, inv: false },
    spring: false,
    rate: 500,
    expo: 0.3,
  }),
  /** Standard game controller: left stick = throttle/yaw, right stick = pitch/roll. */
  gamepad: () => ({
    roll: { a: 2, inv: false },
    pitch: { a: 3, inv: true },
    thr: { a: 1, inv: true },
    yaw: { a: 0, inv: false },
    arm: { a: -1, inv: false },
    mode: { a: -1, inv: false },
    spring: true,
    rate: 400,
    expo: 0.3,
  }),
};

/** The subset of the browser Gamepad the mapping needs (also keeps tests free of DOM types). */
export interface PadLike {
  readonly id: string;
  readonly axes: readonly number[];
}

/** Prefer a radio transmitter by name; otherwise any device with at least four axes. */
export function pickGamepad<T extends PadLike>(pads: readonly (T | null)[]): T | null {
  const list = pads.filter((g): g is T => !!g);
  return list.find((g) => /zorro|radiomaster|edgetx|opentx/i.test(g.id)) ?? list.find((g) => g.axes.length >= 4) ?? null;
}

export function axisValue(pad: PadLike, m: AxisMap): number {
  if (m.a < 0 || m.a >= pad.axes.length) return 0;
  const v = pad.axes[m.a] as number;
  return m.inv ? -v : v;
}

/** Keyboard keys currently held, by KeyboardEvent.code. */
export type HeldKeys = Readonly<Record<string, boolean | undefined>>;

export interface RadioReading extends PilotInput {
  /** Arm switch position, null when no axis is assigned (or no pad). */
  armSwitch: boolean | null;
  modeSwitch: boolean | null;
}

/** Read the pilot command from a gamepad (when present) or the keyboard (WASD + QE + arrows/space). */
export function readPilotInput(keys: HeldKeys, pad: PadLike | null, map: RadioMapping): RadioReading {
  const k = (c: string): number => (keys[c] ? 1 : 0);
  const out: RadioReading = {
    roll: k('KeyD') - k('KeyA'),
    pitch: k('KeyW') - k('KeyS'),
    yaw: k('KeyE') - k('KeyQ'),
    throttle: Math.max(k('ArrowUp'), k('Space')) - Math.max(k('ArrowDown'), k('ShiftLeft'), k('ShiftRight')),
    gamepad: false,
    spring: false,
    armSwitch: null,
    modeSwitch: null,
  };
  if (!pad) return out;
  out.gamepad = true;
  out.roll = axisValue(pad, map.roll);
  out.pitch = axisValue(pad, map.pitch);
  out.yaw = axisValue(pad, map.yaw);
  const t = axisValue(pad, map.thr);
  out.spring = map.spring;
  out.throttle = map.spring ? t : (t + 1) / 2;
  if (map.arm.a >= 0) out.armSwitch = axisValue(pad, map.arm) > 0.3;
  if (map.mode.a >= 0) out.modeSwitch = axisValue(pad, map.mode) > 0.3;
  return out;
}

export interface SwitchActions {
  arm?: boolean;
  mode?: FlightMode;
  /** The arm switch was flipped with throttle up: refused for safety. */
  armRefused?: boolean;
}

/** Turns switch *positions* into *edges*: the first reading only records the position, so connecting never arms. */
export class SwitchTracker {
  private arm: boolean | null = null;
  private mode: boolean | null = null;

  reset(): void {
    this.arm = this.mode = null;
  }

  update(r: RadioReading): SwitchActions {
    const actions: SwitchActions = {};
    if (!r.gamepad) {
      this.reset();
      return actions;
    }
    if (r.armSwitch !== null) {
      if (this.arm === null) this.arm = r.armSwitch;
      else if (r.armSwitch !== this.arm) {
        this.arm = r.armSwitch;
        if (r.armSwitch) {
          if (!r.spring && r.throttle > 0.12) actions.armRefused = true;
          else actions.arm = true;
        } else actions.arm = false;
      }
    }
    if (r.modeSwitch !== null && (this.mode === null || r.modeSwitch !== this.mode)) {
      this.mode = r.modeSwitch;
      actions.mode = r.modeSwitch ? 'acro' : 'angle';
    }
    return actions;
  }
}
