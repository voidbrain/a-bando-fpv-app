/**
 * Terrain: a height grid over the site, rebuilt from the real ground (a cached base grid) plus the pilot's strokes.
 * Only the strokes and the base's provenance live in the spec (they are small and JSON-cloned on every edit); the base
 * heights live in a registry here, keyed by {@link TerrainBase.key}. Plain TypeScript, no three.js.
 *
 * Grid: vertices every `cell` metres from (-half.e, -half.n) to (+half.e, +half.n), row-major along x (east), rows
 * along z (south). Outside the grid the ground continues at the height of the nearest edge. A terrain made only of
 * strokes (no real ground) blends its last {@link FEATHER} metres back to y = 0, so the world around it stays flat; real
 * ground keeps its own heights to the edge (forcing a hillside down to the centre's height made walls and pits).
 */
import type { Vec2 } from './site-spec';

export type TerrainOp = 'raise' | 'lower' | 'smooth' | 'flatten' | 'hill' | 'crater' | 'ramp';
export type Falloff = 'smooth' | 'linear' | 'flat';

/** One edit. Brushes (raise / lower / smooth / flatten) sweep along `pts`; stamps use `pts[0]` (ramp: pts[0] → pts[1]). */
export interface TerrainStroke {
  op: TerrainOp;
  pts: Vec2[];
  radius: number;
  /** Brushes: metres raised / lowered (smooth: 0..1 blend). Stamps: height of the hill / depth of the crater / rise of the ramp. */
  strength: number;
  falloff?: Falloff;
  /** Flatten: target height. */
  height?: number;
}

/** Where the real ground came from; the heights are in the registry under `key`. */
export interface TerrainBase {
  /** `embedded`: the heights came inside a shared file (its place may be hidden): kept in the local cache only. */
  source: 'aws-terrarium' | 'flat' | 'embedded';
  key: string;
  fetchedAt: number;
  /** Real elevation (m above sea level) that maps to y = 0 (0 when the place is hidden). */
  datum: number;
  /** Only in a shared file: the heights themselves (see core/share.ts); moved to the cache on import. */
  data?: string;
}

export interface TerrainSpec {
  cell: number;
  half: { e: number; n: number };
  base?: TerrainBase;
  strokes: TerrainStroke[];
}

export interface HeightGrid {
  cell: number;
  x0: number;
  z0: number;
  nx: number;
  nz: number;
  h: Float32Array;
}

/** Plain rectangle on the ground to level (a building footprint, the take-off pad): corners in site metres. */
export interface FlatPad {
  poly: Vec2[];
  /** Leave the pad at this height; default: the lowest ground under it. */
  height?: number;
}

export const FEATHER = 20;
export const MAX_HALF = 300;
const OPS: readonly TerrainOp[] = ['raise', 'lower', 'smooth', 'flatten', 'hill', 'crater', 'ramp'];
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const num = (v: unknown, d: number, a: number, b: number): number => (typeof v === 'number' && isFinite(v) ? clamp(v, a, b) : d);

/** A fresh flat terrain covering the site (capped at 600 × 600 m). */
export function defaultTerrain(extent: number): TerrainSpec {
  const half = Math.round(clamp(extent, 60, MAX_HALF));
  return { cell: 1, half: { e: half, n: half }, strokes: [] };
}

