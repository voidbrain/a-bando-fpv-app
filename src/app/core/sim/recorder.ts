import { SIM_BASE_ALT } from '../constants';
import { toGeo, courseDegrees } from '../geo';
import { DEG } from '../math';
import { eulerYXZ } from '../math3d';
import type { Calibration, GeoSample } from '../models';
import type { DroneState } from './drone-physics';

export interface RecordedSample {
  t: number;
  lat: number;
  lon: number;
  alt: number;
  spd: number;
  crs: number;
  roll: number;
  pitch: number;
  yaw: number;
  thr: number;
}

/** GPS blackbox of the simulator: one sample every 0.1 s while armed. */
export class SimRecorder {
  static readonly INTERVAL = 0.1;
  private samples: RecordedSample[] = [];
  private clock = 0;

  get length(): number {
    return this.samples.length;
  }
  get data(): readonly RecordedSample[] {
    return this.samples;
  }

  start(): void {
    this.samples = [];
    this.clock = 0;
  }

  /** Advance the recorder clock by dt and append as many samples as are due. */
  tick(dt: number, d: DroneState, throttle: number, cal: Calibration): void {
    this.clock += dt;
    while (this.clock >= this.samples.length * SimRecorder.INTERVAL) this.push(d, throttle, cal);
  }

  private push(d: DroneState, throttle: number, cal: Calibration): void {
    // The world frame is never scaled (only the buildings are), so positions convert to latitude/longitude directly.
    const [lat, lon] = toGeo(d.p.x, d.p.z, cal);
    const e = eulerYXZ(d.q);
    this.samples.push({
      t: this.samples.length * SimRecorder.INTERVAL,
      lat,
      lon,
      alt: SIM_BASE_ALT + d.p.y,
      spd: d.v.length(),
      crs: courseDegrees(d.v.x, d.v.z, cal),
      roll: -e.z * DEG,
      pitch: e.x * DEG,
      yaw: e.y * DEG,
      thr: throttle,
    });
  }

  toGeoSamples(): GeoSample[] {
    return this.samples.map((r) => ({ lat: r.lat, lon: r.lon, alt: r.alt, t: r.t }));
  }

  toCsv(): string {
    const head = 'time (us),GPS_numSat,GPS_coord[0],GPS_coord[1],GPS_altitude,GPS_speed (m/s),GPS_ground_course,roll,pitch,yaw,throttle';
    const rows = this.samples.map((r) =>
      [Math.round(r.t * 1e6), 14, r.lat.toFixed(7), r.lon.toFixed(7), r.alt.toFixed(2), r.spd.toFixed(2), r.crs.toFixed(1), r.roll.toFixed(1), r.pitch.toFixed(1), r.yaw.toFixed(1), r.thr.toFixed(2)].join(','),
    );
    return [head, ...rows].join('\n');
  }

  toJson(): string {
    return JSON.stringify(this.samples.map((r) => ({ t: +r.t.toFixed(2), lat: r.lat, lon: r.lon, alt: +r.alt.toFixed(2), speed: +r.spd.toFixed(2) })));
  }
}
