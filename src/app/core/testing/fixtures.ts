import { createFlight, prepareFlight } from '../flight/flight';
import { DEFAULT_CALIBRATION } from '../constants';
import type { Flight, GeoSample, Telemetry } from '../models';

export interface FlipSpec {
  /** Middle of the move (log seconds). */
  at: number;
  axis: 'roll' | 'pitch';
}

/** Deterministic pseudo-random numbers so fixtures never flake. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Synthetic Blackbox telemetry at 100 Hz: motors idle until `liftoff`, then hover power; gyro noise everywhere; a
 * 360 degree flip/roll (1 s) centred on each entry of `flips`; yaw flicks at `flicks`.
 */
export function makeTelemetry(opts: { duration: number; liftoff: number; flips?: FlipSpec[]; flicks?: number[]; yawOff?: number }): Telemetry {
  const hz = 100;
  const n = Math.round(opts.duration * hz);
  const rnd = seeded(7);
  const t = new Float32Array(n), att = new Float32Array(n * 3), rc = new Float32Array(n * 4);
  const mot = new Float32Array(n * 4), gyro = new Float32Array(n * 3), vbat = new Float32Array(n).fill(16);
  for (let i = 0; i < n; i++) {
    const ti = i / hz;
    t[i] = ti;
    const flying = ti >= opts.liftoff;
    const m = flying ? 1100 + 40 * rnd() : 48 + 5 * rnd();
    for (let k = 0; k < 4; k++) mot[i * 4 + k] = m;
    let roll = 0, pitch = 0;
    let gr = (rnd() - 0.5) * 20, gp = (rnd() - 0.5) * 20, gy = (rnd() - 0.5) * 20;
    for (const f of opts.flips ?? []) {
      const u = (ti - (f.at - 0.5)) / 1; // 0..1 across the move
      if (u >= 0 && u <= 1) {
        const rateDegPerS = 360;
        if (f.axis === 'roll') gr += rateDegPerS;
        else gp += rateDegPerS;
        const a = u * 2 * Math.PI;
        if (f.axis === 'roll') roll = a;
        else pitch = a;
      }
    }
    for (const fl of opts.flicks ?? []) if (ti >= fl && ti < fl + 0.15) gy += 400;
    att[i * 3] = roll;
    att[i * 3 + 1] = pitch;
    att[i * 3 + 2] = 0;
    gyro[i * 3] = gr;
    gyro[i * 3 + 1] = gp;
    gyro[i * 3 + 2] = gy;
  }
  return { t, att, rc, mot, gyro, vbat, yawOff: opts.yawOff ?? 0 };
}

/** A straight 10 Hz GPS track near the site matching a telemetry duration. */
export function makeFlight(tel: Telemetry | null, duration = 30): Flight {
  const pts: GeoSample[] = [];
  for (let i = 0; i <= duration * 10; i++) pts.push({ lat: 45.5287 + i * 2e-6, lon: 12.1333 + i * 1e-6, alt: 8 + Math.min(10, i / 10), t: i / 10 });
  const f = createFlight('fixture', pts, tel);
  prepareFlight(f, DEFAULT_CALIBRATION);
  return f;
}

const BF_HEADER =
  'loopIteration,time,heading[0],heading[1],heading[2],rcCommand[0],rcCommand[1],rcCommand[2],rcCommand[3],motor[0],motor[1],motor[2],motor[3],gyroADC[0],gyroADC[1],gyroADC[2],vbatLatest,GPS_numSat,GPS_coord[0],GPS_coord[1],GPS_altitude,GPS_speed,GPS_ground_course';

/** A Betaflight-style CSV: ~800 Hz rows, GPS fix every 80 rows, raw units (1e-7 degrees, decimetres, microseconds). */
export function betaflightCsv(rows: number): string {
  const lines = [BF_HEADER];
  for (let i = 0; i < rows; i++) {
    const gpsStep = Math.floor(i / 80); // GPS changes every 80 rows, like a 10 Hz fix on an 800 Hz log
    lines.push(
      [i, 1_000_000 + i * 1250, 0.1, 0.2, 1.0, 5, 6, 7, 1100, 500, 510, 520, 530, 1, 2, 3, 1600, 14, 455287000 + gpsStep * 20, 121333000 + gpsStep * 10, 130 + gpsStep, 900, 450].join(','),
    );
  }
  return lines.join('\n');
}
