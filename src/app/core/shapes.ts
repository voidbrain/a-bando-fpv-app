/**
 * Primitive shapes: what a 'shapes' structure (and so a block made without app code) is built from. A box, a cylinder,
 * an extrusion of an outline, or an array repeating another shape. Checked and capped, expanded into plain primitives,
 * and turned into colliders (axis-aligned boxes and vertical cylinders only). Pure.
 */
import type { SolidBox, TreeCylinder } from './sim/collider';
import type { Vec2 } from './site-spec';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A primitive of a 'shapes' structure, in its local metres (x east, y up, z south, origin at the insertion point). */
export type ShapeSpec =
  | { prim: 'box'; at: Vec3; size: Vec3; rotDeg?: number; color: string }
  | { prim: 'cylinder'; at: Vec3; radius: number; height: number; segments?: number; color: string }
  | { prim: 'extrude'; outline: Vec2[]; at: Vec3; height: number; color: string }
  | { prim: 'array'; of: ShapeSpec; count: number; step: Vec3 };

/** One placed primitive after arrays are expanded (box, cylinder or extrusion). */
export type Prim = Exclude<ShapeSpec, { prim: 'array' }>;


/** Limits: a broken or hostile block must not freeze the app. */
export const MAX_PRIMS = 400;
export const MAX_ARRAY = 60;

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const isNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
const COLOR = /^#[0-9a-fA-F]{6}$/;

const v3 = (v: unknown, lim: number, def = 0): Vec3 => {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Vec3>;
  return { x: isNum(o.x) ? clamp(o.x, -lim, lim) : def, y: isNum(o.y) ? clamp(o.y, -lim, lim) : def, z: isNum(o.z) ? clamp(o.z, -lim, lim) : def };
};
const col = (c: unknown): string => (typeof c === 'string' && COLOR.test(c) ? c.toLowerCase() : '#9a9a92');

/** Check (resolved) shapes: known primitives, sizes clamped, at most {@link MAX_PRIMS} once arrays are expanded. */
export function sanitizeShapes(raw: unknown): ShapeSpec[] {
  const one = (s: unknown, depth: number): ShapeSpec | null => {
    if (!s || typeof s !== 'object' || depth > 3) return null;
    const o = s as Record<string, unknown>;
    if (o['prim'] === 'box') {
      const size = v3(o['size'], 200, 1);
      return { prim: 'box', at: v3(o['at'], 300), size: { x: Math.max(0.02, size.x), y: Math.max(0.02, size.y), z: Math.max(0.02, size.z) }, ...(isNum(o['rotDeg']) && o['rotDeg'] ? { rotDeg: ((o['rotDeg'] % 360) + 360) % 360 } : {}), color: col(o['color']) };
    }
    if (o['prim'] === 'cylinder') {
      return { prim: 'cylinder', at: v3(o['at'], 300), radius: isNum(o['radius']) ? clamp(o['radius'], 0.02, 60) : 1, height: isNum(o['height']) ? clamp(o['height'], 0.02, 300) : 1, ...(isNum(o['segments']) ? { segments: clamp(Math.round(o['segments']), 3, 32) } : {}), color: col(o['color']) };
    }
    if (o['prim'] === 'extrude') {
      const outline = (Array.isArray(o['outline']) ? o['outline'] : []).filter((p): p is Vec2 => !!p && isNum((p as Vec2).x) && isNum((p as Vec2).z)).slice(0, 64).map((p) => ({ x: clamp(p.x, -200, 200), z: clamp(p.z, -200, 200) }));
      if (outline.length < 3) return null;
      return { prim: 'extrude', outline, at: v3(o['at'], 300), height: isNum(o['height']) ? clamp(o['height'], 0.02, 300) : 1, color: col(o['color']) };
    }
    if (o['prim'] === 'array') {
      const of = one(o['of'], depth + 1);
      if (!of) return null;
      return { prim: 'array', of, count: isNum(o['count']) ? clamp(Math.round(o['count']), 1, MAX_ARRAY) : 1, step: v3(o['step'], 100) };
    }
    return null;
  };
  const out: ShapeSpec[] = [];
  let n = 0;
  for (const s of Array.isArray(raw) ? raw : []) {
    const c = one(s, 0);
    if (!c) continue;
    n += countPrims(c);
    if (n > MAX_PRIMS) break;
    out.push(c);
  }
  return out;
}

const countPrims = (s: ShapeSpec): number => (s.prim === 'array' ? s.count * countPrims(s.of) : 1);

/** Arrays expanded into plain primitives (each copy moved by `step`), at most {@link MAX_PRIMS}. */
export function expandShapes(shapes: readonly ShapeSpec[]): Prim[] {
  const out: Prim[] = [];
  const add = (s: ShapeSpec, d: Vec3): void => {
    if (out.length >= MAX_PRIMS) return;
    if (s.prim === 'array') {
      for (let i = 0; i < s.count; i++) add(s.of, { x: d.x + s.step.x * i, y: d.y + s.step.y * i, z: d.z + s.step.z * i });
      return;
    }
    out.push({ ...s, at: { x: s.at.x + d.x, y: s.at.y + d.y, z: s.at.z + d.z } } as Prim);
  };
  for (const s of shapes) add(s, { x: 0, y: 0, z: 0 });
  return out;
}

