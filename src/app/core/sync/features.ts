import type { Telemetry } from '../models';

/** Time step of the feature grids used for correlation, seconds. */
export const GRID_DT = 0.05;

/** One analysed pair of video frames. */
export interface VideoSample {
  /** Video time of the frame. */
  t: number;
  /** Global image shift between the frames (px at 64x36) per second: how fast the picture pans. */
  pan: number;
  /** Mean absolute pixel change per second. */
  diff: number;
  /** Mean absolute pixel change (not per second). */
  mag: number;
  /** Brightness of the top half minus the bottom half (sky vs ground), 0..1. */
  tb: number;
}

export type VideoFeatureKey = 'pan' | 'diff' | 'tb' | 'tbn';
export type LogFeatureKey = 'yp' | 'g' | 'up';
export type NumericVideoField = 'pan' | 'diff' | 'tb';

export function smooth(a: Float32Array, window: number): Float32Array {
  const n = a.length;
  const out = new Float32Array(n);
  const h = window >> 1;
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(n - 1, i + h); j++) {
      s += a[j]!;
      c++;
    }
    out[i] = s / c;
  }
  return out;
}

/** Resample irregular video samples onto the regular grid (gaps are interpolated, edges held), then smooth. */
export function gridFromSamples(samples: readonly VideoSample[], field: NumericVideoField, t0: number, t1: number): Float32Array {
  const n = Math.max(2, Math.ceil((t1 - t0) / GRID_DT) + 1);
  const sum = new Float32Array(n);
  const cnt = new Uint16Array(n);
  const out = new Float32Array(n);
  for (const q of samples) {
    const k = Math.floor((q.t - t0) / GRID_DT);
    if (k >= 0 && k < n) {
      sum[k] = sum[k]! + q[field];
      cnt[k] = cnt[k]! + 1;
    }
  }
  let first = -1;
  let last = -1;
  for (let k = 0; k < n; k++) {
    if (!cnt[k]) continue;
    out[k] = sum[k]! / cnt[k]!;
    if (first < 0) first = k;
    if (last >= 0 && k - last > 1) {
      for (let j = last + 1; j < k; j++) out[j] = out[last]! + ((out[k]! - out[last]!) * (j - last)) / (k - last);
    }
    last = k;
  }
  if (first < 0) return smooth(out, 5);
  for (let k = 0; k < first; k++) out[k] = out[first]!;
  for (let k = last + 1; k < n; k++) out[k] = out[last]!;
  return smooth(out, 5);
}

/** How upright the drone is (cos roll * cos pitch: 1 = level, -1 = upside down) on the regular grid. */
export function upGrid(T: Telemetry): Float32Array {
  const n = Math.floor(T.t[T.t.length - 1]! / GRID_DT) + 1;
  const o = new Float32Array(n);
  const c = new Uint16Array(n);
  for (let i = 0; i < T.t.length; i++) {
    const k = Math.floor(T.t[i]! / GRID_DT);
    if (k < 0 || k >= n) continue;
    o[k] = o[k]! + Math.cos(T.att[i * 3]!) * Math.cos(T.att[i * 3 + 1]!);
    c[k] = c[k]! + 1;
  }
  for (let k = 0; k < n; k++) o[k] = c[k] ? o[k]! / c[k]! : k ? o[k - 1]! : 1;
  return smooth(o, 5);
}

/** Rotation speed from the gyro on the regular grid: 'yp' = yaw/pitch magnitude, 'g' = all three axes. */
export function logGrid(T: Telemetry, kind: 'yp' | 'g'): Float32Array {
  const n = Math.floor(T.t[T.t.length - 1]! / GRID_DT) + 1;
  const o = new Float32Array(n);
  const c = new Uint16Array(n);
  for (let i = 0; i < T.t.length; i++) {
    const k = Math.floor(T.t[i]! / GRID_DT);
    if (k < 0 || k >= n) continue;
    const gx = T.gyro[i * 3]!;
    const gy = T.gyro[i * 3 + 1]!;
    const gz = T.gyro[i * 3 + 2]!;
    o[k] = o[k]! + (kind === 'yp' ? Math.hypot(gy, gz) : Math.hypot(gx, gy, gz));
    c[k] = c[k]! + 1;
  }
  for (let k = 0; k < n; k++) o[k] = c[k] ? o[k]! / c[k]! : k ? o[k - 1]! : 0;
  return smooth(o, 5);
}

export const FRAME_W = 64;
export const FRAME_H = 36;

/** Global image shift between two 64x36 grayscale frames (block matching, +-8 px). Only the magnitude is used. */
export function shiftXY(a: Uint8Array, b: Uint8Array): [number, number] {
  const W = FRAME_W, H = FRAME_H, R = 8;
  const sad = (dx: number, dy: number): number => {
    let s = 0;
    for (let y = R; y < H - R; y++) {
      const ra = y * W;
      const rb = (y + dy) * W + dx;
      for (let x = R; x < W - R; x++) s += Math.abs(a[ra + x]! - b[rb + x]!);
    }
    return s;
  };
  let best = sad(0, 0) * 0.98;
  let bx = 0;
  let by = 0;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (!dx && !dy) continue;
      const s = sad(dx, dy);
      if (s < best) {
        best = s;
        bx = dx;
        by = dy;
      }
    }
  }
  return [bx, by];
}

