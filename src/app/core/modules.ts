import { addOpening, insideBuilding, listOpenings, patchOpening, removeOpening, wallsOf } from './openings';
import type { BuildingSpec } from './site-spec';

/**
 * Reusable building "modules": a façade pattern repeated along a wall and a column layout repeated along the hall.
 * They are plain functions over the same data the mouse tools edit (openings and columns), so everything stays
 * editable afterwards. The "industrial store" preset is the standard warehouse shell: long walls with a repeated
 * module of two lower-panel bays + one full-height door, one end wall all lower panels, the other all doors, and
 * four rows of columns down the hall: one at a quarter of the width from each long wall and a close pair in the middle
 * (1 ——— 1 - 1 ——— 1, under the valleys of a four-barrel roof), every three bays so they line up with the piers.
 */
export type FacadePattern = 'doors' | 'panels' | 'store';
export const FACADE_PATTERNS: readonly FacadePattern[] = ['doors', 'panels', 'store'];

/** What each bay of a pattern is: `door` = full-height opening, `panel` = a solid lower panel with an opening above. */
const CYCLE: Record<FacadePattern, ('door' | 'panel')[]> = {
  doors: ['door'],
  panels: ['panel'],
  store: ['panel', 'panel', 'door'],
};

export interface FacadeOpts {
  /** Distance between piers, metres (the real pitch is adjusted so whole bays fill the wall). Default 5. */
  bay?: number;
  /** Pier width between two bays. Default 1. */
  pier?: number;
  /** Height of the solid lower panel. Default 1.5. */
  panel?: number;
  /** Solid band above the openings (the lintel). Default 1. */
  lintel?: number;
}

type Wall = ReturnType<typeof wallsOf>[number];

/** Remove every opening on one wall of a level. */
export function clearWall(b: BuildingSpec, li: number, wall: Wall): number {
  let n = 0;
  for (let g = 0; g < 200; g++) {
    const t = listOpenings(b, li).find((o) => o.axis === wall.axis && Math.abs(o.at - wall.at) < 0.1 && o.c >= wall.from - 0.01 && o.c <= wall.to + 0.01);
    if (!t) break;
    removeOpening(b, li, t.id);
    n++;
  }
  return n;
}

/** Replace the openings of one wall with a repeated bay pattern. Returns the number of bays made (0 = wall too short). */
export function setFacade(b: BuildingSpec, li: number, wall: Wall, pattern: FacadePattern, o: FacadeOpts = {}): number {
  const lev = b.levels[li];
  if (!lev) return 0;
  const len = wall.to - wall.from;
  const pier = Math.max(0.3, o.pier ?? 1);
  const H = lev.height;
  const lintel = Math.min(o.lintel ?? 1, H * 0.3);
  const n = Math.max(1, Math.round(len / Math.max(2, o.bay ?? 5)));
  const pitch = len / n;
  const w = pitch - pier;
  if (w < 0.6) return 0;
  const panel = Math.min(o.panel ?? 1.5, H - lintel - 0.5);
  clearWall(b, li, wall);
  const cycle = CYCLE[pattern];
  let made = 0;
  for (let i = 0; i < n; i++) {
    const kind = cycle[i % cycle.length]!;
    const c = wall.from + (i + 0.5) * pitch;
    const p = wall.axis === 'x' ? { x: c, z: wall.at } : { x: wall.at, z: c };
    const id = addOpening(b, li, p, kind === 'door' ? 'door' : 'window', 0.3);
    if (!id) continue;
    if (kind === 'door') patchOpening(b, li, id, { w, h: H - lintel });
    else patchOpening(b, li, id, { w, h: H - lintel - panel, sill: panel });
    made++;
  }
  return made;
}

export interface ColumnOpts {
  /** Rows of columns across the hall (evenly spread between the two edge rows). Default 3. */
  rows?: number;
  /** Distance between columns along the hall. Default 10. */
  step?: number;
  /** Distance of the edge rows from the long walls. Default 4. */
  inset?: number;
  size?: number;
  /** Where the rows are, metres across the hall from its first long wall (overrides `rows` and `inset`). */
  cross?: number[];
}

