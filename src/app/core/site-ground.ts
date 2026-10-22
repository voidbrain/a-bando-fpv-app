import { outlineOf } from './openings';
import type { BuildingSpec, SiteSpec, Vec2 } from './site-spec';
import { cachedHeights, heightAt, type FlatPad, type HeightGrid } from './terrain';

/** The ground of a site: the height grid (null = flat at y = 0) and where each building and the take-off pad stand. */
export interface SiteGround {
  grid: HeightGrid | null;
  /** Base height of each building (its levelled pad), by id. */
  building: ReadonlyMap<string, number>;
  /** Height of the take-off pad. */
  start: number;
  at(x: number, z: number): number;
}

const FLAT: SiteGround = { grid: null, building: new Map(), start: 0, at: () => 0 };

/** A building's outline in site metres (its footprint turned by `rotDeg` and moved to `pos`). */
export function siteOutline(b: BuildingSpec): Vec2[] {
  const a = (b.rotDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return outlineOf(b).map((p) => ({ x: b.pos.x + p.x * c - p.z * s, z: b.pos.z + p.x * s + p.z * c }));
}

const square = (p: Vec2, half: number): Vec2[] => [
  { x: p.x - half, z: p.z - half },
  { x: p.x + half, z: p.z - half },
  { x: p.x + half, z: p.z + half },
  { x: p.x - half, z: p.z + half },
];

/** Build (or reuse) the ground of a spec: terrain + strokes, every building and the take-off pad on level ground. */
export function siteGround(spec: SiteSpec): SiteGround {
  const t = spec.terrain;
  if (!t) return FLAT;
  const pads: FlatPad[] = [...spec.buildings.map((b) => ({ poly: siteOutline(b) })), { poly: square(spec.droneStart, 3) }];
  const { grid, pads: ys } = cachedHeights(t, pads);
  const building = new Map(spec.buildings.map((b, i) => [b.id, ys[i] ?? 0]));
  return { grid, building, start: ys[ys.length - 1] ?? 0, at: (x, z) => heightAt(grid, x, z) };
}
