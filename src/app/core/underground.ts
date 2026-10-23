/**
 * Underground volumes (tunnels, culverts, bunkers): the one rule is that the terrain is cut wherever it passes through
 * the inside of a volume, between its floor and its ceiling. Pure: where the ground is cut, where the floor is under a
 * point, and the collision boxes of the walls and slabs.
 */
import { insidePolygon } from './layers';
import type { BuildingSpec, UndergroundSpec, Vec2 } from './site-spec';
import { heightAt, type HeightGrid } from './terrain';
import type { SolidBox } from './sim/collider';

/** The outline of a straight tunnel from `a` to `b`, `width` metres wide: [a-left, b-left, b-right, a-right]. */
export function tunnelOutline(a: Vec2, b: Vec2, width: number): Vec2[] {
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
  const nx = (-dz / len) * (width / 2), nz = (dx / len) * (width / 2);
  return [
    { x: a.x + nx, z: a.z + nz },
    { x: b.x + nx, z: b.z + nz },
    { x: b.x - nx, z: b.z - nz },
    { x: a.x - nx, z: a.z - nz },
  ];
}

/** One flag per grid vertex: 1 = the ground there is cut (a portal or an open trench). */
export function cutMask(g: HeightGrid, vols: readonly UndergroundSpec[]): Uint8Array {
  const m = new Uint8Array(g.nx * g.nz);
  if (!vols.length) return m;
  for (const v of vols) {
    const xs = v.outline.map((p) => p.x), zs = v.outline.map((p) => p.z);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - g.x0) / g.cell)), i1 = Math.min(g.nx - 1, Math.ceil((Math.max(...xs) - g.x0) / g.cell));
    const j0 = Math.max(0, Math.floor((Math.min(...zs) - g.z0) / g.cell)), j1 = Math.min(g.nz - 1, Math.ceil((Math.max(...zs) - g.z0) / g.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * g.nx + i, h = g.h[k]!;
        if (h > v.floor && h < v.ceiling + v.wall && insidePolygon(v.outline, g.x0 + i * g.cell, g.z0 + j * g.cell)) m[k] = 1;
      }
    }
  }
  return m;
}

/**
 * The floor a point stands on: inside a volume and below its ceiling, that volume's floor (a tunnel under a hill);
 * otherwise null (the terrain decides).
 */
export function floorUnder(vols: readonly UndergroundSpec[], x: number, z: number, y: number): number | null {
  for (const v of vols) if (y < v.ceiling && y > v.floor - v.wall - 0.5 && insidePolygon(v.outline, x, z)) return v.floor + (v.water ?? 0);
  return null;
}

