import { clamp, lowerBound, wrapPi } from '../math';
import { Quat, Vec3 } from '../math3d';
import type { Calibration, Flight } from '../models';

/** Where the attitude of the replayed drone comes from. */
export type AttitudeSource = 'telemetry' | 'live' | 'gps';

/**
 * Pose of the replayed drone at a given replay time.
 * Without attitude data the nose follows the direction of travel (smoothed), with a slight pitch from the climb angle.
 * With Blackbox telemetry (or live attitude) the real roll / pitch / yaw are used, yaw aligned to the GPS course.
 */
export class ReplayPose {
  readonly p = new Vec3();
  readonly q = new Quat();
  source: AttitudeSource = 'gps';
  /** Smoothed heading of the direction of travel (GPS-only mode). */
  private heading = 0;
  private readonly tmp = new Vec3();

  /** Heading follows the track when starting a new flight, not the previous one. */
  reset(): void {
    this.heading = 0;
  }

  update(f: Flight, replayTime: number, cal: Calibration, dt: number): void {
    const n = f.pts.length;
    if (n < 2) return;
    const ts = f.pts[0]!.t + replayTime;
    let i = f.cursor;
    if (i > n - 2 || f.pts[i]!.t > ts) i = 0;
    while (i < n - 2 && f.pts[i + 1]!.t <= ts) i++;
    f.cursor = i;
    const a = f.pts[i]!;
    const b = f.pts[i + 1]!;
    const u = b.t > a.t ? clamp((ts - a.t) / (b.t - a.t), 0, 1) : 0;
    this.p.copy(f.loc[i]!).lerp(f.loc[i + 1]!, u);

    const d = this.tmp.copy(f.loc[Math.min(n - 1, i + 3)]!).sub(f.loc[Math.max(0, i - 1)]!);
    const hz = Math.hypot(d.x, d.z);
    if (hz > 0.2) {
      const target = Math.atan2(-d.x, -d.z);
      this.heading += wrapPi(target - this.heading) * (1 - Math.exp(-dt * 6));
    }
    this.q.setFromEuler(Math.atan2(d.y, Math.max(hz, 1)) * 0.6, this.heading, 0, 'YXZ');
    this.source = 'gps';

    const rot = (cal.rot * Math.PI) / 180;
    const T = f.tel;
    if (T) {
      const k = lowerBound(T.t, replayTime);
      this.q.setFromEuler(-T.att[k * 3 + 1]!, -(T.att[k * 3 + 2]! + T.yawOff + rot), -T.att[k * 3]!, 'YXZ');
      this.source = 'telemetry';
    } else if (f.att) {
      this.q.setFromEuler(-f.att.pitch, -(f.att.hdg + rot), -f.att.roll, 'YXZ');
      this.source = 'live';
    }
  }
}
