import type { WallSpec } from './site-spec';

/** What a free-standing wall or fence is made of: drives its look, default size and whether you can see through it. */
export type FenceMaterial = 'masonry' | 'concrete' | 'brick' | 'wood' | 'metal' | 'chainlink';

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
}

export const FENCES: readonly FenceDef[] = [
  { id: 'masonry', label: 'Masonry wall', hint: 'Rendered block wall', color: '#b9b2a2', height: 2.2, thick: 0.3, post: 0 },
  { id: 'concrete', label: 'Concrete panels', hint: 'Precast panels between posts', color: '#a9aaa0', height: 2.5, thick: 0.2, post: 2.5 },
  { id: 'brick', label: 'Brick wall', hint: 'Old red brick', color: '#a65a3f', height: 2, thick: 0.35, post: 0 },
  { id: 'wood', label: 'Wooden fence', hint: 'Boards on posts', color: '#8a6440', height: 1.8, thick: 0.08, post: 2 },
  { id: 'metal', label: 'Metal sheets', hint: 'Corrugated steel hoarding', color: '#8d979a', height: 2.2, thick: 0.05, post: 2.5 },
  { id: 'chainlink', label: 'Chain-link fence', hint: 'Wire mesh on steel posts, see-through', color: '#9aa4a6', height: 2, thick: 0.04, post: 3, mesh: true },
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
