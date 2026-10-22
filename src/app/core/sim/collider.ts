import type { Vec3 } from '../math3d';
import { heightAt, type HeightGrid } from '../terrain';

/** Axis-aligned box [x0, x1, y0, y1, z0, z1, isRoof] in unscaled model coordinates. */
export type SolidBox = readonly [number, number, number, number, number, number, boolean];
/** Vertical tree trunk/crown: [x, z, radius, topHeight, baseHeight (default 0)]. */
export type TreeCylinder = readonly [number, number, number, number, number?];

/** Anything the drone can bump into. Implemented by {@link SiteCollider}; tests can supply a fake. */
export interface CollisionWorld {
  hit(p: Vec3): boolean;
  /** Ground height under (x, z), world (scaled) metres. Absent = flat at 0. */
  groundAt?(x: number, z: number): number;
}

/**
 * Collision geometry of the site: boxes for walls, piers and roofs, cylinders for trees.
 * Coordinates are stored unscaled; {@link scale} is the model scale so resizing the model keeps collisions in step.
 * When {@link roofHidden} is on, roof boxes are ignored (the roof is invisible, so it must not be solid either).
 */
export class SiteCollider implements CollisionWorld {
  scale = 1;
  roofHidden = false;
  /** Clearance around the drone, metres (unscaled by the model scale). */
  readonly margin = 0.15;

  constructor(
    readonly solids: readonly SolidBox[] = [],
    readonly trees: readonly TreeCylinder[] = [],
    /** Terrain heights (unscaled); null = flat ground at 0. */
    readonly ground: HeightGrid | null = null,
  ) {}

  groundAt(x: number, z: number): number {
    const k = this.scale;
    return heightAt(this.ground, x / k, z / k) * k;
  }

  hit(p: Vec3): boolean {
    const k = this.scale;
    const x = p.x / k, y = p.y / k, z = p.z / k;
    const m = this.margin / k;
    for (const b of this.solids) {
      if (b[6] && this.roofHidden) continue;
      if (x > b[0] - m && x < b[1] + m && y > b[2] - m && y < b[3] + m && z > b[4] - m && z < b[5] + m) return true;
    }
    for (const t of this.trees) {
      if (y < t[3] && y > (t[4] ?? -Infinity) && Math.hypot(x - t[0], z - t[1]) < t[2] + m) return true;
    }
    return false;
  }
}
