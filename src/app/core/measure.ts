import { outlineOf } from './openings';
import type { SiteSpec } from './site-spec';

export type Pt = { x: number; z: number };
export interface Seg { a: Pt; b: Pt }
export interface Snap { pt: Pt; kind: string }

const rad = (d: number): number => (d * Math.PI) / 180;

/** A building's local point (metres from its centre) in world coordinates. */
export const toWorldPt = (b: { pos: Pt; rotDeg: number }, p: Pt): Pt => {
  const a = rad(b.rotDeg);
  return { x: b.pos.x + p.x * Math.cos(a) - p.z * Math.sin(a), z: b.pos.z + p.x * Math.sin(a) + p.z * Math.cos(a) };
};

/** Every point the measure tool (and other aids) may magnetise to: corners, wall middles, columns, trees, structures, wall ends, other measures. */
export function snapTargets(spec: SiteSpec, segs: readonly Seg[] = []): Snap[] {
  const out: Snap[] = [];
  for (const b of spec.buildings) {
    const poly = outlineOf(b);
    poly.forEach((q, i) => {
      out.push({ pt: toWorldPt(b, q), kind: 'corner' });
      const n = poly[(i + 1) % poly.length]!;
      out.push({ pt: toWorldPt(b, { x: (q.x + n.x) / 2, z: (q.z + n.z) / 2 }), kind: 'wall middle' });
    });
    for (const l of b.levels) for (const c of l.columns ?? []) out.push({ pt: toWorldPt(b, { x: c.x - b.length / 2, z: c.z - b.width / 2 }), kind: 'column' });
  }
  for (const t of spec.trees) out.push({ pt: { x: t.x, z: t.z }, kind: 'tree' });
  for (const s of spec.structures ?? []) out.push({ pt: { x: s.x, z: s.z }, kind: 'structure' });
  for (const w of spec.walls ?? []) out.push({ pt: w.a, kind: 'wall end' }, { pt: w.b, kind: 'wall end' });
  out.push({ pt: spec.droneStart, kind: 'start' });
  for (const s of segs) out.push({ pt: s.a, kind: 'measure' }, { pt: s.b, kind: 'measure' });
  return out;
}

/** The nearest target within `radius` metres (the magnet), or null. */
export function nearestSnap(targets: readonly Snap[], p: Pt, radius: number): Snap | null {
  let best: Snap | null = null, bd = radius;
  for (const t of targets) {
    const d = Math.hypot(t.pt.x - p.x, t.pt.z - p.z);
    if (d <= bd) { bd = d; best = t; }
  }
  return best;
}

/** Straighten a line from `a` to `p` when it is within `tol` degrees of a multiple of 90° from `axisDeg` (the building axes). */
export function orthoSnap(a: Pt, p: Pt, axisDeg = 0, tol = 3): Pt {
  const len = Math.hypot(p.x - a.x, p.z - a.z);
  if (len < 0.01) return p;
  const ang = (Math.atan2(p.z - a.z, p.x - a.x) * 180) / Math.PI - axisDeg;
  const k = Math.round(ang / 90) * 90;
  if (Math.abs(ang - k) > tol) return p;
  const r = rad(k + axisDeg);
  return { x: a.x + Math.cos(r) * len, z: a.z + Math.sin(r) * len };
}

export const lengthOf = (s: Seg): number => Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
export const fmtLength = (d: number): string => (d >= 1000 ? `${(d / 1000).toFixed(2)} km` : `${d.toFixed(d < 10 ? 2 : 1)} m`);

/** Angles (degrees, 0..180) between every two measures that share an end point, with where they meet and the direction (radians) of each arm. */
export function anglesAt(segs: readonly Seg[], tol = 0.05): { at: Pt; deg: number; i: number; j: number; d1: number; d2: number }[] {
  const out: { at: Pt; deg: number; i: number; j: number; d1: number; d2: number }[] = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      for (const pa of [segs[i]!.a, segs[i]!.b]) {
        for (const pb of [segs[j]!.a, segs[j]!.b]) {
          if (Math.hypot(pa.x - pb.x, pa.z - pb.z) > tol) continue;
          const fi = Math.hypot(segs[i]!.a.x - pa.x, segs[i]!.a.z - pa.z) < tol ? segs[i]!.b : segs[i]!.a;
          const fj = Math.hypot(segs[j]!.a.x - pb.x, segs[j]!.a.z - pb.z) < tol ? segs[j]!.b : segs[j]!.a;
          const v1 = { x: fi.x - pa.x, z: fi.z - pa.z }, v2 = { x: fj.x - pb.x, z: fj.z - pb.z };
          const l = Math.hypot(v1.x, v1.z) * Math.hypot(v2.x, v2.z);
          if (l < 1e-6) continue;
          const c = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.z * v2.z) / l));
          out.push({ at: pa, deg: (Math.acos(c) * 180) / Math.PI, i, j, d1: Math.atan2(v1.z, v1.x), d2: Math.atan2(v2.z, v2.x) });
        }
      }
    }
  }
  return out;
}

/**
 * SVG path of the arc that marks an angle: from arm 1 to arm 2 the short way round, radius `r`, plus the point
 * (on the bisector) where its label goes. Plan coordinates: x right, z down, so the sweep flag follows the sign of the turn.
 */
export function arcOf(at: Pt, d1: number, d2: number, r: number): { path: string; label: Pt } {
  let diff = d2 - d1;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff <= -Math.PI) diff += 2 * Math.PI;
  const s = { x: at.x + r * Math.cos(d1), z: at.z + r * Math.sin(d1) };
  const e = { x: at.x + r * Math.cos(d2), z: at.z + r * Math.sin(d2) };
  const mid = d1 + diff / 2;
  const lr = r * 0.62;
  return { path: `M ${s.x} ${s.z} A ${r} ${r} 0 0 ${diff > 0 ? 1 : 0} ${e.x} ${e.z}`, label: { x: at.x + lr * Math.cos(mid), z: at.z + lr * Math.sin(mid) } };
}

/**
 * A measure over the terrain: the height difference from A to B and the length along the ground (sampled every metre or
 * so), next to the straight plan length. `heightAt` = the ground height (0 everywhere on flat ground).
 */
export function groundProfile(s: Seg, heightAt: (x: number, z: number) => number): { dh: number; along: number; flat: number } {
  const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, flat = Math.hypot(dx, dz);
  const n = Math.max(1, Math.min(400, Math.ceil(flat)));
  let along = 0, prev = heightAt(s.a.x, s.a.z);
  for (let i = 1; i <= n; i++) {
    const y = heightAt(s.a.x + (dx * i) / n, s.a.z + (dz * i) / n);
    along += Math.hypot(flat / n, y - prev);
    prev = y;
  }
  return { dh: prev - heightAt(s.a.x, s.a.z), along, flat };
}
