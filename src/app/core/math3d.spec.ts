import { wrapDeg } from './math';
import { Quat, Vec3, attitudeAngles, attitudeQuat, eulerYXZ } from './math3d';

describe('math3d', () => {
  it('rotates +Z a quarter turn about +Y onto +X', () => {
    const q = new Quat().setFromAxisAngle(new Vec3(0, 1, 0), Math.PI / 2);
    const v = new Vec3(0, 0, 1).applyQuat(q);
    expect(v.x).toBeCloseTo(1, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it('recovers pitch, yaw and roll from an attitude quaternion', () => {
    for (const [p, y, r] of [[0.3, 1.2, -0.5], [-0.8, -2.5, 0.9], [0, 0, 0]] as const) {
      const a = attitudeAngles(attitudeQuat(new Quat(), p, y, r));
      expect(a.pitchUp).toBeCloseTo(p, 6);
      expect(a.yaw).toBeCloseTo(y, 6);
      expect(a.rollRight).toBeCloseTo(r, 6);
    }
  });

  it('a nose-up pitch tilts the forward axis (-Z) upwards', () => {
    const q = attitudeQuat(new Quat(), 0.5, 0, 0);
    const fwd = new Vec3(0, 0, -1).applyQuat(q);
    expect(fwd.y).toBeGreaterThan(0.4);
  });

  it('a right bank tilts the up axis towards +X', () => {
    const q = attitudeQuat(new Quat(), 0, 0, 0.5);
    const up = new Vec3(0, 1, 0).applyQuat(q);
    expect(up.x).toBeGreaterThan(0.4);
  });

  it('slerp goes the short way and reaches the target', () => {
    const a = new Quat().setFromEuler(0, 0, 0, 'YXZ');
    const b = new Quat().setFromEuler(0, 2, 0, 'YXZ');
    const mid = a.clone().slerp(b, 0.5);
    expect(eulerYXZ(mid).y).toBeCloseTo(1, 6);
    expect(a.clone().slerp(b, 1).w).toBeCloseTo(b.w, 9);
    // opposite-sign twin of the same rotation must not make slerp spin the long way
    const twin = new Quat(-b.x, -b.y, -b.z, -b.w);
    expect(eulerYXZ(a.clone().slerp(twin, 0.5)).y).toBeCloseTo(1, 6);
  });

  it('multiply composes rotations in the local frame', () => {
    const q = new Quat().setFromEuler(0, Math.PI / 2, 0, 'YXZ').multiply(new Quat().setFromEuler(0, Math.PI / 2, 0, 'YXZ'));
    expect(Math.abs(eulerYXZ(q).y)).toBeCloseTo(Math.PI, 6);
  });
});

describe('wrapDeg', () => {
  it('wraps degrees into -180..180', () => {
    expect(wrapDeg(190)).toBe(-170);
    expect(wrapDeg(-190)).toBe(170);
    expect(wrapDeg(725)).toBe(5);
    expect(wrapDeg(0)).toBe(0);
  });
});
