import type { FlipEvent, Flight, Telemetry } from '../models';

/** Motor output range of Betaflight blackbox logs (DShot: 48 = idle, 2047 = full). */
const MOTOR_MIN = 48;
const MOTOR_SPAN = 1999;

/**
 * Lift-off time (log seconds): the first moment all motors reach ~75 % of the way from idle to hover power.
 * Falls back to the first GPS speed / height change when the log has no telemetry. Null when nothing qualifies.
 */
export function findLiftoff(f: Flight): number | null {
  const T = f.tel;
  if (T) {
    const n = T.t.length;
    const pct = (i: number): number => ((T.mot[i * 4]! + T.mot[i * 4 + 1]! + T.mot[i * 4 + 2]! + T.mot[i * 4 + 3]!) / 4 - MOTOR_MIN) / MOTOR_SPAN;
    const sm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      let c = 0;
      for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
        s += pct(j);
        c++;
      }
      sm[i] = s / c;
    }
    const idle: number[] = [];
    const flying: number[] = [];
    for (let i = 0; i < n; i++) {
      if (T.t[i]! < 0.5) idle.push(sm[i]!);
      if (sm[i]! > 0.15) flying.push(sm[i]!);
    }
    if (idle.length && flying.length > 20) {
      idle.sort((a, b) => a - b);
      flying.sort((a, b) => a - b);
      const idleLevel = idle[idle.length >> 1]!;
      const hover = flying[flying.length >> 1]!;
      const thr = idleLevel + 0.75 * (hover - idleLevel);
      if (sm[0]! < thr) {
        for (let i = 1; i < n - 3; i++) if (sm[i]! >= thr && sm[i + 1]! >= thr && sm[i + 3]! >= thr) return T.t[i]!;
      }
    }
  }
  if (f.loc.length && f.spd.length) {
    for (let i = 1; i < f.loc.length; i++) {
      if ((f.spd[i]! > 2 && f.spd[i]! < 150) || f.loc[i]!.y > f.loc[0]!.y + 1.5) return f.pts[i]!.t - f.pts[0]!.t;
    }
  }
  return null;
}

/**
 * Flips and rolls in the first 25 s of flight (integrated roll / pitch angle >= 300 deg inside 1.4 s).
 * `t` is the middle of the move, when the drone is upside down: an unmistakable landmark in both log and video.
 */
export function findFlips(f: Flight): FlipEvent[] {
  const T = f.tel;
  if (!T) return [];
  const n = T.t.length;
  if (n < 20) return [];
  const lift = findLiftoff(f) ?? 0;
  const C = [new Float64Array(n), new Float64Array(n)] as const;
  for (let i = 1; i < n; i++) {
    const dt = T.t[i]! - T.t[i - 1]!;
    C[0][i] = C[0][i - 1]! + T.gyro[i * 3]! * dt;
    C[1][i] = C[1][i - 1]! + T.gyro[i * 3 + 1]! * dt;
  }
  const events: FlipEvent[] = [];
  let i = 0;
  while (i < n && T.t[i]! < lift) i++;
  while (i < n && T.t[i]! <= lift + 25) {
    let hit: 0 | 1 | null = null;
    for (const axis of [0, 1] as const) {
      if (hit !== null) break;
      let j = i;
      while (j < n - 1 && T.t[j]! - T.t[i]! < 1.4) j++;
      if (Math.abs(C[axis][j]! - C[axis][i]!) >= 300) hit = axis;
    }
    if (hit === null) {
      i++;
      continue;
    }
    const acc = C[hit];
    const rate = (k: number): number => Math.abs(T.gyro[k * 3 + hit!]!);
    let s = i;
    while (s < n - 1 && rate(s) < 100) s++;
    let c = s;
    while (c < n - 1 && Math.abs(acc[c]! - acc[s]!) < 180) c++;
    let e = c;
    while (e < n - 1 && Math.abs(acc[e]! - acc[s]!) < 330 && T.t[e]! - T.t[s]! < 2) e++;
    events.push({ t: T.t[c]!, start: T.t[s]!, end: T.t[e]!, kind: hit === 1 ? 'flip' : 'roll', deg: Math.abs(acc[e]! - acc[s]!) });
    i = e + 1;
  }
  return events;
}

/** First sharp yaw flick after lift-off (the recommended "sync flick"): an exact manual anchor. */
export function findFirstYawFlick(f: Flight): number | null {
  const T: Telemetry | null = f.tel;
  if (!T) return null;
  const lift = findLiftoff(f) ?? 0;
  const n = T.t.length;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.abs(T.gyro[i * 3 + 2]!);
  const median = [...a].sort((x, y) => x - y)[n >> 1] || 1;
  const thr = Math.max(180, 4 * median);
  for (let i = 0; i < n; i++) {
    if (T.t[i]! < lift || a[i]! <= thr) continue;
    let j = i;
    while (j > 0 && a[j]! > thr * 0.35) j--;
    return T.t[j]!;
  }
  return null;
}