/** Highest point of a set of primitives (the structure's height). */
export function shapesHeight(prims: readonly Prim[]): number {
  return prims.reduce((h, p) => Math.max(h, p.at.y + (p.prim === 'box' ? p.size.y / 2 : p.height)), 0);
}

/**
 * Collision for primitives placed at (x, z) turned `rotDeg`: boxes become axis-aligned boxes (turned ones cut into ~1 m
 * pieces along their length), cylinders vertical cylinders, extrusions a staircase of ~1 m cells inside the outline.
 * Box `at` is its centre; cylinder and extrusion `at` is the centre / origin of their base.
 */
export function shapeSolids(prims: readonly Prim[], x: number, z: number, rotDeg: number, baseY = 0): { boxes: SolidBox[]; cylinders: TreeCylinder[] } {
  const a = (rotDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const W = (lx: number, lz: number): [number, number] => [x + lx * c - lz * s, z + lx * s + lz * c];
  const boxes: SolidBox[] = [], cylinders: TreeCylinder[] = [];
  /** An upright box of footprint w × d at local (lx, lz) turned `deg`, as axis-aligned pieces. */
  const piece = (lx: number, lz: number, w: number, d: number, deg: number, y0: number, y1: number): void => {
    const t = ((deg + rotDeg) * Math.PI) / 180, ct = Math.abs(Math.cos(t)), st = Math.abs(Math.sin(t));
    const straight = ct < 0.02 || st < 0.02;
    const long = w >= d;
    const n = straight ? 1 : Math.max(1, Math.ceil((long ? w : d) / 1));
    const pw = long ? w / n : w, pd = long ? d : d / n;
    const lr = (deg * Math.PI) / 180;
    for (let k = 0; k < n; k++) {
      const off = (k + 0.5) / n - 0.5;
      const ox = long ? off * w : 0, oz = long ? 0 : off * d;
      const [cx, cz] = W(lx + ox * Math.cos(lr) - oz * Math.sin(lr), lz + ox * Math.sin(lr) + oz * Math.cos(lr));
      const hw = (pw * ct + pd * st) / 2, hd = (pw * st + pd * ct) / 2;
      boxes.push([cx - hw, cx + hw, baseY + y0, baseY + y1, cz - hd, cz + hd, false]);
    }
  };
  for (const p of prims) {
    if (p.prim === 'box') piece(p.at.x, p.at.z, p.size.x, p.size.z, p.rotDeg ?? 0, p.at.y - p.size.y / 2, p.at.y + p.size.y / 2);
    else if (p.prim === 'cylinder') {
      const [cx, cz] = W(p.at.x, p.at.z);
      cylinders.push([cx, cz, p.radius, baseY + p.at.y + p.height, baseY + p.at.y]);
    } else {
      const xs = p.outline.map((q) => q.x), zs = p.outline.map((q) => q.z);
      for (let gx = Math.min(...xs); gx < Math.max(...xs); gx += 1) {
        for (let gz = Math.min(...zs); gz < Math.max(...zs); gz += 1) {
          if (!inside(p.outline, gx + 0.5, gz + 0.5)) continue;
          piece(p.at.x + gx + 0.5, p.at.z + gz + 0.5, 1, 1, 0, p.at.y, p.at.y + p.height);
        }
      }
    }
  }
  return { boxes, cylinders };
}

function inside(poly: readonly Vec2[], x: number, z: number): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) r = !r;
  }
  return r;
}


/** The plan footprint of a set of primitives (local metres): its bounding rectangle, at least 1 × 1 m. */
export function shapesFootprint(prims: readonly Prim[]): { x0: number; z0: number; x1: number; z1: number } {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const grow = (x: number, z: number): void => {
    x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
  };
  for (const p of prims) {
    if (p.prim === 'box') {
      const r = Math.hypot(p.size.x, p.size.z) / 2, t = p.rotDeg ? r : 0;
      grow(p.at.x - (t || p.size.x / 2), p.at.z - (t || p.size.z / 2));
      grow(p.at.x + (t || p.size.x / 2), p.at.z + (t || p.size.z / 2));
    } else if (p.prim === 'cylinder') {
      grow(p.at.x - p.radius, p.at.z - p.radius);
      grow(p.at.x + p.radius, p.at.z + p.radius);
    } else for (const q of p.outline) grow(p.at.x + q.x, p.at.z + q.z);
  }
  if (!isFinite(x0)) return { x0: -0.5, z0: -0.5, x1: 0.5, z1: 0.5 };
  return { x0: Math.min(x0, -0.5), z0: Math.min(z0, -0.5), x1: Math.max(x1, 0.5), z1: Math.max(z1, 0.5) };
}
