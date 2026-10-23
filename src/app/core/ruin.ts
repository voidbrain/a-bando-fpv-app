/**
 * Ruined buildings: a `ruin` level from 0 (intact) to 1 (a shell). Walls break into pieces with jagged tops, more so
 * on the upper floors; the roof is gone from {@link ROOFLESS}, the upper floor slabs from {@link NO_SLABS}. Seeded, so
 * the same building always crumbles the same way. Pure.
 */
import { createRandom } from './site-spec';

export const ROOFLESS = 0.35;
export const NO_SLABS = 0.6;

export interface RuinPiece {
  /** Start along the wall and length (metres). */
  from: number;
  len: number;
  /** How much of its top is gone (metres); a piece with cut ≥ its height is missing entirely. */
  cut: number;
}

/**
 * Break one wall run (`len` long, `h` high) of floor `li` of `floors` into pieces. `ruin` 0 → one intact piece.
 * Higher floors lose more: the top floor up to the whole ruin level, the ground floor about a third of it.
 */
export function ruinPieces(len: number, h: number, ruin: number, li: number, floors: number, rnd: () => number): RuinPiece[] {
  if (ruin <= 0.01 || len < 0.05) return [{ from: 0, len, cut: 0 }];
  const upper = floors > 1 ? li / (floors - 1) : 1;
  const k = ruin * (0.35 + 0.65 * upper);
  const n = Math.max(1, Math.round(len / 1.5));
  const out: RuinPiece[] = [];
  for (let i = 0; i < n; i++) {
    const missing = rnd() < k * 0.45 * upper;
    const cut = missing ? h : h * k * Math.pow(rnd(), 0.8);
    out.push({ from: (len * i) / n, len: len / n, cut: Math.min(h, cut) });
  }
  return out;
}

/** The seeded random generator of one building's ruin (by id), so it looks the same every time it is built. */
export function ruinRandom(id: string): () => number {
  let s = 7;
  for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) % 2147483647;
  return createRandom(s || 7);
}
