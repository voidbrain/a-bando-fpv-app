/**
 * Rectilinear building footprints: polygons whose every edge is parallel to the building's own X or Z axis
 * (rectangles, L, T, U and H shapes ...). They stay compatible with the axis-aligned wall / collider boxes the 3D
 * builder uses, and they can be edited with two operations only: add a wing (union with a rectangle) and cut a
 * notch (subtract a rectangle). Coordinates are building-local metres, centred on the bounding box.
 */
export interface Pt {
  x: number;
  z: number;
}

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const EPS = 1e-6;

export const rectPoly = (length: number, width: number): Pt[] => [
  { x: -length / 2, z: -width / 2 },
  { x: length / 2, z: -width / 2 },
  { x: length / 2, z: width / 2 },
  { x: -length / 2, z: width / 2 },
];

export function bounds(poly: Pt[]): Rect {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z);
    z1 = Math.max(z1, p.z);
  }
  return { x0, z0, x1, z1 };
}

/** The walls: one per polygon edge, with its axis and the coordinate range along that axis. */
export interface Edge {
  i: number;
  a: Pt;
  b: Pt;
  /** 'x' = the wall runs along X (a horizontal edge in the plan), 'z' = along Z. */
  axis: 'x' | 'z';
  /** Constant coordinate (z for an 'x' wall, x for a 'z' wall). */
  at: number;
  /** Range along the axis. */
  from: number;
  to: number;
}

export function edgesOf(poly: Pt[]): Edge[] {
  const out: Edge[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const axis: 'x' | 'z' = Math.abs(b.x - a.x) >= Math.abs(b.z - a.z) ? 'x' : 'z';
    out.push(axis === 'x' ? { i, a, b, axis, at: (a.z + b.z) / 2, from: Math.min(a.x, b.x), to: Math.max(a.x, b.x) } : { i, a, b, axis, at: (a.x + b.x) / 2, from: Math.min(a.z, b.z), to: Math.max(a.z, b.z) });
  }
  return out;
}

/** Point-in-polygon (even-odd) for any simple polygon. */
export function contains(poly: Pt[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Cover the polygon with non-overlapping rectangles (floor / roof slabs, rooms). */
export function slabs(poly: Pt[]): Rect[] {
  const zs = [...new Set(poly.map((p) => round(p.z)))].sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let j = 0; j + 1 < zs.length; j++) {
    const z0 = zs[j]!, z1 = zs[j + 1]!;
    const mid = (z0 + z1) / 2;
    const xs: number[] = [];
    for (const e of edgesOf(poly)) if (e.axis === 'z' && e.from <= mid && mid < e.to) xs.push(e.at);
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = xs[k]!, x1 = xs[k + 1]!;
      const prev = out.find((r) => Math.abs(r.x0 - x0) < EPS && Math.abs(r.x1 - x1) < EPS && Math.abs(r.z1 - z0) < EPS);
      if (prev) prev.z1 = z1;
      else out.push({ x0, z0, x1, z1 });
    }
  }
  return out;
}

const round = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * Add a rectangle to the footprint (`add`) or cut it out (`cut`). Returns the new outline, or null when the result
 * would be empty, split in two, or have a hole (a courtyard) — shapes this editor cannot represent.
 */
