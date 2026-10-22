import { contains } from './footprint';
import { insideBuilding } from './openings';
import type { BuildingSpec, TreeSpec } from './site-spec';

export type Pt = { x: number; z: number };
export type ScatterMode = 'pen' | 'rect' | 'circle' | 'lasso';

/** Small seedable random numbers, so a brush stroke gives the same trees in tests (and Math.random in the app). */
export const mulberry = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export interface ScatterOpts {
  /** Average distance between trees, metres. Default 5. */
  spacing?: number;
  /** Pen: width of the stroke, metres. Default 8. */
  width?: number;
  /** Trees (existing or new) are never closer than this fraction of `spacing`. Default 0.7. */
  minGap?: number;
  /** Share of conifers, 0..1. Default 0.3. */
  conifers?: number;
  /** Hard cap per stroke so a huge area cannot freeze the page. Default 400. */
  max?: number;
  rng?: () => number;
}

/** The outline a mode's drag points describe: pen = a ribbon around the path, rect / circle = from two points, lasso = the closed loop. */
export function areaOf(mode: ScatterMode, pts: Pt[], width = 8): Pt[] {
  if (pts.length < 2) return [];
  if (mode === 'rect') {
    const [a, b] = [pts[0]!, pts[pts.length - 1]!];
    return [{ x: a.x, z: a.z }, { x: b.x, z: a.z }, { x: b.x, z: b.z }, { x: a.x, z: b.z }];
  }
  if (mode === 'circle') {
    const c = pts[0]!, e = pts[pts.length - 1]!;
    const r = Math.hypot(e.x - c.x, e.z - c.z);
    return Array.from({ length: 32 }, (_, i) => ({ x: c.x + r * Math.cos((i / 32) * Math.PI * 2), z: c.z + r * Math.sin((i / 32) * Math.PI * 2) }));
  }
  if (mode === 'lasso') return pts.length >= 3 ? pts : [];
  // pen: offset the path to both sides
  const half = width / 2, left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[Math.max(0, i - 1)]!, q = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l;
    left.push({ x: pts[i]!.x + nx * half, z: pts[i]!.z + nz * half });
    right.push({ x: pts[i]!.x - nx * half, z: pts[i]!.z - nz * half });
  }
  return [...left, ...right.reverse()];
}

const bounds = (poly: Pt[]): [number, number, number, number] => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z);
  }
  return [x0, z0, x1, z1];
};

/** Is the point inside a building, or within `margin` metres of one? (Trees do not grow through walls.) */
export function nearBuilding(buildings: BuildingSpec[], p: Pt, margin = 2): boolean {
  return buildings.some((b) => {
    const a = (-b.rotDeg * Math.PI) / 180;
    const dx = p.x - b.pos.x, dz = p.z - b.pos.z;
    const lx = dx * Math.cos(a) - dz * Math.sin(a), lz = dx * Math.sin(a) + dz * Math.cos(a);
    return [[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin]].some(([ox, oz]) => insideBuilding(b, { x: lx + ox!, z: lz + oz! }));
  });
}

/**
 * Random trees inside an outline: dart throwing, so they look natural (uneven) but never overlap. `existing` trees and
 * anything `blocked` says no to are respected. Sizes and species vary a little.
 */
export function scatterTrees(poly: Pt[], existing: readonly TreeSpec[], o: ScatterOpts = {}, blocked?: (p: Pt) => boolean): TreeSpec[] {
  if (poly.length < 3) return [];
  const rng = o.rng ?? Math.random;
  const spacing = Math.max(1.5, o.spacing ?? 5);
  const gap = spacing * (o.minGap ?? 0.7);
  const max = o.max ?? 400;
  const [x0, z0, x1, z1] = bounds(poly);
  const area = (x1 - x0) * (z1 - z0);
  const tries = Math.min(20000, Math.ceil((area / (spacing * spacing)) * 6) + 20);
  const out: TreeSpec[] = [];
  for (let i = 0; i < tries && out.length < max; i++) {
    const p = { x: x0 + rng() * (x1 - x0), z: z0 + rng() * (z1 - z0) };
    if (!contains(poly, p.x, p.z)) continue;
    if (blocked?.(p)) continue;
    if (existing.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < Math.max(gap, t.r + 0.5))) continue;
    if (out.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < gap)) continue;
    const conifer = rng() < (o.conifers ?? 0.3);
    const h = conifer ? 7 + rng() * 6 : 5 + rng() * 6;
    out.push({ x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, h: Math.round(h * 10) / 10, r: Math.round((conifer ? 1.3 + rng() * 0.9 : 1.8 + rng() * 1.4) * 10) / 10, kind: conifer ? 'c' : 'd' });
  }
  return out;
}