/** Keep only what we understand, every number clamped (saved specs, AI output, shared files). */
export function sanitizeTerrain(raw: unknown): TerrainSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const t = raw as Partial<TerrainSpec>;
  const cell = num(t.cell, 1, 0.5, 4);
  const half = { e: num(t.half?.e, 200, 20, MAX_HALF), n: num(t.half?.n, 200, 20, MAX_HALF) };
  const b = t.base;
  const base: TerrainBase | undefined =
    b && typeof b.key === 'string' && (b.source === 'aws-terrarium' || b.source === 'flat' || b.source === 'embedded')
      ? { source: b.source, key: b.key.slice(0, 120), fetchedAt: num(b.fetchedAt, 0, 0, 1e15), datum: num(b.datum, 0, -500, 9000), ...(typeof b.data === 'string' && b.data.length < 4_000_000 ? { data: b.data } : {}) }
      : undefined;
  const strokes = (Array.isArray(t.strokes) ? t.strokes : [])
    .filter((s): s is TerrainStroke => !!s && OPS.includes(s.op) && Array.isArray(s.pts))
    .slice(0, 2000)
    .map((s) => ({
      op: s.op,
      pts: s.pts.filter((p) => p && isFinite(p.x) && isFinite(p.z)).slice(0, 4000).map((p) => ({ x: clamp(p.x, -1000, 1000), z: clamp(p.z, -1000, 1000) })),
      radius: num(s.radius, 5, 0.5, 200),
      strength: num(s.strength, 1, -100, 100),
      ...(s.falloff === 'linear' || s.falloff === 'flat' || s.falloff === 'smooth' ? { falloff: s.falloff } : {}),
      ...(typeof s.height === 'number' && isFinite(s.height) ? { height: clamp(s.height, -200, 500) } : {}),
    }))
    .filter((s) => s.pts.length > 0);
  return { cell, half, ...(base ? { base } : {}), strokes };
}

// ---- base registry ----------------------------------------------------------------------------------

const bases = new Map<string, Float32Array>();

/** Hand the real-ground heights (already on the terrain's grid, y relative to the datum) to the builder. */
export function setTerrainBase(key: string, h: Float32Array): void {
  bases.set(key, h);
}

export function hasTerrainBase(key: string): boolean {
  return bases.has(key);
}

/** The registered real-ground heights under `key` (to pack them into a shared file), or null. */
export function getTerrainBase(key: string): Float32Array | null {
  return bases.get(key) ?? null;
}

// ---- grid -------------------------------------------------------------------------------------------

export function emptyGrid(t: Pick<TerrainSpec, 'cell' | 'half'>): HeightGrid {
  const nx = Math.round((2 * t.half.e) / t.cell) + 1;
  const nz = Math.round((2 * t.half.n) / t.cell) + 1;
  return { cell: t.cell, x0: -t.half.e, z0: -t.half.n, nx, nz, h: new Float32Array(nx * nz) };
}

/** Ground height at (x, z), bilinear; outside the grid, the height of the nearest edge. */
export function heightAt(g: HeightGrid | null | undefined, x: number, z: number): number {
  if (!g) return 0;
  const fx = Math.min(g.nx - 1, Math.max(0, (x - g.x0) / g.cell)), fz = Math.min(g.nz - 1, Math.max(0, (z - g.z0) / g.cell));
  const i = Math.min(g.nx - 2, Math.floor(fx)), j = Math.min(g.nz - 2, Math.floor(fz));
  const u = fx - i, v = fz - j;
  const h = g.h, k = j * g.nx + i;
  return (h[k]! * (1 - u) + h[k + 1]! * u) * (1 - v) + (h[k + g.nx]! * (1 - u) + h[k + g.nx + 1]! * u) * v;
}

/** Lowest and highest ground inside a polygon (and at its corners). */
export function rangeUnder(g: HeightGrid | null | undefined, poly: readonly Vec2[]): { min: number; max: number } {
  if (!g || poly.length < 3) {
    const ys = poly.map((p) => heightAt(g, p.x, p.z));
    return { min: ys.length ? Math.min(...ys) : 0, max: ys.length ? Math.max(...ys) : 0 };
  }
  let min = Infinity, max = -Infinity;
  for (const p of poly) {
    const y = heightAt(g, p.x, p.z);
    min = Math.min(min, y);
    max = Math.max(max, y);
  }
  forCells(g, bbox(poly, 0), (k, x, z) => {
    if (!insidePoly(poly, x, z)) return;
    min = Math.min(min, g.h[k]!);
    max = Math.max(max, g.h[k]!);
  });
  return { min, max };
}

