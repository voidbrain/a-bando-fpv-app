import { edgesOf, type Pt } from './footprint';
import { outlineOf } from './openings';
import type { BuildingSpec } from './site-spec';

/**
 * Helping the eye while placing indoor elements. Everything is in the building's own axes (the main orientation of the
 * building: x along its length, z along its width) and in the min-corner frame, like partitions, voids and columns.
 * A column snaps to: the same x / z as another column, equal spacing between two columns, the rhythm of two columns
 * continued, else a 0.5 m grid. The result lists the guide lines and distance labels to draw.
 */
export interface GuideLine {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** 'align' = same line as another column, 'equal' = between two columns at equal spacing. */
  kind: 'align' | 'equal';
}

export interface GuideLabel {
  x: number;
  z: number;
  text: string;
  /** 'dist' = to another column, 'wall' = to the nearest wall, 'equal' = equal spacing (highlighted). */
  kind: 'dist' | 'wall' | 'equal';
}

export interface Placement {
  x: number;
  z: number;
  /** Inside the building, outside every void, not on top of another column. */
  valid: boolean;
  guides: GuideLine[];
  labels: GuideLabel[];
  /** What it snapped to, for a hint: 'grid', 'align', 'equal', 'rhythm'. */
  snapped: { x: string; z: string };
  /** Door / window previews: the opening as a segment on its wall. */
  seg?: { x0: number; z0: number; x1: number; z1: number; kind: 'door' | 'window' };
}

const ROW = 0.2; // columns within this of a line are "on" it
const r2 = (v: number): number => Math.round(v * 100) / 100;
const grid = (v: number, g: number): number => Math.round(v / g) * g;

/** Candidate positions along one axis for a point whose coordinate on the other axis is already fixed. */
function candidates(coords: number[], raw: number, tol: number): { v: number; kind: 'align' | 'equal' | 'rhythm' }[] {
  const out: { v: number; kind: 'align' | 'equal' | 'rhythm' }[] = [];
  const sorted = [...coords].sort((a, b) => a - b);
  const left = sorted.filter((c) => c < raw - 1e-6), right = sorted.filter((c) => c > raw + 1e-6);
  if (left.length && right.length) out.push({ v: (left[left.length - 1]! + right[0]!) / 2, kind: 'equal' });
  if (left.length >= 2) out.push({ v: 2 * left[left.length - 1]! - left[left.length - 2]!, kind: 'rhythm' });
  if (right.length >= 2) out.push({ v: 2 * right[0]! - right[1]!, kind: 'rhythm' });
  return out.filter((c) => Math.abs(c.v - raw) <= tol);
}

/** Distance from (x, z) to the outline along a direction (min-corner frame); null when no wall is hit. */
function ray(b: BuildingSpec, x: number, z: number, dx: number, dz: number): number | null {
  const L = b.length / 2, W = b.width / 2;
  const px = x - L, pz = z - W;
  let best: number | null = null;
  for (const e of edgesOf(outlineOf(b))) {
    if (dx !== 0 && e.axis === 'z') {
      const t = (e.at - px) * dx;
      if (t > 1e-6 && pz >= e.from - 1e-6 && pz <= e.to + 1e-6 && (best === null || t < best)) best = t;
    } else if (dz !== 0 && e.axis === 'x') {
      const t = (e.at - pz) * dz;
      if (t > 1e-6 && px >= e.from - 1e-6 && px <= e.to + 1e-6 && (best === null || t < best)) best = t;
    }
  }
  return best;
}

