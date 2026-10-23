/**
 * Ruined buildings: a `ruin` level from 0 (intact) to 1 (a shell). A little ruin already shows: breaches in the facades
 * and holes in the roof. More ruin breaks the wall tops (upper floors first), opens the roof wider until it is gone
 * from {@link ROOFLESS}, and takes the upper floor slabs from {@link NO_SLABS}. Seeded, so the same building always
 * crumbles the same way. Pure.
 */
import { createRandom } from './site-spec';

export const ROOFLESS = 0.6;
export const NO_SLABS = 0.75;
/** Below this the wall tops stay straight (only breaches and roof holes). */
const JAGGED = 0.2;

export interface RuinPiece {
  /** Start along the wall and length (metres). */
  from: number;
  len: number;
  /** How much of its top is gone (metres); a piece with cut ≥ its height is missing entirely. */
  cut: number;
  /** A breach through the wall between these heights (from the bottom of the piece). */
  hole?: { y0: number; y1: number };
}

/**
 * Break one wall run (`len` long, `h` high) of floor `li` of `floors` into pieces. `ruin` 0 → one intact piece.
 * Breaches span one to three pieces; higher floors lose more of their top.
 */
export function ruinPieces(len: number, h: number, ruin: number, li: number, floors: number, rnd: () => number): RuinPiece[] {
  if (ruin <= 0.01 || len < 0.05) return [{ from: 0, len, cut: 0 }];
  const upper = floors > 1 ? li / (floors - 1) : 1;
  const top = (Math.max(0, ruin - JAGGED) / (1 - JAGGED)) * (0.35 + 0.65 * upper);
  const breach = Math.min(0.45, ruin * 0.55);
  const n = Math.max(1, Math.round(len / 1.5));
  const out: RuinPiece[] = [];
  let left = 0, y0 = 0, y1 = 0;
  for (let i = 0; i < n; i++) {
    const missing = rnd() < top * 0.45 * upper;
    const cut = Math.min(h, missing ? h : h * top * Math.pow(rnd(), 0.8));
    if (left === 0 && !missing && h > 1.5 && rnd() < breach * 0.5) {
      left = 1 + Math.floor(rnd() * 3);
      y0 = h * (0.12 + 0.35 * rnd());
      y1 = Math.min(h - 0.3, y0 + h * (0.25 + 0.35 * rnd()));
    }
    const p: RuinPiece = { from: (len * i) / n, len: len / n, cut };
    if (left > 0) {
      left--;
      if (y1 > y0 + 0.3 && y1 < h - cut - 0.15) p.hole = { y0, y1 };
    }
    out.push(p);
  }
  return out;
}

/** How likely one roof segment is gone: 0 intact, 1 from {@link ROOFLESS} on. */
export function roofLoss(ruin: number): number {
  if (ruin <= 0.01) return 0;
  return ruin >= ROOFLESS ? 1 : Math.min(0.85, 0.12 + ruin * 1.1);
}

/** What is left of a roof along its run (`len` metres): kept stretches, holes in between (in clusters). */
export function roofRuns(len: number, ruin: number, rnd: () => number): { from: number; len: number }[] {
  const loss = roofLoss(ruin);
  if (loss === 0) return [{ from: 0, len }];
  if (loss === 1) return [];
  const n = Math.max(1, Math.round(len / 2.5));
  const out: { from: number; len: number }[] = [];
  let gone = false;
  for (let i = 0; i < n; i++) {
    // a hole tends to carry on into the next segment
    gone = rnd() < (gone ? Math.min(0.9, loss + 0.3) : loss * 0.7);
    if (gone) continue;
    const from = (len * i) / n, last = out[out.length - 1];
    if (last && Math.abs(last.from + last.len - from) < 1e-6) last.len += len / n;
    else out.push({ from, len: len / n });
  }
  return out;
}

/** What is left of a flat roof over a rectangle: kept cells (about 3 m), merged along x. */
export function roofCells(x0: number, x1: number, z0: number, z1: number, ruin: number, rnd: () => number): { x0: number; x1: number; z0: number; z1: number }[] {
  const loss = roofLoss(ruin);
  if (loss === 0) return [{ x0, x1, z0, z1 }];
  if (loss === 1) return [];
  const rows = Math.max(1, Math.round((z1 - z0) / 3));
  const out: { x0: number; x1: number; z0: number; z1: number }[] = [];
  for (let r = 0; r < rows; r++) {
    const za = z0 + ((z1 - z0) * r) / rows, zb = z0 + ((z1 - z0) * (r + 1)) / rows;
    for (const run of roofRuns(x1 - x0, ruin, rnd)) out.push({ x0: x0 + run.from, x1: x0 + run.from + run.len, z0: za, z1: zb });
  }
  return out;
}

/** The seeded random generator of one building's ruin (by id), so it looks the same every time it is built. */
export function ruinRandom(id: string): () => number {
  let s = 7;
  for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) % 2147483647;
  return createRandom(s || 7);
}