function bbox(pts: readonly Vec2[], r: number): { x0: number; z0: number; x1: number; z1: number } {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x - r);
    z0 = Math.min(z0, p.z - r);
    x1 = Math.max(x1, p.x + r);
    z1 = Math.max(z1, p.z + r);
  }
  return { x0, z0, x1, z1 };
}

function forCells(g: HeightGrid, b: { x0: number; z0: number; x1: number; z1: number }, fn: (k: number, x: number, z: number) => void): void {
  const i0 = Math.max(0, Math.floor((b.x0 - g.x0) / g.cell)), i1 = Math.min(g.nx - 1, Math.ceil((b.x1 - g.x0) / g.cell));
  const j0 = Math.max(0, Math.floor((b.z0 - g.z0) / g.cell)), j1 = Math.min(g.nz - 1, Math.ceil((b.z1 - g.z0) / g.cell));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * g.nx + i, g.x0 + i * g.cell, g.z0 + j * g.cell);
}

export function insidePoly(poly: readonly Vec2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from (x, z) to the polyline `pts` (a single point when it has one). */
function distToPath(pts: readonly Vec2[], x: number, z: number): number {
  if (pts.length === 1) return Math.hypot(x - pts[0]!.x, z - pts[0]!.z);
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
    const t = l2 ? clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1) : 0;
    d = Math.min(d, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return d;
}

/** Brush weight at a normalised distance 0 (centre) .. 1 (edge). */
export function falloffAt(f: Falloff, d: number): number {
  if (d >= 1) return 0;
  if (f === 'flat') return d < 0.8 ? 1 : (1 - d) / 0.2;
  if (f === 'linear') return 1 - d;
  return 0.5 + 0.5 * Math.cos(Math.PI * d);
}

/** Apply one stroke to the grid in place. */
export function applyStroke(g: HeightGrid, s: TerrainStroke): void {
  const r = s.radius;
  const f = s.falloff ?? 'smooth';
  if (s.op === 'raise' || s.op === 'lower' || s.op === 'flatten') {
    const sign = s.op === 'lower' ? -1 : 1;
    forCells(g, bbox(s.pts, r), (k, x, z) => {
      const w = falloffAt(f, distToPath(s.pts, x, z) / r);
      if (w <= 0) return;
      if (s.op === 'flatten') g.h[k] = g.h[k]! + ((s.height ?? 0) - g.h[k]!) * w;
      else g.h[k] = g.h[k]! + sign * Math.abs(s.strength) * w;
    });
  } else if (s.op === 'smooth') {
    const src = g.h.slice();
    const n = Math.max(1, Math.round(2 / g.cell));
    const blend = clamp(Math.abs(s.strength), 0, 1);
    forCells(g, bbox(s.pts, r), (k, x, z) => {
      const w = falloffAt(f, distToPath(s.pts, x, z) / r) * blend;
      if (w <= 0) return;
      const i = k % g.nx, j = (k - i) / g.nx;
      let sum = 0, c = 0;
      for (let b = -n; b <= n; b++) for (let a = -n; a <= n; a++) {
        const ii = i + a, jj = j + b;
        if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.nz) continue;
        sum += src[jj * g.nx + ii]!;
        c++;
      }
      g.h[k] = src[k]! + (sum / c - src[k]!) * w;
    });
  } else if (s.op === 'hill' || s.op === 'crater') {
    const c = s.pts[0]!;
    const depth = Math.abs(s.strength);
    forCells(g, bbox([c], r * 1.25), (k, x, z) => {
      const d = Math.hypot(x - c.x, z - c.z) / r;
      if (s.op === 'hill') g.h[k] = g.h[k]! + depth * falloffAt(f, d);
      else if (d < 1) g.h[k] = g.h[k]! - depth * (1 - d * d) + depth * 0.15 * Math.max(0, 1 - Math.abs(d - 0.95) / 0.15);
      else g.h[k] = g.h[k]! + depth * 0.15 * Math.max(0, 1 - Math.abs(d - 0.95) / 0.3);
    });
  } else if (s.op === 'ramp') {
    // a ramp from pts[0] (foot) to pts[1] (top), `radius` = half width, rising `strength` metres
    const a = s.pts[0]!, b = s.pts[1] ?? { x: a.x + 10, z: a.z };
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    forCells(g, bbox([a, b], r + 2), (k, x, z) => {
      const along = (x - a.x) * ux + (z - a.z) * uz;
      const across = Math.abs(-(x - a.x) * uz + (z - a.z) * ux);
      if (along < 0 || along > len || across > r + 2) return;
      const w = across <= r ? 1 : 1 - (across - r) / 2;
      const top = heightAt(g, a.x, a.z) + (s.strength * along) / len;
      g.h[k] = g.h[k]! + (Math.max(g.h[k]!, top) - g.h[k]!) * w;
    });
  }
}