/** The store's rows across a hall `w` wide: a quarter in from each long wall, and a pair either side of the middle. */
export function storeRows(w: number): number[] {
  const pair = Math.min(1.2, w / 20);
  return [w / 4, w / 2 - pair, w / 2 + pair, (3 * w) / 4].map((q) => Math.round(q * 100) / 100);
}

/**
 * Replace the columns of a level with `rows` rows running along the long axis: the first column is one `step` from the
 * end wall and the last is at least a metre short of the other. Existing columns are removed first, so applying it twice
 * never doubles a row. Returns how many columns were placed.
 */
export function setColumnRows(b: BuildingSpec, li: number, o: ColumnOpts = {}): number {
  const lev = b.levels[li];
  if (!lev) return 0;
  const along = b.length >= b.width ? 'x' : 'z';
  const L = along === 'x' ? b.length : b.width;
  const W = along === 'x' ? b.width : b.length;
  const rows = Math.max(1, Math.min(8, Math.round(o.rows ?? 3)));
  const step = Math.max(2, o.step ?? 10);
  const size = o.size ?? 0.8;
  const inset = Math.min(Math.max(1, o.inset ?? 4), W / 2 - size);
  const given = (o.cross ?? []).filter((q) => q > size / 2 && q < W - size / 2);
  const cross = given.length ? given : rows === 1 ? [W / 2] : Array.from({ length: rows }, (_, k) => inset + (k * (W - 2 * inset)) / (rows - 1));
  lev.columns = [];
  for (const q of cross) {
    for (let a = step; a < L - 1; a += step) {
      const x = along === 'x' ? a : q, z = along === 'x' ? q : a;
      if (!insideBuilding(b, { x: x - b.length / 2, z: z - b.width / 2 })) continue;
      if (lev.columns.some((c) => Math.hypot(c.x - x, c.z - z) < 0.35)) continue;
      lev.columns.push({ x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, size });
    }
  }
  return lev.columns.length;
}

export interface StoreOpts extends FacadeOpts, ColumnOpts {
  /** Which end wall gets the doors (the other gets lower panels). Default: the far one (south or east). */
  doorEnd?: 'min' | 'max';
}

/** The industrial-store shell on one level of a rectangular building. Returns what was done, for the chat. */
export function applyStore(b: BuildingSpec, li: number, o: StoreOpts = {}): string[] {
  if (b.footprint) return [];
  const longX = b.length >= b.width;
  const walls = wallsOf(b);
  const long = walls.filter((w) => (longX ? w.axis === 'x' : w.axis === 'z'));
  const short = walls.filter((w) => (longX ? w.axis === 'z' : w.axis === 'x')).sort((a, c) => a.at - c.at);
  const out: string[] = [];
  for (const w of long) out.push(`${setFacade(b, li, w, 'store', o)} bays on a long wall`);
  const [first, last] = short;
  const doorsOnMax = (o.doorEnd ?? 'max') === 'max';
  if (first && last) {
    out.push(`${setFacade(b, li, doorsOnMax ? last : first, 'doors', o)} door bays on one end wall`);
    out.push(`${setFacade(b, li, doorsOnMax ? first : last, 'panels', o)} panel bays on the other end wall`);
  }
  // unless told otherwise: the store's four rows (1 ——— 1 - 1 ——— 1), one column every three bays (on the piers)
  const across = longX ? b.width : b.length, along = longX ? b.length : b.width;
  const pitch = along / Math.max(1, Math.round(along / Math.max(2, o.bay ?? 5)));
  out.push(`${setColumnRows(b, li, { ...o, rows: o.rows ?? 4, step: o.step ?? pitch * 3, ...((o.rows ?? 4) === 4 && !o.cross ? { cross: storeRows(across) } : {}) })} columns`);
  return out;
}