export function combine(poly: Pt[], r: Rect, op: 'add' | 'cut'): Pt[] | null {
  const rect: Rect = { x0: round(Math.min(r.x0, r.x1)), x1: round(Math.max(r.x0, r.x1)), z0: round(Math.min(r.z0, r.z1)), z1: round(Math.max(r.z0, r.z1)) };
  if (rect.x1 - rect.x0 < 0.25 || rect.z1 - rect.z0 < 0.25) return null;
  const xs = [...new Set([...poly.map((p) => round(p.x)), rect.x0, rect.x1])].sort((a, b) => a - b);
  const zs = [...new Set([...poly.map((p) => round(p.z)), rect.z0, rect.z1])].sort((a, b) => a - b);
  const W = xs.length - 1, H = zs.length - 1;
  const fill: boolean[][] = [];
  for (let i = 0; i < W; i++) {
    fill[i] = [];
    for (let j = 0; j < H; j++) {
      const cx = (xs[i]! + xs[i + 1]!) / 2, cz = (zs[j]! + zs[j + 1]!) / 2;
      const a = contains(poly, cx, cz);
      const b = cx > rect.x0 && cx < rect.x1 && cz > rect.z0 && cz < rect.z1;
      fill[i]![j] = op === 'add' ? a || b : a && !b;
    }
  }
  const on = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < W && j < H && fill[i]![j]!;
  // directed boundary edges, clockwise around the filled cells (x right, z down), keyed by grid vertex
  const next = new Map<string, [number, number]>();
  let count = 0;
  let pinch = false;
  const add = (a: [number, number], b: [number, number]): void => {
    const k = `${a[0]},${a[1]}`;
    if (next.has(k)) pinch = true;
    next.set(k, b);
    count++;
  };
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) {
      if (!fill[i]![j]) continue;
      if (!on(i, j - 1)) add([i, j], [i + 1, j]); // top, left -> right
      if (!on(i + 1, j)) add([i + 1, j], [i + 1, j + 1]); // right, top -> bottom
      if (!on(i, j + 1)) add([i + 1, j + 1], [i, j + 1]); // bottom, right -> left
      if (!on(i - 1, j)) add([i, j + 1], [i, j]); // left, bottom -> top
    }
  }
  if (!count || pinch) return null;
  const startKey = next.keys().next().value as string;
  const ring: [number, number][] = [];
  let cur: [number, number] = startKey.split(',').map(Number) as [number, number];
  const first = cur;
  do {
    ring.push(cur);
    const n = next.get(`${cur[0]},${cur[1]}`);
    if (!n) return null;
    cur = n;
  } while (!(cur[0] === first[0] && cur[1] === first[1]) && ring.length <= count);
  if (ring.length !== count) return null; // more than one ring: split shape or a hole
  // drop collinear vertices
  const pts: Pt[] = ring.map(([i, j]) => ({ x: xs[i]!, z: zs[j]! }));
  const clean = pts.filter((p, k) => {
    const a = pts[(k + pts.length - 1) % pts.length]!, b = pts[(k + 1) % pts.length]!;
    return !((Math.abs(a.x - p.x) < EPS && Math.abs(p.x - b.x) < EPS) || (Math.abs(a.z - p.z) < EPS && Math.abs(p.z - b.z) < EPS));
  });
  return clean.length >= 4 ? clean : null;
}

/** Shift a polygon so its bounding box is centred on the origin; returns the shift that was removed. */
export function recentre(poly: Pt[]): { poly: Pt[]; shift: Pt; length: number; width: number } {
  const b = bounds(poly);
  const shift = { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 };
  return { poly: poly.map((p) => ({ x: round(p.x - shift.x), z: round(p.z - shift.z) })), shift, length: b.x1 - b.x0, width: b.z1 - b.z0 };
}

/**
 * Turn an arbitrary outline (already expressed in the building's own axes) into a rectilinear one: every edge is
 * snapped to X or Z, tiny jogs are absorbed. Returns null when the shape is not close to rectilinear — the caller
 * then keeps a plain rectangle.
 */