export interface Correlation {
  /** Video time = log time + off. */
  off: number;
  /** Best correlation and the best one that is >1 s away from it (peak sharpness). */
  r1: number;
  r2: number;
}

/**
 * Normalised cross-correlation of the log feature F (log time = index * dt) with the video feature V
 * (video time = vt0 + index * dt) for every offset in [offLo, offHi]; sub-sample peak by parabolic interpolation.
 */
export function crossCorrelate(F: Float32Array, V: Float32Array, vt0: number, L0: number, L1: number, offLo: number, offHi: number): Correlation {
  const k0 = Math.max(0, Math.floor(L0 / GRID_DT));
  const k1 = Math.min(F.length - 1, Math.floor(L1 / GRID_DT));
  const n0 = k1 - k0 + 1;
  const sLo = Math.round((offLo - vt0) / GRID_DT);
  const sHi = Math.round((offHi - vt0) / GRID_DT);
  if (sHi < sLo || n0 < 10) return { off: 0, r1: -1, r2: -1 };
  const r = new Float32Array(sHi - sLo + 1);
  for (let s = sLo; s <= sHi; s++) {
    let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (let k = k0; k <= k1; k++) {
      const j = k + s;
      if (j < 0 || j >= V.length) continue;
      const a = F[k]!;
      const b = V[j]!;
      n++;
      sa += a;
      sb += b;
      saa += a * a;
      sbb += b * b;
      sab += a * b;
    }
    let rr = -1;
    if (n >= 0.7 * n0) {
      const d = (n * saa - sa * sa) * (n * sbb - sb * sb);
      if (d > 1e-12) rr = (n * sab - sa * sb) / Math.sqrt(d);
    }
    r[s - sLo] = rr;
  }
  let ib = 0;
  for (let i = 1; i < r.length; i++) if (r[i]! > r[ib]!) ib = i;
  let r2 = -1;
  for (let i = 0; i < r.length; i++) if (Math.abs(i - ib) > 20 && r[i]! > r2) r2 = r[i]!;
  let d = 0;
  if (ib > 0 && ib < r.length - 1) {
    const a = r[ib - 1]!, b = r[ib]!, c = r[ib + 1]!;
    const den = a - 2 * b + c;
    if (den < 0) d = (0.5 * (a - c)) / den;
  }
  return { off: vt0 + (sLo + ib + d) * GRID_DT, r1: r[ib]!, r2 };
}

export type Confidence = 'high' | 'medium' | 'low';

export function confidenceOf(x: Pick<Correlation, 'r1' | 'r2'>): Confidence {
  if (x.r1 >= 0.5 && x.r1 - x.r2 >= 0.12) return 'high';
  if (x.r1 >= 0.35 && x.r1 - x.r2 >= 0.06) return 'medium';
  return 'low';
}

/**
 * Video-side lift-off: the first moment the picture starts moving and keeps moving for ~2.4 s (a hand wave is ignored).
 * Noise level = the quietest ~0.8 s of the scan.
 */
export function detectVideoOnset(samples: readonly VideoSample[]): { t: number; conf: number } | null {
  const N = samples.length;
  const W = 30;
  if (N < W + 12) return null;
  const v = samples.map((s) => s.mag);
  const mean = (a: number, b: number): number => {
    let s = 0;
    for (let i = a; i < b; i++) s += v[i]!;
    return s / (b - a);
  };
  let mn = 1;
  for (let i = 0; i + 10 <= N; i += 2) mn = Math.min(mn, mean(i, i + 10));
  const base = Math.max(mn, 0.0008);
  for (let i = 10; i < N - W; i++) {
    const before = mean(i - 10, i);
    const after = mean(i, i + W);
    if (before > Math.max(base * 2.5, base + 0.0015) || after < Math.max(base * 5, 0.006)) continue;
    let hi = 0;
    for (let k = i; k < i + W; k++) if (v[k]! > Math.max(base * 3, 0.003)) hi++;
    if (hi < W * 0.7) continue;
    let j = i;
    for (let k = i; k < i + W; k++) {
      if (v[k]! > Math.max(base * 4, 0.004)) {
        j = k;
        break;
      }
    }
    return { t: samples[j]!.t, conf: after / Math.max(before, base) };
  }
  return null;
}

/**
 * How fast to play a video while scanning it for auto-sync: 3× up to 1080p, 2× up to 1440p, 1× above (a 4K stream
 * decoded at 3× drops most frames, and a scan with too few frames finds no match).
 */
export function scanRate(width: number, height: number): number {
  const px = Math.max(width, height);
  return px > 2600 ? 1 : px > 1920 ? 2 : 3;
}
