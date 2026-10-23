/**
 * The ground layers: roads (centre lines that level the ground across their width), surfaces (what the ground is made
 * of) and water (dug basins with a flat surface). Seeded from OpenStreetMap, edited like everything else. Pure.
 */
import type { PadSpec, RoadKind, RoadSpec, SiteSpec, SurfaceKind, UndergroundSpec, Vec2, WaterSpec } from './site-spec';
import { heightAt, type HeightGrid } from './terrain';

export interface RoadDef {
  id: RoadKind;
  label: string;
  width: number;
  color: string;
}
export const ROADS: readonly RoadDef[] = [
  { id: 'road', label: 'Road', width: 6, color: '#4a4d4b' },
  { id: 'track', label: 'Track', width: 3.5, color: '#9a8566' },
  { id: 'path', label: 'Path', width: 1.6, color: '#b8a888' },
  { id: 'rail', label: 'Railway', width: 3.2, color: '#5b5550' },
];
export const roadDef = (k: RoadKind | undefined): RoadDef => ROADS.find((r) => r.id === k) ?? ROADS[0]!;

export interface SurfaceDef {
  id: SurfaceKind;
  label: string;
  color: string;
}
export const SURFACES: readonly SurfaceDef[] = [
  { id: 'grass', label: 'Grass', color: '#7da356' },
  { id: 'asphalt', label: 'Asphalt', color: '#55595a' },
  { id: 'concrete', label: 'Concrete', color: '#a9aaa0' },
  { id: 'gravel', label: 'Gravel', color: '#b1a995' },
  { id: 'dirt', label: 'Dirt', color: '#9b7d57' },
  { id: 'sand', label: 'Sand', color: '#d8c592' },
  { id: 'rubble', label: 'Rubble', color: '#8f8777' },
];
export const surfaceDef = (k: SurfaceKind | undefined): SurfaceDef => SURFACES.find((s) => s.id === k) ?? SURFACES[0]!;
export const WATER_COLOR = '#3d86b6';

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const okPt = (p: unknown): p is Vec2 => !!p && typeof (p as Vec2).x === 'number' && typeof (p as Vec2).z === 'number' && isFinite((p as Vec2).x) && isFinite((p as Vec2).z);
const pts = (v: unknown, min: number): Vec2[] | null => {
  const a = Array.isArray(v) ? v.filter(okPt).slice(0, 2000).map((p) => ({ x: clamp(p.x, -2000, 2000), z: clamp(p.z, -2000, 2000) })) : [];
  return a.length >= min ? a : null;
};

/**
 * The layers of a stored spec, every value checked. A spec saved before roads existed has its roads as rotated pads:
 * those (all pads but the last, the take-off pad) become two-point roads.
 */
export function sanitizeLayers(s: Partial<SiteSpec>): Partial<Pick<SiteSpec, 'roads' | 'surfaces' | 'waters' | 'pads' | 'underground'>> {
  const out: Partial<Pick<SiteSpec, 'roads' | 'surfaces' | 'waters' | 'pads' | 'underground'>> = {};
  if (Array.isArray(s.roads)) {
    out.roads = s.roads.flatMap((r) => {
      const p = pts(r?.pts, 2);
      if (!p) return [];
      const kind = ROADS.some((d) => d.id === r.kind) ? r.kind : 'road';
      return [{ pts: p, kind, width: clamp(typeof r.width === 'number' && isFinite(r.width) ? r.width : roadDef(kind).width, 0.5, 40), ...(SURFACES.some((d) => d.id === r.surface) ? { surface: r.surface } : {}) }];
    });
  } else if (Array.isArray(s.pads) && s.pads.length > 1) {
    const { roads, pads } = padsToRoads(s.pads as PadSpec[]);
    out.roads = roads;
    out.pads = pads;
  }
  if (Array.isArray(s.surfaces)) {
    out.surfaces = s.surfaces.flatMap((v) => {
      const p = pts(v?.pts, 3);
      return p ? [{ pts: p, kind: surfaceDef(v.kind).id }] : [];
    });
  }
  if (Array.isArray(s.waters)) {
    out.waters = s.waters.flatMap((w) => {
      const p = pts(w?.pts, 3);
      return p ? [{ pts: p, depth: clamp(typeof w.depth === 'number' && isFinite(w.depth) ? w.depth : 1.5, 0.2, 20), ...(typeof w.level === 'number' && isFinite(w.level) ? { level: clamp(w.level, -10, 5) } : {}) }] : [];
    });
  }
  if (Array.isArray(s.underground)) {
    out.underground = s.underground.slice(0, 50).flatMap((u, i): UndergroundSpec[] => {
      const p = pts(u?.outline, 3);
      if (!p) return [];
      const floor = typeof u.floor === 'number' && isFinite(u.floor) ? clamp(u.floor, -200, 300) : -3;
      const ceiling = typeof u.ceiling === 'number' && isFinite(u.ceiling) ? clamp(u.ceiling, floor + 0.8, floor + 60) : floor + 3;
      const shape = u.shape === 'pipe' || u.shape === 'vault' ? u.shape : 'box';
      return [{
        id: typeof u.id === 'string' && u.id ? u.id : `ug-${i}`,
        name: typeof u.name === 'string' ? u.name.slice(0, 80) : 'Tunnel',
        outline: p.slice(0, 64),
        floor,
        ceiling,
        shape,
        wall: typeof u.wall === 'number' && isFinite(u.wall) ? clamp(u.wall, 0.1, 3) : 0.4,
        ...(typeof u.water === 'number' && isFinite(u.water) && u.water > 0 ? { water: clamp(u.water, 0, ceiling - floor) } : {}),
      }];
    });
  }
  return out;
}