/** Level the ground under a pad (with a 2 m blend around it); returns the height it was levelled to. */
export function flattenPad(g: HeightGrid, pad: FlatPad): number {
  // the typical height under the footprint (not the lowest: a long building on a gentle slope would be buried at its
  // high end), and a blend to the real ground that widens with the slope it absorbs
  const under: number[] = [];
  forCells(g, bbox(pad.poly, 0), (k, x, z) => {
    if (insidePoly(pad.poly, x, z)) under.push(g.h[k]!);
  });
  if (!under.length) under.push(...pad.poly.map((p) => heightAt(g, p.x, p.z)));
  under.sort((a, b) => a - b);
  const y = pad.height ?? under[Math.floor(under.length / 2)]!;
  const blend = Math.min(15, Math.max(2, 3 * (under[under.length - 1]! - under[0]!)));
  forCells(g, bbox(pad.poly, blend), (k, x, z) => {
    if (insidePoly(pad.poly, x, z)) {
      g.h[k] = y;
      return;
    }
    const d = distToPath([...pad.poly, pad.poly[0]!], x, z);
    if (d < blend) g.h[k] = g.h[k]! + (y - g.h[k]!) * (1 - d / blend);
  });
  return y;
}

/** Blend the outer {@link FEATHER} metres to y = 0 so the grid meets the flat ground around it. */
export function featherEdges(g: HeightGrid): void {
  const fe = Math.min(FEATHER, ((g.nx - 1) * g.cell) / 4, ((g.nz - 1) * g.cell) / 4);
  if (fe <= 0) return;
  for (let j = 0; j < g.nz; j++) {
    for (let i = 0; i < g.nx; i++) {
      const d = Math.min(i, j, g.nx - 1 - i, g.nz - 1 - j) * g.cell;
      if (d < fe) g.h[j * g.nx + i]! *= 0.5 - 0.5 * Math.cos((Math.PI * d) / fe);
    }
  }
}

/**
 * The finished grid: base (or flat) + strokes (+ feathered edges when there is no real ground) + levelled pads. The pads come last so a building
 * always stands on level ground; the returned `pads` are the heights they were levelled to, in the same order.
 */
export function buildHeights(t: TerrainSpec, pads: readonly FlatPad[] = []): { grid: HeightGrid; pads: number[] } {
  const g = emptyGrid(t);
  const base = t.base ? bases.get(t.base.key) : undefined;
  if (base && base.length === g.h.length) g.h.set(base);
  for (const s of t.strokes) applyStroke(g, s);
  if (!base || base.length !== g.h.length) featherEdges(g);
  return { grid: g, pads: pads.map((p) => flattenPad(g, p)) };
}

/** First point where a ray meets the terrain (or y = 0 outside it), marching in ~cell steps; null if it never does. */
export function rayGround(g: HeightGrid | null | undefined, o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, maxDist = 5000): Vec2 | null {
  const step = Math.max(0.25, (g?.cell ?? 1) * 0.5);
  let prev = 0;
  if (o.y < heightAt(g, o.x, o.z)) return null;
  for (let t = step; t < maxDist; t += step) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (y - heightAt(g, x, z) < 0) {
      // refine between prev and t
      let lo = prev, hi = t;
      for (let k = 0; k < 12; k++) {
        const m = (lo + hi) / 2;
        if (o.y + d.y * m - heightAt(g, o.x + d.x * m, o.z + d.z * m) < 0) hi = m;
        else lo = m;
      }
      return { x: o.x + d.x * hi, z: o.z + d.z * hi };
    }
    prev = t;
    if (d.y >= 0 && y > 2000) return null;
  }
  return null;
}