export function rectilinear(ring: Pt[], minEdge = 1.2, tol = 0.25): Pt[] | null {
  const pts = ring.length > 1 && ring[0]!.x === ring[ring.length - 1]!.x && ring[0]!.z === ring[ring.length - 1]!.z ? ring.slice(0, -1) : ring.slice();
  if (pts.length < 4) return null;
  interface E { axis: 'x' | 'z'; at: number; len: number }
  let es: E[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
    const dx = Math.abs(b.x - a.x), dz = Math.abs(b.z - a.z);
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    if (Math.min(dx, dz) / Math.max(dx, dz) > tol && len >= minEdge) return null; // a real diagonal wall
    es.push(dx >= dz ? { axis: 'x', at: (a.z + b.z) / 2, len } : { axis: 'z', at: (a.x + b.x) / 2, len });
  }
  const merge = (): boolean => {
    for (let i = 0; i < es.length && es.length > 4; i++) {
      const a = es[i]!, b = es[(i + 1) % es.length]!;
      if (a.axis === b.axis) {
        const len = a.len + b.len;
        es.splice(i, 1);
        es[i % es.length] = { axis: b.axis, at: (a.at * a.len + b.at * b.len) / len, len };
        return true;
      }
    }
    return false;
  };
  for (let guard = 0; guard < 200; guard++) {
    if (merge()) continue;
    // a short edge between two long ones is a jog: remove it so its neighbours (same axis) merge
    let k = -1, m = minEdge;
    es.forEach((e, i) => { if (e.len < m) { m = e.len; k = i; } });
    if (k < 0 || es.length <= 4) break;
    es.splice(k, 1);
  }
  while (merge()) { /* keep merging */ }
  if (es.length < 4 || es.length % 2 !== 0) return null;
  for (let i = 0; i < es.length; i++) if (es[i]!.axis === es[(i + 1) % es.length]!.axis) return null;
  const out: Pt[] = es.map((e, i) => {
    const p = es[(i + es.length - 1) % es.length]!; // vertex i joins edge i-1 and edge i
    return e.axis === 'x' ? { x: p.at, z: e.at } : { x: e.at, z: p.at };
  });
  return out;
}

/** Area (square metres) of a polygon, absolute. */
export function area(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    s += a.x * b.z - b.x * a.z;
  }
  return Math.abs(s / 2);
}

/** `r` minus `v`: up to four rectangles that cover what is left (used for floor slabs with voids). */
export function cutRect(r: Rect, v: Rect): Rect[] {
  const x0 = Math.max(r.x0, Math.min(v.x0, v.x1)), x1 = Math.min(r.x1, Math.max(v.x0, v.x1));
  const z0 = Math.max(r.z0, Math.min(v.z0, v.z1)), z1 = Math.min(r.z1, Math.max(v.z0, v.z1));
  if (x1 - x0 < EPS || z1 - z0 < EPS) return [r]; // no overlap
  const out: Rect[] = [];
  if (z0 - r.z0 > EPS) out.push({ x0: r.x0, x1: r.x1, z0: r.z0, z1: z0 });
  if (r.z1 - z1 > EPS) out.push({ x0: r.x0, x1: r.x1, z0: z1, z1: r.z1 });
  if (x0 - r.x0 > EPS) out.push({ x0: r.x0, x1: x0, z0, z1 });
  if (r.x1 - x1 > EPS) out.push({ x0: x1, x1: r.x1, z0, z1 });
  return out;
}

/** Do two oriented rectangles overlap (separating-axis test)? `a` / `b` are centre, half sizes and rotation (radians). */
export function obbOverlap(a: { x: number; z: number; hx: number; hz: number; r: number }, b: { x: number; z: number; hx: number; hz: number; r: number }, margin = 0): boolean {
  const axes = [a.r, a.r + Math.PI / 2, b.r, b.r + Math.PI / 2].map((t) => [Math.cos(t), Math.sin(t)] as const);
  const proj = (o: typeof a, ax: readonly [number, number]): number => {
    const c = Math.cos(o.r), s = Math.sin(o.r);
    return o.hx * Math.abs(c * ax[0] + s * ax[1]) + o.hz * Math.abs(-s * ax[0] + c * ax[1]);
  };
  for (const ax of axes) {
    const d = Math.abs((b.x - a.x) * ax[0] + (b.z - a.z) * ax[1]);
    if (d > proj(a, ax) + proj(b, ax) - margin) return false;
  }
  return true;
}
