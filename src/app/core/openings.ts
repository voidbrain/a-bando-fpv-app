import { combine, contains, edgesOf, recentre, rectPoly, type Edge, type Pt, type Rect } from './footprint';
import type { BuildingSpec, LevelSpec, OpeningSpec, WallOpening } from './site-spec';

type Side = 'n' | 's' | 'e' | 'w';
const SIDES: readonly Side[] = ['n', 's', 'e', 'w'];
const TOL = 0.08;

/** One door / window as the editor sees it, whatever the building representation: a segment on a wall. */
export interface OpenSeg {
  id: string;
  kind: 'door' | 'window';
  w: number;
  h: number;
  sill: number;
  closed: boolean;
  axis: 'x' | 'z';
  /** The wall's constant coordinate (z for an 'x' wall, x for a 'z' wall), building-centred. */
  at: number;
  /** Centre along the wall's axis, building-centred. */
  c: number;
  /** The wall's extent along its axis. */
  from: number;
  to: number;
}

export const defaultSill = (l: LevelSpec, kind: 'door' | 'window'): number => (kind === 'door' ? 0 : Math.max(0.4, l.height * 0.75));

/** The walls of a building: four sides for a rectangle, the polygon edges for a shaped one. */
export function wallsOf(b: BuildingSpec): { key: string; side?: Side; axis: 'x' | 'z'; at: number; from: number; to: number }[] {
  if (b.footprint) return edgesOf(b.footprint).map((e) => ({ key: `e${e.i}`, axis: e.axis, at: e.at, from: e.from, to: e.to }));
  const L = b.length / 2, W = b.width / 2;
  return [
    { key: 'n', side: 'n', axis: 'x', at: -W, from: -L, to: L },
    { key: 's', side: 's', axis: 'x', at: W, from: -L, to: L },
    { key: 'w', side: 'w', axis: 'z', at: -L, from: -W, to: W },
    { key: 'e', side: 'e', axis: 'z', at: L, from: -W, to: W },
  ];
}

const edgeFor = (b: BuildingSpec, o: { x: number; z: number }): Edge | undefined =>
  edgesOf(b.footprint ?? []).find((e) => (e.axis === 'x' ? Math.abs(o.z - e.at) < TOL && o.x >= e.from - TOL && o.x <= e.to + TOL : Math.abs(o.x - e.at) < TOL && o.z >= e.from - TOL && o.z <= e.to + TOL));

export function listOpenings(b: BuildingSpec, li: number): OpenSeg[] {
  const l = b.levels[li];
  if (!l) return [];
  const out: OpenSeg[] = [];
  if (b.footprint) {
    (l.wallOpenings ?? []).forEach((o, i) => {
      const e = edgeFor(b, o);
      if (e) out.push({ id: `p:${i}`, kind: o.kind, w: o.w, h: o.h, sill: o.sill ?? defaultSill(l, o.kind), closed: !!o.closed, axis: e.axis, at: e.at, c: e.axis === 'x' ? o.x : o.z, from: e.from, to: e.to });
    });
    return out;
  }
  for (const wall of wallsOf(b)) {
    (l.doors[wall.side!] ?? []).forEach((o, i) => {
      out.push({ id: `r:${wall.side}:${i}`, kind: o.kind, w: o.w, h: o.h, sill: o.sill ?? defaultSill(l, o.kind), closed: !!o.closed, axis: wall.axis, at: wall.at, c: wall.from + o.c, from: wall.from, to: wall.to });
    });
  }
  return out;
}

function nearestWall(b: BuildingSpec, p: Pt, maxDist: number): { wall: ReturnType<typeof wallsOf>[number]; along: number } | null {
  let best: ReturnType<typeof wallsOf>[number] | null = null;
  let bd = Infinity;
  for (const w of wallsOf(b)) {
    const along = w.axis === 'x' ? p.x : p.z, across = w.axis === 'x' ? p.z : p.x;
    const d = Math.abs(across - w.at) + (along < w.from ? w.from - along : along > w.to ? along - w.to : 0);
    if (d < bd) { bd = d; best = w; }
  }
  if (!best || bd > maxDist) return null;
  return { wall: best, along: best.axis === 'x' ? p.x : p.z };
}

const openingSize = (l: LevelSpec, kind: 'door' | 'window'): { w: number; h: number; sill: number | undefined } => {
  const w = kind === 'door' ? 2.2 : 1.2;
  const sill = kind === 'door' ? undefined : Math.min(0.9, Math.max(0.3, l.height * 0.3));
  const h = kind === 'door' ? Math.min(2.6, l.height * 0.8) : Math.min(1.2, Math.max(0.4, l.height - (sill ?? 0) - 0.3));
  return { w, h, sill };
};

/** Where a door / window would go for a click at `p` (building-centred), and the gaps to its neighbours; null when no wall is close. */
export interface OpeningPreview {
  axis: 'x' | 'z';
  at: number;
  c: number;
  w: number;
  /** Free stretches next to it along the wall (to the wall end or the next opening): from, to (building-centred) and their length. */
  gaps: { from: number; to: number; d: number }[];
}