/**
 * Contour lines of a grid as SVG path data in site metres: `minor` every `step` metres, `major` every 5 steps (the
 * plan view draws the major ones bolder). Marching squares; a big grid is sampled every `stride` cells. Flat ground = ''.
 */
export function contourPaths(g: HeightGrid, step = 1, stride = g.nx * g.nz > 90_000 ? 2 : 1): { minor: string; major: string } {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < g.h.length; k++) {
    lo = Math.min(lo, g.h[k]!);
    hi = Math.max(hi, g.h[k]!);
  }
  if (!(hi - lo >= step * 0.5)) return { minor: '', major: '' };
  const minor: string[] = [], major: string[] = [];
  const at = (i: number, j: number): number => g.h[j * g.nx + i]!;
  const f = (n: number): string => n.toFixed(2);
  for (let j = 0; j + stride < g.nz; j += stride) {
    for (let i = 0; i + stride < g.nx; i += stride) {
      const a = at(i, j), b = at(i + stride, j), c = at(i + stride, j + stride), d = at(i, j + stride);
      const cmin = Math.min(a, b, c, d), cmax = Math.max(a, b, c, d);
      if (cmax - cmin < 1e-6) continue;
      const x0 = g.x0 + i * g.cell, z0 = g.z0 + j * g.cell, s = stride * g.cell;
      for (let lv = Math.ceil(cmin / step) * step; lv <= cmax; lv += step) {
        if (lv === cmin && lv === cmax) continue;
        // crossing points on the four edges (top, right, bottom, left)
        const pts: [number, number][] = [];
        const edge = (p: number, q: number, xa: number, za: number, xb: number, zb: number): void => {
          if ((p < lv) !== (q < lv)) {
            const t = (lv - p) / (q - p);
            pts.push([xa + (xb - xa) * t, za + (zb - za) * t]);
          }
        };
        edge(a, b, x0, z0, x0 + s, z0);
        edge(b, c, x0 + s, z0, x0 + s, z0 + s);
        edge(c, d, x0 + s, z0 + s, x0, z0 + s);
        edge(d, a, x0, z0 + s, x0, z0);
        const out = Math.round(lv / step) % 5 === 0 ? major : minor;
        for (let k = 0; k + 1 < pts.length; k += 2) out.push(`M${f(pts[k]![0])} ${f(pts[k]![1])}L${f(pts[k + 1]![0])} ${f(pts[k + 1]![1])}`);
      }
    }
  }
  return { minor: minor.join(''), major: major.join('') };
}

/** Height-map colours, low to high: dark green, green, yellow, brown, snow white (blue would read as water). */
const RAMP: readonly [number, number, number][] = [
  [0.12, 0.33, 0.24],
  [0.25, 0.62, 0.35],
  [0.85, 0.76, 0.42],
  [0.66, 0.4, 0.23],
  [0.95, 0.95, 0.95],
];

/** The colour (r, g, b in 0..1) of a height `h` on a map whose heights run from `lo` to `hi`; flat ground is green. */
export function heightColor(h: number, lo: number, hi: number): [number, number, number] {
  if (hi - lo < 0.5) return RAMP[1]!;
  const t = Math.min(1, Math.max(0, (h - lo) / (hi - lo))) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i;
  const a = RAMP[i]!, b = RAMP[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** Lowest and highest height of a grid. */
export function heightRange(g: HeightGrid): { lo: number; hi: number } {
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < g.h.length; k++) {
    lo = Math.min(lo, g.h[k]!);
    hi = Math.max(hi, g.h[k]!);
  }
  return { lo, hi };
}
