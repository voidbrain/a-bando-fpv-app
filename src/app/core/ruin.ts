/**
 * Ruined buildings: a `ruin` level from 0 (intact) to 1 (a shell). The roof goes first: holes from any ruin, gone
 * from {@link ROOFLESS}; the upper floor slabs go from {@link NO_SLABS}. Once a building is open to the sky (no roof,
 * or an open shell) its walls lose their upper part along one smooth, broken line, never holes lower down. Seeded,
 * so the same building always crumbles the same way. Pure.
 */
import { createRandom } from './site-spec';

export const ROOFLESS = 0.6;
export const NO_SLABS = 0.75;

/**
 * The broken top of one wall `len` long and `h` high (the whole building, all floors): how high it still stands at
 * each point along it. A smooth line through a few seeded heights about 7 m apart, so walls fall in broad bites, with
 * a little roughness on the edge. `ruin` 0 → the whole wall stands.
 */
export function wallTop(len: number, h: number, ruin: number, rnd: () => number): (x: number) => number {
  if (ruin <= 0.01 || len <= 0) return () => h;
  const n = Math.max(2, Math.ceil(len / 7) + 1);
  const knots = Array.from({ length: n }, () => Math.pow(rnd(), 0.8));
  const phase = rnd() * 100;
  return (x: number): number => {
    const u = Math.min(n - 1, Math.max(0, (x / len) * (n - 1)));
    const i = Math.floor(u), f = u - i, c = (1 - Math.cos(Math.PI * f)) / 2;
    const smooth = knots[i]! * (1 - c) + knots[Math.min(i + 1, n - 1)]! * c;
    const lost = Math.min(0.95, ruin * (0.35 + 0.9 * smooth)); // the share of the height that has fallen
    const rough = 0.25 * Math.sin(x * 2.3 + phase) * Math.sin(x * 0.9 + phase * 0.7);
    return Math.max(0, Math.min(h, h * (1 - lost) + rough));
  };
}

/**
 * The standing pieces of one stretch of wall, from `from` to `from + len` along it (metres), between heights
 * `bottom` and `top` of the building, cut to the broken line `standing` (absent = the wall is whole).
 */
export function wallPieces(from: number, len: number, bottom: number, top: number, standing?: (x: number) => number): { from: number; len: number; top: number }[] {
  if (!standing) return [{ from, len, top }];
  const n = Math.max(1, Math.round(len / 1.5));
  const out: { from: number; len: number; top: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = from + (len * i) / n, t = Math.min(top, standing(a + len / n / 2));
    if (t - bottom > 0.05) out.push({ from: a, len: len / n, top: t });
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