export function previewOpening(b: BuildingSpec, li: number, p: Pt, kind: 'door' | 'window', maxDist: number): OpeningPreview | null {
  const l = b.levels[li];
  if (!l) return null;
  const hit = nearestWall(b, p, maxDist);
  if (!hit) return null;
  const { w } = openingSize(l, kind);
  const { wall, along } = hit;
  if (wall.to - wall.from < w + 0.3) return null;
  const c = Math.min(wall.to - w / 2 - 0.1, Math.max(wall.from + w / 2 + 0.1, Math.round(along * 10) / 10));
  const others = listOpenings(b, li).filter((o) => o.axis === wall.axis && Math.abs(o.at - wall.at) < 0.1).sort((x, y) => x.c - y.c);
  const left = others.filter((o) => o.c < c).pop(), right = others.find((o) => o.c > c);
  const lo = left ? left.c + left.w / 2 : wall.from, hi = right ? right.c - right.w / 2 : wall.to;
  const gaps = [{ from: lo, to: c - w / 2, d: c - w / 2 - lo }, { from: c + w / 2, to: hi, d: hi - (c + w / 2) }].filter((g) => g.d > 0.05);
  return { axis: wall.axis, at: wall.at, c, w, gaps };
}

/** Add a door / window on the wall nearest to `p` (building-centred); returns its id, or null when no wall is close. */
export function addOpening(b: BuildingSpec, li: number, p: Pt, kind: 'door' | 'window', maxDist: number): string | null {
  const l = b.levels[li];
  if (!l) return null;
  const hit = nearestWall(b, p, maxDist);
  if (!hit) return null;
  const best = hit.wall;
  const { w, h, sill } = openingSize(l, kind);
  const len = best.to - best.from;
  if (len < w + 0.3) return null;
  const c = Math.min(best.to - w / 2 - 0.1, Math.max(best.from + w / 2 + 0.1, Math.round(hit.along * 10) / 10));
  if (b.footprint) {
    const o: WallOpening = best.axis === 'x' ? { kind, x: c, z: best.at, w, h, sill } : { kind, x: best.at, z: c, w, h, sill };
    (l.wallOpenings ??= []).push(o);
    return `p:${l.wallOpenings.length - 1}`;
  }
  const arr = (l.doors[best.side!] ??= []);
  arr.push({ kind, c: c - best.from, w, h, sill });
  return `r:${best.side}:${arr.length - 1}`;
}

function ref(b: BuildingSpec, li: number, id: string): { o: OpeningSpec | WallOpening; seg: OpenSeg } | null {
  const l = b.levels[li];
  const seg = listOpenings(b, li).find((s) => s.id === id);
  if (!l || !seg) return null;
  const parts = id.split(':');
  const o = parts[0] === 'p' ? l.wallOpenings?.[Number(parts[1])] : l.doors[parts[1] as Side]?.[Number(parts[2])];
  return o ? { o, seg } : null;
}

const setCentre = (o: OpenSeg, target: OpeningSpec | WallOpening, c: number, w: number, from: number, b: BuildingSpec): void => {
  void b;
  if ('c' in target) target.c = c - from;
  else if (o.axis === 'x') target.x = c;
  else target.z = c;
  target.w = w;
};

/** Slide an opening along its wall so its centre is at `c`; it never leaves the wall. */
export function moveOpening(b: BuildingSpec, li: number, id: string, c: number): void {
  const r = ref(b, li, id);
  if (!r) return;
  const cc = Math.min(r.seg.to - r.seg.w / 2, Math.max(r.seg.from + r.seg.w / 2, Math.round(c * 10) / 10));
  setCentre(r.seg, r.o, cc, r.seg.w, r.seg.from, b);
}

/** Drag one end of an opening to `pos` along its wall (the other end stays): changes width and centre. */
export function resizeOpening(b: BuildingSpec, li: number, id: string, end: 0 | 1, pos: number): void {
  const r = ref(b, li, id);
  if (!r) return;
  const p = Math.min(r.seg.to, Math.max(r.seg.from, Math.round(pos * 10) / 10));
  const lo = end === 0 ? p : r.seg.c - r.seg.w / 2, hi = end === 1 ? p : r.seg.c + r.seg.w / 2;
  if (hi - lo < 0.4) return;
  setCentre(r.seg, r.o, (lo + hi) / 2, hi - lo, r.seg.from, b);
}

export function patchOpening(b: BuildingSpec, li: number, id: string, patch: Partial<{ kind: 'door' | 'window'; w: number; h: number; sill: number; c: number; closed: boolean }>): void {
  const r = ref(b, li, id);
  if (!r) return;
  if (patch.kind) {
    r.o.kind = patch.kind;
    if (patch.kind === 'door') delete r.o.sill;
  }
  if (patch.closed !== undefined) {
    if (patch.closed) r.o.closed = true;
    else delete r.o.closed;
  }
  if (patch.h !== undefined) r.o.h = Math.max(0.3, patch.h);
  if (patch.sill !== undefined) r.o.sill = Math.max(0, patch.sill);
  if (patch.w !== undefined) setCentre(r.seg, r.o, r.seg.c, Math.max(0.4, Math.min(patch.w, r.seg.to - r.seg.from)), r.seg.from, b);
  if (patch.c !== undefined) moveOpening(b, li, id, patch.c);
}

