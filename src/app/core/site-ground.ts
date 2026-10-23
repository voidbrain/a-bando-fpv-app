import { digWater, levelRoad, waterLevel } from './layers';
import { basementVolume, cutMask } from './underground';
import { outlineOf } from './openings';
import type { BuildingSpec, SiteSpec, UndergroundSpec, Vec2 } from './site-spec';
import { buildHeights, flattenPad, hasTerrainBase, heightAt, type FlatPad, type HeightGrid } from './terrain';

/** The ground of a site: the height grid (null = flat at y = 0) and where each building and the take-off pad stand. */
export interface SiteGround {
  grid: HeightGrid | null;
  /** Base height of each building (its levelled pad), by id. */
  building: ReadonlyMap<string, number>;
  /** Height of the take-off pad. */
  start: number;
  /** The water level of each `spec.waters` entry, same order. */
  water: readonly number[];
  /** Grid vertices where the ground is cut by an underground volume (null = nothing cut). */
  cut: Uint8Array | null;
  /** Every underground volume: the spec's own plus the buildings' basements (for the collider). */
  vols: readonly UndergroundSpec[];
  at(x: number, z: number): number;
}

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

let memo: { key: string; out: SiteGround } | null = null;

/**
 * Build (or reuse) the ground of a spec, in this order: real ground + strokes (feathered at the edges), water basins
 * dug, roads levelled across, then every building and the take-off pad on level ground. Remembered for the last input:
 * the scene is rebuilt on every edit, the ground rarely changes.
 */
export function siteGround(spec: SiteSpec): SiteGround {
  const t = spec.terrain;
  const waters = spec.waters ?? [];
  if (!t) {
    const water = waters.map((w) => waterLevel(null, w));
    const vols = [...(spec.underground ?? []), ...spec.buildings.map((b) => basementVolume(b, siteOutline(b), 0)).filter((v): v is UndergroundSpec => !!v)];
    return { grid: null, building: new Map(), start: 0, water, cut: null, vols, at: () => 0 };
  }
  const pads: FlatPad[] = [...spec.buildings.map((b) => ({ poly: siteOutline(b) })), { poly: square(spec.droneStart, 3) }];
  const basements = spec.buildings.map((b) => b.basement?.height ?? 0);
  const key = JSON.stringify([t, pads, spec.roads ?? [], waters, spec.underground ?? [], basements, t.base ? hasTerrainBase(t.base.key) : false]);
  if (memo?.key === key) return memo.out;
  const { grid } = buildHeights(t);
  const water = waters.map((w) => digWater(grid, w));
  for (const r of spec.roads ?? []) levelRoad(grid, r);
  const ys = pads.map((p) => flattenPad(grid, p));
  const building = new Map(spec.buildings.map((b, i) => [b.id, ys[i] ?? 0]));
  const vols = [...(spec.underground ?? []), ...spec.buildings.map((b, i) => basementVolume(b, pads[i]!.poly, ys[i] ?? 0)).filter((v): v is UndergroundSpec => !!v)];
  const cut = vols.length ? cutMask(grid, vols) : null;
  const out: SiteGround = { grid, building, start: ys[ys.length - 1] ?? 0, water, cut, vols, at: (x, z) => heightAt(grid, x, z) };
  memo = { key, out };
  return out;
}