/** Collision boxes of a volume: its walls along every edge, cut into ~1 m pieces, and floor / ceiling slabs in ~2 m tiles. */
export function volumeSolids(v: UndergroundSpec): SolidBox[] {
  const out: SolidBox[] = [];
  const t = v.wall, y0 = v.floor - t, y1 = v.ceiling + t;
  for (let i = 0; i < v.outline.length; i++) {
    const a = v.outline[i]!, b = v.outline[(i + 1) % v.outline.length]!;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const n = Math.max(1, Math.ceil(len));
    const ca = Math.abs(dx / len), sa = Math.abs(dz / len), seg = len / n;
    const hw = (seg * ca + t * sa) / 2, hd = (seg * sa + t * ca) / 2;
    for (let k = 0; k < n; k++) {
      const cx = a.x + (dx * (k + 0.5)) / n, cz = a.z + (dz * (k + 0.5)) / n;
      out.push([cx - hw, cx + hw, y0, y1, cz - hd, cz + hd, false]);
    }
  }
  const xs = v.outline.map((p) => p.x), zs = v.outline.map((p) => p.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  for (let x = x0; x < x1; x += 2) {
    for (let z = z0; z < z1; z += 2) {
      if (!insidePolygon(v.outline, x + 1, z + 1)) continue;
      out.push([x, Math.min(x + 2, x1), v.floor - t, v.floor, z, Math.min(z + 2, z1), false]);
      out.push([x, Math.min(x + 2, x1), v.ceiling, v.ceiling + t, z, Math.min(z + 2, z1), false]);
    }
  }
  return out;
}

/** A tunnel's axis (for drawing pipes and vaults): from the middle of its first end to the middle of the other, and its width. */
export function tunnelAxis(v: UndergroundSpec): { a: Vec2; b: Vec2; width: number } | null {
  if (v.outline.length !== 4) return null;
  const [p0, p1, p2, p3] = v.outline as [Vec2, Vec2, Vec2, Vec2];
  const mid = (p: Vec2, q: Vec2): Vec2 => ({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 });
  const d01 = Math.hypot(p1.x - p0.x, p1.z - p0.z), d03 = Math.hypot(p3.x - p0.x, p3.z - p0.z);
  // the axis runs along the longer side (a tunnel is longer than wide; a room drawn either way)
  return d01 >= d03 ? { a: mid(p0, p3), b: mid(p1, p2), width: d03 } : { a: mid(p0, p1), b: mid(p3, p2), width: d01 };
}

/** A new tunnel `depth` metres below the ground at its start, `height` metres tall inside. */
export function newTunnel(g: HeightGrid | null, a: Vec2, b: Vec2, o: { width: number; height: number; depth: number; shape: UndergroundSpec['shape']; id: string; name: string }): UndergroundSpec {
  const floor = Math.round((heightAt(g, a.x, a.z) - o.depth) * 10) / 10;
  return { id: o.id, name: o.name, outline: tunnelOutline(a, b, o.width), floor, ceiling: floor + o.height, shape: o.shape, wall: 0.4 };
}

/** Wall and slab thickness of basements. */
export const BASEMENT_WALL = 0.3;

/**
 * A building's basement as an underground volume under its outline (`outline` in site metres, `ground` = the height of
 * its levelled pad): the terrain inside is cut, the drone inside stands on the basement floor. Null without a basement.
 */
export function basementVolume(b: BuildingSpec, outline: Vec2[], ground: number): UndergroundSpec | null {
  if (!b.basement || b.frame) return null;
  const h = Math.min(12, Math.max(2, b.basement.height));
  return { id: `basement-${b.id}`, name: `${b.name} basement`, outline, floor: ground - h, ceiling: ground, shape: 'box', wall: BASEMENT_WALL };
}

/**
 * The side view along a volume: its axis (a straight tunnel's centre line, else the long middle line of its outline),
 * the ground height every few metres along it, and its floor / ceiling. For the inspector's section drawing.
 */
export function sectionProfile(v: UndergroundSpec, at: (x: number, z: number) => number, samples = 60): { len: number; ground: number[]; floor: number; ceiling: number; wall: number } {
  let a: Vec2, b: Vec2;
  const ax = tunnelAxis(v);
  if (ax) ({ a, b } = ax);
  else {
    const xs = v.outline.map((p) => p.x), zs = v.outline.map((p) => p.z);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    if (x1 - x0 >= z1 - z0) [a, b] = [{ x: x0, z: (z0 + z1) / 2 }, { x: x1, z: (z0 + z1) / 2 }];
    else [a, b] = [{ x: (x0 + x1) / 2, z: z0 }, { x: (x0 + x1) / 2, z: z1 }];
  }
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  // a little ground either side of the ends, so the mouths show
  const pad = Math.min(15, len * 0.2), ux = (b.x - a.x) / (len || 1), uz = (b.z - a.z) / (len || 1);
  const ground: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = -pad + ((len + 2 * pad) * i) / samples;
    ground.push(at(a.x + ux * t, a.z + uz * t));
  }
  return { len: len + 2 * pad, ground, floor: v.floor, ceiling: v.ceiling, wall: v.wall };
}
