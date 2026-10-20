import { Vec3 } from '../math3d';
import { toLocal } from '../geo';
import type { Calibration, Flight, GeoSample, Telemetry } from '../models';

let counter = 0;

export function createFlight(name: string, pts: GeoSample[], tel: Telemetry | null = null, live = false): Flight {
  return {
    id: `f${Date.now().toString(36)}${(counter++).toString(36)}`,
    name,
    pts,
    tel,
    live,
    att: null,
    loc: [],
    spd: [],
    dur: 0,
    cursor: 0,
  };
}

/**
 * Fill in the derived arrays: local coordinates (altitude relative to the lowest fix, with a floor so the path never
 * dips under the ground), smoothed speed (+-3 samples) and duration. Call again after the calibration changes.
 */
export function prepareFlight(f: Flight, cal: Calibration): void {
  const first = f.pts[0];
  if (!first) {
    f.loc = [];
    f.spd = [];
    f.dur = 0;
    return;
  }
  const minAlt = f.pts.reduce((m, p) => Math.min(m, p.alt), Infinity);
  f.loc = f.pts.map((p) => {
    const [x, z] = toLocal(p.lat, p.lon, cal);
    return new Vec3(x, Math.max(0.2, p.alt - minAlt + 0.3), z);
  });
  const last = f.loc.length - 1;
  f.spd = f.loc.map((_, i) => {
    const j = Math.min(last, i + 3);
    const k = Math.max(0, i - 3);
    const dt = (f.pts[j] as GeoSample).t - (f.pts[k] as GeoSample).t;
    return dt > 0 ? (f.loc[j] as Vec3).distanceTo(f.loc[k] as Vec3) / dt : 0;
  });
  f.dur = (f.pts[f.pts.length - 1] as GeoSample).t - first.t;
}

export interface FlightStats {
  points: number;
  distanceKm: number;
  durationS: number;
  maxKmh: number;
}

/** Colour-scale maximum over all flights (ignores implausible GPS spikes), m/s. */
export function maxSpeed(flights: readonly Flight[]): number {
  let mx = 1;
  for (const f of flights) for (const v of f.spd) if (v > mx && v < 150) mx = v;
  return mx;
}

export function flightStats(f: Flight): FlightStats {
  let dist = 0;
  let vmax = 0;
  for (let i = 0; i < f.loc.length; i++) {
    if (i) dist += (f.loc[i] as Vec3).distanceTo(f.loc[i - 1] as Vec3);
    const v = f.spd[i] ?? 0;
    vmax = Math.max(vmax, v < 150 ? v : 0);
  }
  return { points: f.loc.length, distanceKm: dist / 1000, durationS: f.dur, maxKmh: vmax * 3.6 };
}

const timesCache = new WeakMap<Flight, { n: number; a: Float64Array }>();

/** Time of every GPS point (log seconds), cached: used for binary searches on the timeline. */
export function pointTimes(f: Flight): Float64Array {
  const hit = timesCache.get(f);
  if (hit && hit.n === f.pts.length) return hit.a;
  const a = Float64Array.from(f.pts, (p) => p.t);
  timesCache.set(f, { n: f.pts.length, a });
  return a;
}

const speedMaxCache = new WeakMap<number[], number>();

/** Top speed of one flight, m/s, ignoring GPS spikes (> 150 m/s). Cached per speed array. */
export function flightSpeedMax(f: Flight): number {
  const hit = speedMaxCache.get(f.spd);
  if (hit !== undefined) return hit;
  const m = f.spd.reduce((mx, x) => (x < 150 && x > mx ? x : mx), 0);
  speedMaxCache.set(f.spd, m);
  return m;
}