export function placeColumn(b: BuildingSpec, li: number, raw: Pt, o: { ignore?: number; tol?: number; grid?: number } = {}): Placement {
  const lev = b.levels[li];
  const cols = (lev?.columns ?? []).filter((_, i) => i !== o.ignore);
  const tol = o.tol ?? 0.3, g = o.grid ?? 0.5;
  const snapped = { x: 'grid', z: 'grid' };

  // 1. z: align with another column's z (a horizontal row), else the grid
  let z = grid(raw.z, g);
  const zAlign = cols.map((c) => c.z).filter((v) => Math.abs(v - raw.z) <= tol).sort((a, c) => Math.abs(a - raw.z) - Math.abs(c - raw.z))[0];
  if (zAlign !== undefined) { z = zAlign; snapped.z = 'align'; }

  // 2. x: the row of columns at that z gives equal spacing / rhythm; any column's x gives a vertical alignment
  const row = cols.filter((c) => Math.abs(c.z - z) < ROW).map((c) => c.x);
  const xOpts: { v: number; kind: 'align' | 'equal' | 'rhythm' }[] = [...candidates(row, raw.x, tol)];
  for (const c of cols) if (Math.abs(c.x - raw.x) <= tol) xOpts.push({ v: c.x, kind: 'align' });
  xOpts.sort((a, c) => Math.abs(a.v - raw.x) - Math.abs(c.v - raw.x));
  let x = grid(raw.x, g);
  if (xOpts[0]) { x = xOpts[0].v; snapped.x = xOpts[0].kind; }

  // 3. z again, now that x is known: equal spacing / rhythm up and down the line of columns at that x
  if (snapped.z === 'grid') {
    const line = cols.filter((c) => Math.abs(c.x - x) < ROW).map((c) => c.z);
    const zOpts = candidates(line, raw.z, tol).sort((a, c) => Math.abs(a.v - raw.z) - Math.abs(c.v - raw.z));
    if (zOpts[0]) { z = zOpts[0].v; snapped.z = zOpts[0].kind; }
  }
  x = r2(x);
  z = r2(z);

  // validity
  const inVoid = (lev?.voids ?? []).some((v) => x > Math.min(v.x0, v.x1) && x < Math.max(v.x0, v.x1) && z > Math.min(v.z0, v.z1) && z < Math.max(v.z0, v.z1));
  const inside = ray(b, x, z, 1, 0) !== null && ray(b, x, z, -1, 0) !== null && ray(b, x, z, 0, 1) !== null && ray(b, x, z, 0, -1) !== null;
  const onColumn = cols.some((c) => Math.hypot(c.x - x, c.z - z) < 0.3);
  const guides: GuideLine[] = [];
  const labels: GuideLabel[] = [];

  // alignment lines through the columns that share x or z with the new one
  const sameZ = cols.filter((c) => Math.abs(c.z - z) < ROW);
  if (sameZ.length) {
    const xs = [x, ...sameZ.map((c) => c.x)];
    guides.push({ x0: Math.min(...xs), z0: z, x1: Math.max(...xs), z1: z, kind: snapped.x === 'equal' ? 'equal' : 'align' });
  }
  const sameX = cols.filter((c) => Math.abs(c.x - x) < ROW);
  if (sameX.length) {
    const zs = [z, ...sameX.map((c) => c.z)];
    guides.push({ x0: x, z0: Math.min(...zs), x1: x, z1: Math.max(...zs), kind: snapped.z === 'equal' ? 'equal' : 'align' });
  }

  // distances to the neighbours on each side along the row / the line
  const side = (vals: number[], at: number): { lo: number | null; hi: number | null } => {
    const lo = vals.filter((v) => v < at - 1e-6).sort((a, c) => c - a)[0];
    const hi = vals.filter((v) => v > at + 1e-6).sort((a, c) => a - c)[0];
    return { lo: lo ?? null, hi: hi ?? null };
  };
  const rowSide = side(sameZ.map((c) => c.x), x);
  const lineSide = side(sameX.map((c) => c.z), z);
  const eq = (a: number | null, c: number | null): boolean => a !== null && c !== null && Math.abs((x - a) - (c - x)) < 0.06;
  const rowEq = eq(rowSide.lo, rowSide.hi), lineEq = (lineSide.lo !== null && lineSide.hi !== null && Math.abs((z - lineSide.lo) - (lineSide.hi - z)) < 0.06);
  if (rowSide.lo !== null) labels.push({ x: (rowSide.lo + x) / 2, z, text: `${r2(x - rowSide.lo)} m`, kind: rowEq ? 'equal' : 'dist' });
  if (rowSide.hi !== null) labels.push({ x: (rowSide.hi + x) / 2, z, text: `${r2(rowSide.hi - x)} m`, kind: rowEq ? 'equal' : 'dist' });
  if (lineSide.lo !== null) labels.push({ x, z: (lineSide.lo + z) / 2, text: `${r2(z - lineSide.lo)} m`, kind: lineEq ? 'equal' : 'dist' });
  if (lineSide.hi !== null) labels.push({ x, z: (lineSide.hi + z) / 2, text: `${r2(lineSide.hi - z)} m`, kind: lineEq ? 'equal' : 'dist' });

  // distances to the nearest walls, in the four axis directions (dim, so they do not compete with the column spacing)
  if (inside) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const d = ray(b, x, z, dx, dz);
      if (d !== null && d > 0.15) labels.push({ x: x + (dx * d) / 2, z: z + (dz * d) / 2, text: `${r2(d)} m`, kind: 'wall' });
    }
  }
  return { x, z, valid: inside && !inVoid && !onColumn, guides, labels, snapped };
}
