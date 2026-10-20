import { obbOverlap, slabs, type Pt, type Rect } from './footprint';
import { addOpening, insideBuilding, listOpenings, outlineOf, patchOpening, reshapeBuilding } from './openings';
import { cloneSpec, type BuildingSpec, type SiteSpec } from './site-spec';

/** Add a floor on top: a full copy of the last one (walls, doors, windows, interior walls, columns, voids). The roof moves up. */
export function addFloor(b: BuildingSpec): void {
  if (b.frame) return;
  const prev = b.levels[b.levels.length - 1]!;
  const top = b.levels.reduce((m, l) => Math.max(m, l.baseY + l.height), 0);
  const next = JSON.parse(JSON.stringify(prev)) as BuildingSpec['levels'][number];
  next.baseY = top;
  // water only makes sense on the ground; upstairs the same void is an open hole
  for (const v of next.voids ?? []) delete v.water;
  // the roof belongs to the top floor only: the floor below now just carries the slab of the new one
  prev.roof = 'none';
  b.levels.push(next);
}

/** Remove a floor; when it was the top one the new top floor gets the roof back. */
export function removeFloor(b: BuildingSpec, li: number): void {
  if (b.levels.length < 2) return;
  const gone = b.levels[li];
  if (!gone) return;
  b.levels.splice(li, 1);
  // keep the stack contiguous
  let y = 0;
  for (const l of b.levels) {
    l.baseY = y;
    y += l.height;
  }
  const top = b.levels[b.levels.length - 1]!;
  if (top.roof === 'none') {
    top.roof = gone.roof === 'none' ? 'gable' : gone.roof;
    top.roofRise = gone.roofRise;
    top.roofTurn = gone.roofTurn;
    top.roofCount = gone.roofCount;
    top.roofColor = gone.roofColor;
  }
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

export const toWorld = (b: BuildingSpec, p: Pt): Pt => {
  const a = rad(b.rotDeg);
  return { x: b.pos.x + p.x * Math.cos(a) - p.z * Math.sin(a), z: b.pos.z + p.x * Math.sin(a) + p.z * Math.cos(a) };
};

export const toLocal = (b: BuildingSpec, p: Pt): Pt => {
  const a = rad(b.rotDeg);
  const dx = p.x - b.pos.x, dz = p.z - b.pos.z;
  return { x: dx * Math.cos(a) + dz * Math.sin(a), z: -dx * Math.sin(a) + dz * Math.cos(a) };
};

/** The pieces of a building as oriented rectangles in world space (one per slab of its outline). */
function pieces(b: BuildingSpec): { x: number; z: number; hx: number; hz: number; r: number }[] {
  return slabs(outlineOf(b)).map((r) => {
    const c = toWorld(b, { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
    return { x: c.x, z: c.z, hx: (r.x1 - r.x0) / 2, hz: (r.z1 - r.z0) / 2, r: rad(b.rotDeg) };
  });
}

/** Do two buildings overlap (touching walls do not count)? */
export function buildingsOverlap(a: BuildingSpec, b: BuildingSpec): boolean {
  if (Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) > Math.hypot(a.length, a.width) / 2 + Math.hypot(b.length, b.width) / 2) return false;
  const pb = pieces(b);
  return pieces(a).some((p) => pb.some((q) => obbOverlap(p, q, 0.1)));
}

/** Does building `id` overlap any other building of the site? */
export function overlapsOthers(spec: SiteSpec, id: string): boolean {
  const me = spec.buildings.find((x) => x.id === id);
  return !!me && spec.buildings.some((o) => o.id !== id && buildingsOverlap(me, o));
}

/**
 * Merge building `bId` into `aId` (A keeps its name and roof). Both must run in the same direction (mod 90°) and
 * touch or overlap. Floors, interior walls, doors / windows on the new outer walls, columns and voids of B are
 * carried over. Returns an error message, or null on success (then B is gone from the site).
 */
export function mergeBuildings(spec: SiteSpec, aId: string, bId: string): string | null {
  const a0 = spec.buildings.find((x) => x.id === aId), b = spec.buildings.find((x) => x.id === bId);
  if (!a0 || !b || a0 === b) return 'pick two different buildings';
  if (a0.frame || b.frame) return 'greenhouse frames cannot be merged';
  const d = (((b.rotDeg - a0.rotDeg) % 90) + 90) % 90;
  if (Math.min(d, 90 - d) > 0.6) return `the two buildings point in different directions (${a0.rotDeg.toFixed(0)}° / ${b.rotDeg.toFixed(0)}°): rotate one to match first`;
  const probe = cloneSpec({ ...spec, buildings: [a0] }).buildings[0]!;
  // B's pieces as rectangles in A's axes
  const todo: Rect[] = slabs(outlineOf(b)).map((r) => {
    const cs = [toLocal(probe, toWorld(b, { x: r.x0, z: r.z0 })), toLocal(probe, toWorld(b, { x: r.x1, z: r.z1 }))];
    return { x0: Math.min(cs[0]!.x, cs[1]!.x), x1: Math.max(cs[0]!.x, cs[1]!.x), z0: Math.min(cs[0]!.z, cs[1]!.z), z1: Math.max(cs[0]!.z, cs[1]!.z) };
  });
  // pieces that do not touch yet may be reached through other pieces: keep trying until nothing more fits
  for (let guard = 0; todo.length && guard < 20; guard++) {
    let progressed = false;
    for (let i = todo.length - 1; i >= 0; i--) {
      // the pieces are in A's *current* frame; re-centring moves it, so recompute from the stored world rects
      const before = { ...probe.pos };
      if (reshapeBuilding(probe, todo[i]!, 'add')) {
        trackShift(probe, before);
        todo.splice(i, 1);
        progressed = true;
        // reshape re-centres A: express the remaining pieces in the new frame
        for (const t of todo) shiftRect(t, probe);
      }
    }
    if (!progressed) break;
  }
  if (todo.length) return 'the buildings must touch or overlap (and the result cannot enclose a courtyard)';
  while (probe.levels.length < b.levels.length) addFloor(probe);
  const La = probe.length, Wa = probe.width;
  const toA = (p: Pt): Pt => toLocal(probe, toWorld(b, p));
  const minCorner = (p: Pt): Pt => ({ x: p.x + La / 2, z: p.z + Wa / 2 });
  b.levels.forEach((lb, li) => {
    const la = probe.levels[li]!;
    for (const [p, q] of lb.partitions) la.partitions.push([minCorner(toA({ x: p.x - b.length / 2, z: p.z - b.width / 2 })), minCorner(toA({ x: q.x - b.length / 2, z: q.z - b.width / 2 }))]);
    for (const c of lb.columns ?? []) {
      const m = minCorner(toA({ x: c.x - b.length / 2, z: c.z - b.width / 2 }));
      (la.columns ??= []).push({ ...c, x: m.x, z: m.z });
    }
    for (const v of lb.voids ?? []) {
      const p = minCorner(toA({ x: v.x0 - b.length / 2, z: v.z0 - b.width / 2 })), q = minCorner(toA({ x: v.x1 - b.length / 2, z: v.z1 - b.width / 2 }));
      (la.voids ??= []).push({ x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), z0: Math.min(p.z, q.z), z1: Math.max(p.z, q.z), water: v.water });
    }
    for (const o of listOpenings(b, li)) {
      const centre = o.axis === 'x' ? { x: o.c, z: o.at } : { x: o.at, z: o.c };
      const id = addOpening(probe, li, toA(centre), o.kind, 0.35);
      if (id) patchOpening(probe, li, id, { w: o.w, h: o.h, sill: o.kind === 'window' ? o.sill : undefined, closed: o.closed });
    }
  });
  const i = spec.buildings.findIndex((x) => x.id === aId);
  spec.buildings[i] = probe;
  spec.buildings = spec.buildings.filter((x) => x.id !== bId);
  return null;
}

/** Re-express a rectangle (in a building's pre-reshape frame) after the building re-centred itself. Applied in place. */
function shiftRect(r: Rect, b: BuildingSpec): void {
  const last = lastShift.get(b);
  if (!last) return;
  r.x0 -= last.x;
  r.x1 -= last.x;
  r.z0 -= last.z;
  r.z1 -= last.z;
}

/** Remembers the last re-centring of a building made by reshapeBuilding (see wrapper below). */
const lastShift = new WeakMap<BuildingSpec, Pt>();
export function trackShift(b: BuildingSpec, before: Pt): void {
  const a = rad(b.rotDeg);
  const dx = b.pos.x - before.x, dz = b.pos.z - before.z;
  lastShift.set(b, { x: dx * Math.cos(a) + dz * Math.sin(a), z: -dx * Math.sin(a) + dz * Math.cos(a) });
}

// ---- repeating things: columns and openings -------------------------------------------------------------------

/** Is the point (min-corner coordinates of a floor) inside the building's outline and outside every void? */
function usable(b: BuildingSpec, li: number, x: number, z: number): boolean {
  const L = b.length / 2, W = b.width / 2;
  if (!insideBuilding(b, { x: x - L, z: z - W })) return false;
  return !(b.levels[li]?.voids ?? []).some((v) => x > Math.min(v.x0, v.x1) && x < Math.max(v.x0, v.x1) && z > Math.min(v.z0, v.z1) && z < Math.max(v.z0, v.z1));
}

const near = (cols: { x: number; z: number }[], x: number, z: number, d = 0.35): boolean => cols.some((c) => Math.hypot(c.x - x, c.z - z) < d);

/** Copy column `i` with an offset; returns the index of the copy (or -1 when it would fall outside / on another). */
export function duplicateColumn(b: BuildingSpec, li: number, i: number, dx: number, dz: number): number {
  const l = b.levels[li];
  const c = l?.columns?.[i];
  if (!l || !c) return -1;
  const x = c.x + dx, z = c.z + dz;
  if (!usable(b, li, x, z) || near(l.columns!, x, z)) return -1;
  l.columns!.push({ ...c, x, z });
  return l.columns!.length - 1;
}

/** `count` columns in a row starting at column `i` (it counts as the first), `spacing` metres apart along x or z. Returns how many were added. */
export function columnRow(b: BuildingSpec, li: number, i: number, count: number, spacing: number, axis: 'x' | 'z'): number {
  const l = b.levels[li];
  const c = l?.columns?.[i];
  if (!l || !c) return 0;
  let added = 0;
  for (let k = 1; k < Math.min(60, count); k++) {
    const x = c.x + (axis === 'x' ? k * spacing : 0), z = c.z + (axis === 'z' ? k * spacing : 0);
    if (usable(b, li, x, z) && !near(l.columns!, x, z)) {
      l.columns!.push({ ...c, x, z });
      added++;
    }
  }
  return added;
}

/** Fill the floor with columns like column `i`, on a grid `sx` × `sz` metres, at least `margin` from the walls. Returns how many were added. */
export function columnGrid(b: BuildingSpec, li: number, i: number, sx: number, sz: number, margin = 1): number {
  const l = b.levels[li];
  const c = l?.columns?.[i];
  if (!l || !c || sx < 0.8 || sz < 0.8) return 0;
  let added = 0;
  for (let x = margin; x <= b.length - margin + 1e-6 && added < 400; x += sx) {
    for (let z = margin; z <= b.width - margin + 1e-6 && added < 400; z += sz) {
      const gx = Math.round(x * 10) / 10, gz = Math.round(z * 10) / 10;
      const h = c.size / 2 + 0.3; // keep clear of walls and voids: all four corners must be usable
      if (![[h, h], [-h, h], [h, -h], [-h, -h]].every(([ox, oz]) => usable(b, li, gx + ox!, gz + oz!))) continue;
      if (near(l.columns!, gx, gz)) continue;
      l.columns!.push({ ...c, x: gx, z: gz });
      added++;
    }
  }
  return added;
}

/** Repeat a door / window along its wall: `count` in total (the original is the first), every `spacing` metres. Returns how many were added. */
export function repeatOpening(b: BuildingSpec, li: number, id: string, count: number, spacing: number): number {
  const seg = listOpenings(b, li).find((o) => o.id === id);
  if (!seg) return 0;
  let added = 0;
  for (let k = 1; k < Math.min(40, count); k++) {
    const c = seg.c + k * spacing;
    if (c - seg.w / 2 < seg.from + 0.1 || c + seg.w / 2 > seg.to - 0.1) break;
    if (listOpenings(b, li).some((o) => o.axis === seg.axis && Math.abs(o.at - seg.at) < 0.1 && Math.abs(o.c - c) < (o.w + seg.w) / 2)) continue;
    const p = seg.axis === 'x' ? { x: c, z: seg.at } : { x: seg.at, z: c };
    const nid = addOpening(b, li, p, seg.kind, 0.3);
    if (nid) {
      patchOpening(b, li, nid, { w: seg.w, h: seg.h, sill: seg.kind === 'window' ? seg.sill : undefined, closed: seg.closed });
      added++;
    }
  }
  return added;
}

/**
 * Turn a building into a greenhouse (arched steel frame) or the other way round. Interior walls, doors, windows,
 * columns, voids and the shaped outline are lost: the footprint becomes its bounding box.
 */
export function convertBuilding(b: BuildingSpec, to: 'greenhouse' | 'building'): void {
  delete b.footprint;
  if (to === 'greenhouse') {
    if (b.width > b.length) {
      [b.length, b.width] = [b.width, b.length];
      b.rotDeg = (b.rotDeg + 90) % 360; // the tunnel runs along the long side
    }
    b.frame = 'greenhouse';
    b.color = '#9ec1b6';
    b.levels = [{ baseY: 0, height: 2.4, sides: { n: false, s: false, e: false, w: false }, doors: {}, partitions: [], roof: 'vault', roofRise: 0, vaultK: 0.7 }];
  } else {
    delete b.frame;
    b.color = '#d7d0bd';
    b.levels = [{ baseY: 0, height: 4, sides: { n: true, s: true, e: true, w: true }, doors: {}, partitions: [], roof: 'gable', roofRise: 2.5, roofColor: '#b5683f' }];
  }
}

/**
 * Stairs (or a ramp) standing on floor `li` of a building at `centre` (min-corner frame), aligned with the building's
 * own axes and climbing along +x to the next floor. Returns the structure to add and, when there is a floor above, the
 * hole to cut in it where the flight arrives.
 */
export function stairsFor(b: BuildingSpec, li: number, centre: Pt, kind: 'stairs' | 'ramp', defaults: { length: number; size: number; name: string }): {
  structure: { kind: 'stairs' | 'ramp'; name: string; x: number; z: number; rotDeg: number; y: number; height: number; size: number; length: number };
  voidAbove: { x0: number; z0: number; x1: number; z1: number } | null;
} {
  const lev = b.levels[li]!;
  const length = kind === 'ramp' ? Math.max(defaults.length, lev.height * 6) : Math.max(2, Math.round((lev.height / 0.18) * 0.28 * 10) / 10);
  const w = toWorld(b, { x: centre.x - b.length / 2, z: centre.z - b.width / 2 });
  return {
    structure: { kind, name: `${defaults.name} ${li + 1}→${li + 2}`, x: w.x, z: w.z, rotDeg: b.rotDeg, y: lev.baseY, height: lev.height, size: defaults.size, length },
    voidAbove: b.levels[li + 1] ? { x0: centre.x, x1: centre.x + length / 2 + 0.3, z0: centre.z - defaults.size / 2 - 0.15, z1: centre.z + defaults.size / 2 + 0.15 } : null,
  };
}