export function removeOpening(b: BuildingSpec, li: number, id: string): void {
  const l = b.levels[li];
  if (!l) return;
  const parts = id.split(':');
  if (parts[0] === 'p') l.wallOpenings?.splice(Number(parts[1]), 1);
  else l.doors[parts[1] as Side]?.splice(Number(parts[2]), 1);
}

/** The outline of a building as a polygon (a rectangle when it has no footprint). */
export const outlineOf = (b: BuildingSpec): Pt[] => b.footprint ?? rectPoly(b.length, b.width);

/**
 * Add a wing to, or cut a notch out of, a building (`localRect` is in its current centred frame). Rectangular
 * buildings become shaped; the bounding box, position, partitions and openings are re-centred and carried along.
 * Returns false (and changes nothing) when the result would split the building or leave a hole.
 */
export function reshapeBuilding(b: BuildingSpec, localRect: Rect, op: 'add' | 'cut'): boolean {
  if (b.frame) return false;
  const next = combine(outlineOf(b), localRect, op);
  if (!next) return false;
  const oldL = b.length, oldW = b.width;
  // 1. make every opening polygon-style (centre points), so nothing depends on side names any more
  if (!b.footprint) {
    for (let li = 0; li < b.levels.length; li++) {
      const l = b.levels[li]!;
      l.wallOpenings = listOpenings(b, li).map((s): WallOpening => {
        const src = s.id.split(':');
        const o = l.doors[src[1] as Side]![Number(src[2])]!;
        return s.axis === 'x' ? { kind: o.kind, x: s.c, z: s.at, w: o.w, h: o.h, sill: o.sill, closed: o.closed } : { kind: o.kind, x: s.at, z: s.c, w: o.w, h: o.h, sill: o.sill, closed: o.closed };
      });
      l.doors = {};
    }
  }
  const rc = recentre(next);
  const shift = rc.shift;
  // 2. world position follows the re-centring
  const a = (b.rotDeg * Math.PI) / 180;
  b.pos = { x: b.pos.x + shift.x * Math.cos(a) - shift.z * Math.sin(a), z: b.pos.z + shift.x * Math.sin(a) + shift.z * Math.cos(a) };
  b.length = rc.length;
  b.width = rc.width;
  b.footprint = rc.poly;
  // 3. partitions are stored from the bounding box's min corner; openings keep only walls that still exist
  for (let li = 0; li < b.levels.length; li++) {
    const l = b.levels[li]!;
    l.partitions = l.partitions.map(([p, q]) => [
      { x: p.x - oldL / 2 - shift.x + b.length / 2, z: p.z - oldW / 2 - shift.z + b.width / 2 },
      { x: q.x - oldL / 2 - shift.x + b.length / 2, z: q.z - oldW / 2 - shift.z + b.width / 2 },
    ]);
    l.wallOpenings = (l.wallOpenings ?? []).map((o) => ({ ...o, x: o.x - shift.x, z: o.z - shift.z })).filter((o) => !!edgeFor(b, o));
    // voids and columns are in the same min-corner frame as the partitions
    const mx = (x: number): number => x - oldL / 2 - shift.x + b.length / 2;
    const mz = (z: number): number => z - oldW / 2 - shift.z + b.width / 2;
    if (l.voids) l.voids = l.voids.map((v) => ({ ...v, x0: mx(v.x0), x1: mx(v.x1), z0: mz(v.z0), z1: mz(v.z1) }));
    if (l.columns) l.columns = l.columns.map((c) => ({ ...c, x: mx(c.x), z: mz(c.z) }));
  }
  // 4. a shape that is a plain rectangle again goes back to the rectangular representation (gable roofs, side flags)
  if (b.footprint.length === 4) toRect(b);
  return true;
}

function toRect(b: BuildingSpec): void {
  const L = b.length / 2, W = b.width / 2;
  for (const l of b.levels) {
    l.doors = {};
    for (const o of l.wallOpenings ?? []) {
      const side: Side | null = Math.abs(o.z + W) < TOL ? 'n' : Math.abs(o.z - W) < TOL ? 's' : Math.abs(o.x + L) < TOL ? 'w' : Math.abs(o.x - L) < TOL ? 'e' : null;
      if (!side) continue;
      (l.doors[side] ??= []).push({ kind: o.kind, c: side === 'n' || side === 's' ? o.x + L : o.z + W, w: o.w, h: o.h, sill: o.sill, closed: o.closed });
    }
    delete l.wallOpenings;
  }
  delete b.footprint;
}

/** Turn a shaped building back into a plain rectangle covering its bounding box (openings on the box walls are kept). */
export function resetToRect(b: BuildingSpec): void {
  if (b.footprint) toRect(b);
}

/** Is the point (building-centred) inside the building's outline? */
export const insideBuilding = (b: BuildingSpec, p: Pt): boolean => contains(outlineOf(b), p.x, p.z);

export { SIDES };
