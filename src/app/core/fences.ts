import type { WallSpec } from './site-spec';

/** What a free-standing wall or fence is made of: drives its look, default size and whether you can see through it. */
export type FenceMaterial = 'masonry' | 'concrete' | 'brick' | 'wood' | 'metal' | 'chainlink' | 'hedge' | 'bramble' | 'wires';

export interface FenceDef {
  id: FenceMaterial;
  label: string;
  hint: string;
  color: string;
  height: number;
  thick: number;
  /** Posts with a see-through mesh between them (still solid for the drone). */
  mesh?: boolean;
  /** Distance between posts, metres (0 = a continuous wall). */
  post: number;
  /** How it is drawn: a wall or fence (default), a lumpy living hedge, or poles with wires hanging between them. */
  look?: 'hedge' | 'wires';
}

export const FENCES: readonly FenceDef[] = [
  { id: 'masonry', label: 'Masonry wall', hint: 'Rendered block wall', color: '#b9b2a2', height: 2.2, thick: 0.3, post: 0 },
  { id: 'concrete', label: 'Concrete panels', hint: 'Precast panels between posts', color: '#a9aaa0', height: 2.5, thick: 0.2, post: 2.5 },
  { id: 'brick', label: 'Brick wall', hint: 'Old red brick', color: '#a65a3f', height: 2, thick: 0.35, post: 0 },
  { id: 'wood', label: 'Wooden fence', hint: 'Boards on posts', color: '#8a6440', height: 1.8, thick: 0.08, post: 2 },
  { id: 'metal', label: 'Metal sheets', hint: 'Corrugated steel hoarding', color: '#8d979a', height: 2.2, thick: 0.05, post: 2.5 },
  { id: 'chainlink', label: 'Chain-link fence', hint: 'Wire mesh on steel posts, see-through', color: '#9aa4a6', height: 2, thick: 0.04, post: 3, mesh: true },
  { id: 'hedge', label: 'Hedge', hint: 'A trimmed hedge, dense and solid', color: '#3f6b35', height: 1.8, thick: 1, post: 0, look: 'hedge' },
  { id: 'bramble', label: 'Bramble thicket', hint: 'Wild brambles, wide, uneven and impassable', color: '#4b5f2b', height: 1.6, thick: 2, post: 0, look: 'hedge' },
  { id: 'wires', label: 'Phone / power line', hint: 'Poles with wires hanging between them, drawn from pole to pole', color: '#6b5440', height: 8, thick: 0.3, post: 35, look: 'wires' },
];

export const fenceDef = (m: FenceMaterial | undefined): FenceDef => FENCES.find((f) => f.id === m) ?? FENCES[0]!;

/** A new wall of material `m` from `a` to `b`, with that material's default height and thickness. */
export function newFence(a: WallSpec['a'], b: WallSpec['b'], m: FenceMaterial = 'masonry'): WallSpec {
  const d = fenceDef(m);
  return { a, b, height: d.height, thick: d.thick, ...(m !== 'masonry' ? { material: m } : {}) };
}

/** Switch a wall to another material: height and thickness follow only when they still were the old material's defaults. */
export function setFenceMaterial(w: WallSpec, m: FenceMaterial): void {
  const from = fenceDef(w.material), to = fenceDef(m);
  if (Math.abs(w.height - from.height) < 0.01) w.height = to.height;
  if (Math.abs(w.thick - from.thick) < 0.01) w.thick = to.thick;
  if (m === 'masonry') delete w.material;
  else w.material = m;
  delete w.color;
}

/** Post positions along a wall (fractions 0..1 of its length), ends included; none for a continuous wall. */
export function postsAlong(len: number, m: FenceMaterial | undefined): number[] {
  const step = fenceDef(m).post;
  if (!step || len < 0.3) return [];
  const n = Math.max(1, Math.round(len / step));
  return Array.from({ length: n + 1 }, (_, i) => i / n);
}

/**
 * The wires of a line from pole to pole, sagging between them: for each span (fractions `t0`..`t1` of the line), points
 * along it at `drop` metres below the pole tops in the middle (a parabola). `n` points per span.
 */
export function wireSag(len: number, posts: readonly number[], sag = 0.03, n = 12): { t: number; drop: number }[][] {
  const spans: { t: number; drop: number }[][] = [];
  for (let i = 0; i + 1 < posts.length; i++) {
    const t0 = posts[i]!, t1 = posts[i + 1]!, span = (t1 - t0) * len;
    spans.push(Array.from({ length: n + 1 }, (_, k) => {
      const u = k / n;
      return { t: t0 + (t1 - t0) * u, drop: 4 * sag * span * u * (1 - u) };
    }));
  }
  return spans;
}

/** The lumps of a hedge along its length: every metre a height and a width factor (0.8–1.15), the same every time. */
export function hedgeLumps(len: number, seed: number, wild: boolean): { t: number; h: number; w: number }[] {
  const n = Math.max(1, Math.round(len));
  let s = (Math.abs(Math.round(seed * 1000)) % 2147483646) + 1;
  const rnd = (): number => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const spread = wild ? 0.35 : 0.12;
  return Array.from({ length: n }, (_, i) => ({ t: (i + 0.5) / n, h: 1 - spread / 2 + rnd() * spread, w: 1 - spread / 2 + rnd() * spread * 1.2 }));
}
