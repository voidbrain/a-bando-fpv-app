import type { BuildingSpec, ColumnSpec, SiteSpec, StructureSpec, TreeSpec } from './site-spec';
import { contains } from './footprint';
import { outlineOf } from './openings';

export type Pt = { x: number; z: number };

/** Convex hull (Andrew's monotone chain), counter-clockwise in x / z. */
export function convexHull(pts: readonly Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.z - b.z);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export interface TreeZone {
  /** Indices into `spec.trees`. */
  idx: number[];
  x: number;
  z: number;
  /** Outline of the zone (hull of the crowns), for drawing it on the map. */
  hull: Pt[];
  /** Rough diameter in metres. */
  size: number;
}

/**
 * Trees that stand close together are one zone: a brush stroke or a filled area stays whole however big it is.
 * Two trees are linked when they are closer than `link` metres (single linkage, grid-hashed so it stays fast with thousands).
 */
export function treeZones(trees: readonly TreeSpec[], link = 14): TreeZone[] {
  const parent = trees.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const grid = new Map<string, number[]>();
  const key = (cx: number, cz: number): string => `${cx}/${cz}`;
  trees.forEach((t, i) => {
    const cx = Math.floor(t.x / link), cz = Math.floor(t.z / link);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const j of grid.get(key(cx + dx, cz + dz)) ?? []) {
          if (Math.hypot(trees[j]!.x - t.x, trees[j]!.z - t.z) <= link) parent[find(i)] = find(j);
        }
      }
    }
    const k = key(cx, cz);
    const cell = grid.get(k);
    if (cell) cell.push(i);
    else grid.set(k, [i]);
  });
  const groups = new Map<number, number[]>();
  trees.forEach((_, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  });
  return [...groups.values()]
    .map((idx): TreeZone => {
      const pts: Pt[] = [];
      for (const i of idx) {
        const t = trees[i]!;
        for (let k = 0; k < 8; k++) pts.push({ x: t.x + Math.cos((k * Math.PI) / 4) * t.r, z: t.z + Math.sin((k * Math.PI) / 4) * t.r });
      }
      const hull = convexHull(pts);
      const xs = hull.map((q) => q.x), zs = hull.map((q) => q.z);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      return { idx, x: (x0 + x1) / 2, z: (z0 + z1) / 2, hull, size: Math.max(x1 - x0, z1 - z0, 8) };
    })
    .sort((a, b) => b.idx.length - a.idx.length);
}

export interface ColumnGroup {
  /** 'x': a row running along x (same z); 'z': a row running along z; 'loose': columns that are not in a line with others. */
  axis: 'x' | 'z' | 'loose';
  /** The shared coordinate of the row (building-local, from the min corner), NaN for loose ones. */
  at: number;
  /** Indices into the floor's `columns`, in order along the row. */
  idx: number[];
}

/** Columns of one floor grouped per row: along whichever direction gives fewer rows; stragglers go to one "loose" group. */
export function columnGroups(cols: readonly ColumnSpec[], tol = 0.6): ColumnGroup[] {
  const rows = (k: 'x' | 'z'): number[][] => {
    const other = k === 'x' ? 'z' : 'x';
    const order = cols.map((_, i) => i).sort((a, b) => cols[a]![other] - cols[b]![other] || cols[a]![k] - cols[b]![k]);
    const out: number[][] = [];
    for (const i of order) {
      const last = out[out.length - 1];
      if (last && Math.abs(cols[last[0]!]![other] - cols[i]![other]) <= tol) last.push(i);
      else out.push([i]);
    }
    return out.map((r) => r.sort((a, b) => cols[a]![k] - cols[b]![k]));
  };
  const byZ = rows('x'), byX = rows('z');
  const pick = byZ.length <= byX.length ? { axis: 'x' as const, list: byZ, other: 'z' as const } : { axis: 'z' as const, list: byX, other: 'x' as const };
  const lines = pick.list.filter((r) => r.length > 1);
  const loose = pick.list.filter((r) => r.length === 1).map((r) => r[0]!);
  const out: ColumnGroup[] = lines.map((r) => ({ axis: pick.axis, at: cols[r[0]!]![pick.other], idx: r }));
  if (loose.length) out.push({ axis: 'loose', at: NaN, idx: loose });
  return out.sort((a, b) => (isNaN(a.at) ? 1 : isNaN(b.at) ? -1 : a.at - b.at));
}

/** The stairs and ramps standing inside a building's outline, with the floor each one starts on. */
export function stairsIn(spec: SiteSpec, b: BuildingSpec): { i: number; s: StructureSpec; level: number }[] {
  const poly = outlineOf(b);
  const a = (b.rotDeg * Math.PI) / 180;
  const out: { i: number; s: StructureSpec; level: number }[] = [];
  (spec.structures ?? []).forEach((s, i) => {
    if (s.kind !== 'stairs' && s.kind !== 'ramp') return;
    const dx = s.x - b.pos.x, dz = s.z - b.pos.z;
    if (!contains(poly, dx * Math.cos(a) + dz * Math.sin(a), -dx * Math.sin(a) + dz * Math.cos(a))) return;
    let level = 0, best = Infinity;
    b.levels.forEach((l, li) => {
      const d = Math.abs(l.baseY - (s.y ?? 0));
      if (d < best) { best = d; level = li; }
    });
    out.push({ i, s, level });
  });
  return out;
}

/**
 * The columns standing in line with column `i` on its floor: `x` = the row running east–west (same z), `z` = the line
 * running north–south (same x), `grid` = every column of the same size and shape (the module it was repeated from).
 */
export function columnsInLine(cols: readonly ColumnSpec[], i: number, along: 'x' | 'z' | 'grid', tol = 0.6): number[] {
  const c = cols[i];
  if (!c) return [];
  const out: number[] = [];
  cols.forEach((o, k) => {
    const hit =
      along === 'x' ? Math.abs(o.z - c.z) <= tol : along === 'z' ? Math.abs(o.x - c.x) <= tol : Math.abs(o.size - c.size) < 0.01 && !!o.round === !!c.round;
    if (hit) out.push(k);
  });
  return out;
}

/** Indices of the points inside a selection outline (a box's four corners or a hand-drawn lasso). */
export function pointsInside<T extends { x: number; z: number }>(pts: readonly T[], outline: readonly { x: number; z: number }[]): number[] {
  if (outline.length < 3) return [];
  const poly = outline.map((p) => ({ x: p.x, z: p.z }));
  const out: number[] = [];
  pts.forEach((p, i) => {
    if (contains(poly, p.x, p.z)) out.push(i);
  });
  return out;
}
