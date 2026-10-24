/** Small numeric helpers shared by the domain and drawing code. */
export const DEG = 180 / Math.PI;
export const RAD = Math.PI / 180;

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Wrap an angle to [-PI, PI). */
export const wrapPi = (a: number): number => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
/** Degrees wrapped into -180..180. */
export const wrapDeg = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
/** Speed colour scale used by every widget: blue (slow) -> red (fast). `t` is 0..1. */
export const speedHue = (t: number): number => (1 - clamp(t, 0, 1)) * 223;
export const speedHsl = (t: number, s = 90, l = 52): string => `hsl(${speedHue(t)},${s}%,${l}%)`;

/** Binary search: first index whose value is >= x (the array must be ascending). */
export function lowerBound(a: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = a.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if ((a[m] as number) < x) lo = m + 1;
    else hi = m;
  }
  return lo;
}

export function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1] as number;
}

export function formatClock(t: number): string {
  const s = Math.max(0, t);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}
