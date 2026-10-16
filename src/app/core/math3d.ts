/**
 * Tiny, dependency-free 3D maths (vectors, quaternions, Euler angles).
 * The domain layer (simulator, replay attitude, instrument drawing) uses these types so it stays
 * independent from the renderer; only the `three/` layer converts them to three.js objects.
 * Conventions match three.js: right-handed, +Y up, forward = -Z, intrinsic Euler order 'YXZ' (yaw, pitch, roll).
 */

export type EulerOrder = 'XYZ' | 'YXZ';

export interface EulerAngles {
  x: number;
  y: number;
  z: number;
}

export class Vec3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  copy(v: Vec3): this {
    return this.set(v.x, v.y, v.z);
  }
  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }
  add(v: Vec3): this {
    return this.set(this.x + v.x, this.y + v.y, this.z + v.z);
  }
  sub(v: Vec3): this {
    return this.set(this.x - v.x, this.y - v.y, this.z - v.z);
  }
  scale(s: number): this {
    return this.set(this.x * s, this.y * s, this.z * s);
  }
  addScaled(v: Vec3, s: number): this {
    return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s);
  }
  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  cross(v: Vec3): this {
    return this.set(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x);
  }
  length(): number {
    return Math.hypot(this.x, this.y, this.z);
  }
  normalize(): this {
    const l = this.length() || 1;
    return this.scale(1 / l);
  }
  distanceTo(v: Vec3): number {
    return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z);
  }
  lerp(v: Vec3, t: number): this {
    return this.set(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t, this.z + (v.z - this.z) * t);
  }
  applyQuat(q: Quat): this {
    const { x, y, z } = this;
    const ix = q.w * x + q.y * z - q.z * y;
    const iy = q.w * y + q.z * x - q.x * z;
    const iz = q.w * z + q.x * y - q.y * x;
    const iw = -q.x * x - q.y * y - q.z * z;
    return this.set(
      ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
      iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
      iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
    );
  }
}

export class Quat {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
    public w = 1,
  ) {}

  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }
  copy(q: Quat): this {
    return this.set(q.x, q.y, q.z, q.w);
  }
  clone(): Quat {
    return new Quat(this.x, this.y, this.z, this.w);
  }
  normalize(): this {
    const l = Math.hypot(this.x, this.y, this.z, this.w) || 1;
    return this.set(this.x / l, this.y / l, this.z / l, this.w / l);
  }
  /** this = this * q  (apply q first in the local frame, like three.js). */
  multiply(q: Quat): this {
    const a = this;
    return this.set(
      a.x * q.w + a.w * q.x + a.y * q.z - a.z * q.y,
      a.y * q.w + a.w * q.y + a.z * q.x - a.x * q.z,
      a.z * q.w + a.w * q.z + a.x * q.y - a.y * q.x,
      a.w * q.w - a.x * q.x - a.y * q.y - a.z * q.z,
    );
  }
  setFromEuler(x: number, y: number, z: number, order: EulerOrder = 'XYZ'): this {
    const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    if (order === 'YXZ') {
      return this.set(
        s1 * c2 * c3 + c1 * s2 * s3,
        c1 * s2 * c3 - s1 * c2 * s3,
        c1 * c2 * s3 - s1 * s2 * c3,
        c1 * c2 * c3 + s1 * s2 * s3,
      );
    }
    return this.set(
      s1 * c2 * c3 + c1 * s2 * s3,
      c1 * s2 * c3 - s1 * c2 * s3,
      c1 * c2 * s3 + s1 * s2 * c3,
      c1 * c2 * c3 - s1 * s2 * s3,
    );
  }
  setFromAxisAngle(axis: Vec3, angle: number): this {
    const h = angle / 2, s = Math.sin(h);
    return this.set(axis.x * s, axis.y * s, axis.z * s, Math.cos(h));
  }
  /** Spherical interpolation towards q (shortest path). */
  slerp(q: Quat, t: number): this {
    if (t === 0) return this;
    if (t === 1) return this.copy(q);
    const { x, y, z, w } = this;
    let cos = w * q.w + x * q.x + y * q.y + z * q.z;
    if (cos < 0) {
      this.set(-q.x, -q.y, -q.z, -q.w);
      cos = -cos;
    } else {
      this.copy(q);
    }
    if (cos >= 1) return this.set(x, y, z, w);
    const sqrSin = 1 - cos * cos;
    if (sqrSin <= Number.EPSILON) {
      const s = 1 - t;
      return this.set(s * x + t * this.x, s * y + t * this.y, s * z + t * this.z, s * w + t * this.w).normalize();
    }
    const sin = Math.sqrt(sqrSin);
    const half = Math.atan2(sin, cos);
    const ra = Math.sin((1 - t) * half) / sin;
    const rb = Math.sin(t * half) / sin;
    return this.set(x * ra + this.x * rb, y * ra + this.y * rb, z * ra + this.z * rb, w * ra + this.w * rb);
  }
}

/** Euler angles (order YXZ) of a quaternion. */
export function eulerYXZ(q: Quat): EulerAngles {
  const x2 = q.x + q.x, y2 = q.y + q.y, z2 = q.z + q.z;
  const xx = q.x * x2, xy = q.x * y2, xz = q.x * z2;
  const yy = q.y * y2, yz = q.y * z2, zz = q.z * z2;
  const wx = q.w * x2, wy = q.w * y2, wz = q.w * z2;
  const m13 = xz + wy, m33 = 1 - (xx + yy), m21 = xy + wz, m22 = 1 - (xx + zz), m23 = yz - wx;
  const x = Math.asin(-Math.max(-1, Math.min(1, m23)));
  if (Math.abs(m23) < 0.9999999) return { x, y: Math.atan2(m13, m33), z: Math.atan2(m21, m22) };
  return { x, y: Math.atan2(-(xz - wy), 1 - (yy + zz)), z: 0 };
}

/** Attitude quaternion used everywhere: yaw about +Y, pitch-up positive about +X, right bank positive. */
export function attitudeQuat(out: Quat, pitchUp: number, yaw: number, rollRight: number): Quat {
  return out.setFromEuler(pitchUp, yaw, -rollRight, 'YXZ');
}

/** Pitch-up, yaw and right-bank roll of an attitude quaternion (inverse of {@link attitudeQuat}). */
export function attitudeAngles(q: Quat): { pitchUp: number; yaw: number; rollRight: number } {
  const e = eulerYXZ(q);
  return { pitchUp: e.x, yaw: e.y, rollRight: -e.z };
}