/** Old roads (rotated pads, all but the last pad) as two-point roads; the take-off pad stays a pad. */
export function padsToRoads(pads: readonly PadSpec[]): { roads: RoadSpec[]; pads: PadSpec[] } {
  const start = pads[pads.length - 1];
  const roads = pads.slice(0, -1).map((p): RoadSpec => {
    const a = ((p.rotDeg ?? 0) * Math.PI) / 180, h = p.w / 2;
    return { pts: [{ x: p.x - Math.cos(a) * h, z: p.z - Math.sin(a) * h }, { x: p.x + Math.cos(a) * h, z: p.z + Math.sin(a) * h }], width: p.d, kind: 'road' };
  });
  return { roads, pads: start ? [start] : [] };
}

/** Distance from (x, z) to a polyline, and the parameter of the nearest point (segment index + fraction). */
export function nearestOnPath(path: readonly Vec2[], x: number, z: number): { d: number; at: Vec2 } {
  let best = { d: Infinity, at: path[0]! };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const t = l2 ? clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1) : 0;
    const q = { x: a.x + dx * t, z: a.z + dz * t };
    const d = Math.hypot(x - q.x, z - q.z);
    if (d < best.d) best = { d, at: q };
  }
  return best;
}

/** Every cell within `r` of a polyline / polygon bounding box. */
function cellsNear(g: HeightGrid, poly: readonly Vec2[], r: number, fn: (k: number, x: number, z: number) => void): void {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x - r); z0 = Math.min(z0, p.z - r); x1 = Math.max(x1, p.x + r); z1 = Math.max(z1, p.z + r);
  }
  const i0 = Math.max(0, Math.floor((x0 - g.x0) / g.cell)), i1 = Math.min(g.nx - 1, Math.ceil((x1 - g.x0) / g.cell));
  const j0 = Math.max(0, Math.floor((z0 - g.z0) / g.cell)), j1 = Math.min(g.nz - 1, Math.ceil((z1 - g.z0) / g.cell));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * g.nx + i, g.x0 + i * g.cell, g.z0 + j * g.cell);
}

export function insidePolygon(poly: readonly Vec2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Level the ground across a road: every cell within half its width takes the height of the nearest point of the
 * centre line (sampled before levelling), blending over 2 m beside it. Along the road the ground keeps its slope.
 */
export function levelRoad(g: HeightGrid, r: RoadSpec): void {
  if (r.pts.length < 2) return;
  const src = { ...g, h: g.h.slice() };
  const half = r.width / 2, blend = 2;
  cellsNear(g, r.pts, half + blend, (k, x, z) => {
    const n = nearestOnPath(r.pts, x, z);
    if (n.d > half + blend) return;
    const y = heightAt(src, n.at.x, n.at.z);
    const w = n.d <= half ? 1 : 1 - (n.d - half) / blend;
    g.h[k] = g.h[k]! + (y - g.h[k]!) * w;
  });
}

/** The water level of a basin: just below its lowest bank (the outline's lowest point), plus its own offset. */
export function waterLevel(g: HeightGrid | null, w: WaterSpec): number {
  const bank = Math.min(...w.pts.map((p) => heightAt(g, p.x, p.z)));
  return bank + (w.level ?? -0.3);
}

/** Dig the basin: inside the outline the ground goes down to `depth` below the water, sloping over the first 2 m. Returns the level. */
export function digWater(g: HeightGrid, w: WaterSpec): number {
  const level = waterLevel(g, w);
  const bed = level - w.depth;
  const ring = [...w.pts, w.pts[0]!];
  cellsNear(g, w.pts, 0, (k, x, z) => {
    if (!insidePolygon(w.pts, x, z)) return;
    const d = nearestOnPath(ring, x, z).d;
    const y = bed + (level - bed) * Math.max(0, 1 - d / 2) * 0.6;
    if (g.h[k]! > y) g.h[k] = y;
  });
  return level;
}

/** Simplify a hand-drawn line (Douglas-Peucker, `tol` metres) so a stroke stays a few dozen points. */
export function simplifyPath(p: readonly Vec2[], tol = 0.6): Vec2[] {
  if (p.length < 3) return [...p];
  let idx = 0, dmax = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const d = nearestOnPath([p[0]!, p[p.length - 1]!], p[i]!.x, p[i]!.z).d;
    if (d > dmax) {
      dmax = d;
      idx = i;
    }
  }
  if (dmax <= tol) return [p[0]!, p[p.length - 1]!];
  return [...simplifyPath(p.slice(0, idx + 1), tol).slice(0, -1), ...simplifyPath(p.slice(idx), tol)];
}

