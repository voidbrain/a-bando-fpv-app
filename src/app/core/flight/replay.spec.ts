import { describe, expect, it } from 'vitest';
import { Quat, Vec3 } from '../math3d';
import type { Flight } from '../models';
import { ReplayPose, followClock } from './replay';

describe('following the video clock', () => {
  it('steers smoothly towards a nearby master and jumps to a far one', () => {
    const t = followClock(10, 10.1, 1 / 60);
    expect(t).toBeGreaterThan(10);
    expect(t).toBeLessThan(10.1);
    expect(followClock(10, 12, 1 / 60)).toBe(12);
    expect(followClock(10, 10, 1 / 60)).toBe(10);
  });
  it('a stalled master does not stop the replay dead', () => {
    // the video froze at 5 s for a few frames while the replay ran on
    let time = 5;
    for (let i = 0; i < 6; i++) time = followClock(time + 1 / 60, 5, 1 / 60);
    expect(time).toBeGreaterThan(5);
  });
});

describe('replayed attitude', () => {
  const flight = (): Flight => ({
    id: 'f',
    name: 'f',
    pts: [
      { lat: 0, lon: 0, alt: 0, t: 0 },
      { lat: 0, lon: 0, alt: 0, t: 1 },
    ],
    loc: [new Vec3(0, 0, 0), new Vec3(0, 0, 10)],
    spd: [0, 0],
    dur: 1,
    cursor: 0,
    live: false,
    att: null,
    tel: {
      t: new Float32Array([0, 0.01]),
      att: new Float32Array([0, 0, 0, 0.2, 0, 0]), // roll 0 → 0.2 rad over 10 ms
      rc: new Float32Array(8),
      mot: new Float32Array(8),
      gyro: new Float32Array(6),
      vbat: new Float32Array(2),
      yawOff: 0,
    },
  });

  it('blends the two log samples around the moment instead of snapping to one', () => {
    const pose = new ReplayPose();
    const f = flight();
    const cal = { rot: 0, dx: 0, dz: 0 };
    const angle = (q: Quat): number => 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    pose.update(f, 0.005, cal, 1 / 60);
    expect(angle(pose.q)).toBeCloseTo(0.1, 3);
    pose.update(f, 0.01, cal, 1 / 60);
    expect(angle(pose.q)).toBeCloseTo(0.2, 3);
    pose.update(f, 0.5, cal, 1 / 60); // past the last sample: holds it
    expect(angle(pose.q)).toBeCloseTo(0.2, 3);
  });
});