/** Area of a polygon (square metres, always positive). */
export function polygonArea(p: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i]!, r = p[(i + 1) % p.length]!;
    a += q.x * r.z - r.x * q.z;
  }
  return Math.abs(a) / 2;
}

/** The outline of a strip `width` wide along a centre line (a canal, a ditch): one side out, the other back. */
export function stripOutline(line: readonly Vec2[], width: number): Vec2[] {
  if (line.length < 2) return [];
  const half = width / 2;
  const side = (k: number): Vec2[] =>
    line.map((p, i) => {
      const a = line[Math.max(0, i - 1)]!, b = line[Math.min(line.length - 1, i + 1)]!;
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      return { x: p.x - (dz / l) * k * half, z: p.z + (dx / l) * k * half };
    });
  return [...side(1), ...side(-1).reverse()];
}

/**
 * One outline around overlapping polygons (two ponds drawn into each other, a canal and its basin): they are laid on
 * a grid of `cell` metres and the edge of the biggest connected area is traced, then simplified. Holes are filled.
 */
export function unionOutline(polys: readonly (readonly Vec2[])[], cell = 1): Vec2[] {
  const all = polys.flat();
  if (!all.length) return [];
  const x0 = Math.min(...all.map((p) => p.x)) - cell, z0 = Math.min(...all.map((p) => p.z)) - cell;
  const nx = Math.ceil((Math.max(...all.map((p) => p.x)) + cell - x0) / cell), nz = Math.ceil((Math.max(...all.map((p) => p.z)) + cell - z0) / cell);
  if (nx * nz > 4e6) return [...(polys[0] ?? [])]; // too big for the grid: keep the first as it is
  const inside = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell;
      if (polys.some((p) => p.length >= 3 && insidePolygon(p, x, z))) inside[j * nx + i] = 1;
    }
  const at = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < nx && j < nz && inside[j * nx + i] === 1;
  // boundary edges with the inside on their left, keyed by their start corner
  const next = new Map<number, number[]>();
  const key = (i: number, j: number): number => j * (nx + 1) + i;
  const add = (a: number, b: number): void => void (next.get(a) ?? next.set(a, []).get(a)!).push(b);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      if (!at(i, j)) continue;
      if (!at(i, j - 1)) add(key(i, j), key(i + 1, j));
      if (!at(i + 1, j)) add(key(i + 1, j), key(i + 1, j + 1));
      if (!at(i, j + 1)) add(key(i + 1, j + 1), key(i, j + 1));
      if (!at(i - 1, j)) add(key(i, j + 1), key(i, j));
    }
  let best: number[] = [];
  while (next.size) {
    const start = next.keys().next().value!;
    const loop: number[] = [];
    let v = start;
    for (let guard = 0; guard < nx * nz * 4; guard++) {
      const outs = next.get(v);
      if (!outs?.length) break;
      const w = outs.pop()!;
      if (!outs.length) next.delete(v);
      loop.push(v);
      v = w;
      if (v === start) break;
    }
    if (loop.length > best.length) best = loop;
  }
  const pts = best.map((k) => ({ x: x0 + (k % (nx + 1)) * cell, z: z0 + Math.floor(k / (nx + 1)) * cell }));
  return simplifyPath([...pts, pts[0]!], cell * 0.75).slice(0, -1);
}

/** Whether two polygons overlap or touch (a corner inside the other, or two edges crossing). */
export function polygonsTouch(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  if (a.some((p) => insidePolygon(b, p.x, p.z)) || b.some((p) => insidePolygon(a, p.x, p.z))) return true;
  const cross = (p: Vec2, q: Vec2, r: Vec2): number => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  for (let i = 0; i < a.length; i++) {
    const p1 = a[i]!, p2 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      const q1 = b[j]!, q2 = b[(j + 1) % b.length]!;
      if (cross(p1, p2, q1) * cross(p1, p2, q2) <= 0 && cross(q1, q2, p1) * cross(q1, q2, p2) <= 0) return true;
    }
  }
  return false;
}

/**
 * Merge water `i` with every water that overlaps it (one outline, the deepest depth, the first one's level). Returns
 * the merged list and the new index of the merged water, or null when nothing overlaps.
 */
export function mergeWaters(waters: readonly WaterSpec[], i: number): { waters: WaterSpec[]; index: number } | null {
  const w = waters[i];
  if (!w) return null;
  const others = waters.map((o, k) => ({ o, k })).filter(({ o, k }) => k !== i && polygonsTouch(w.pts, o.pts));
  if (!others.length) return null;
  const pts = unionOutline([w.pts, ...others.map((x) => x.o.pts)], 1);
  if (pts.length < 3) return null;
  const gone = new Set(others.map((x) => x.k));
  const merged: WaterSpec = { ...w, pts, depth: Math.max(w.depth, ...others.map((x) => x.o.depth)) };
  const out = waters.filter((_, k) => !gone.has(k)).map((o) => (o === w ? merged : o));
  return { waters: out, index: out.indexOf(merged) };
}
