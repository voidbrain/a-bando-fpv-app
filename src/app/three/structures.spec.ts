import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Vec3 } from '../core/math3d';
import { SiteCollider } from '../core/sim/collider';
import { emptySpec, type StructureSpec } from '../core/site-spec';
import { buildSiteFromSpec } from './site-model';
import { STRUCTURE_DEFAULTS, buildStructure } from './structures';

const mk = (kind: StructureSpec['kind'], o: Partial<StructureSpec> = {}): StructureSpec => ({ id: kind, kind, name: kind, x: 50, z: -20, rotDeg: 0, height: STRUCTURE_DEFAULTS[kind].height, size: STRUCTURE_DEFAULTS[kind].size, ...o });

describe('structures', () => {
  it('a chimney is a solid cylinder up to its height, centred where it stands', () => {
    const b = buildStructure(mk('chimney'));
    expect(b.cylinders).toEqual([[50, -20, expect.closeTo(1.8 * 0.78, 3), 35]]);
    const box = new THREE.Box3().setFromObject(b.object);
    expect(box.max.y).toBeCloseTo(35, 0);
    const c = new SiteCollider([], b.cylinders);
    expect(c.hit(new Vec3(50, 20, -20))).toBe(true);
    expect(c.hit(new Vec3(50, 36, -20))).toBe(false); // flying over the top is fine
    expect(c.hit(new Vec3(56, 20, -20))).toBe(false);
  });

  it('a water tower can be flown under: legs and tank block, the space between does not', () => {
    const b = buildStructure(mk('water_tower'));
    const c = new SiteCollider(b.solids, b.cylinders);
    const legH = 24 - Math.min(24 * 0.45, 4.5 * 1.6) - 4.5 * 0.25;
    expect(c.hit(new Vec3(50, legH + 2, -20))).toBe(true); // inside the tank
    expect(c.hit(new Vec3(50, 3, -20))).toBe(false); // under the tank, between the legs
    expect(c.hit(new Vec3(50 + 4.5 * 0.82, 3, -20))).toBe(true); // at a leg
  });

  it('a lattice tower is open between its legs', () => {
    const b = buildStructure(mk('lattice_tower'));
    const c = new SiteCollider(b.solids, b.cylinders);
    expect(c.hit(new Vec3(50 + 3, 0.5, -20 + 3))).toBe(true); // a leg at the base
    expect(c.hit(new Vec3(50, 10, -20))).toBe(false); // the middle of the lattice
  });

  it('a bridge has a solid deck, you can fly under it, and rotation turns it', () => {
    const b = buildStructure(mk('bridge', { length: 40, size: 8, height: 6 }));
    const c = new SiteCollider(b.solids, b.cylinders);
    expect(c.hit(new Vec3(50, 5.6, -20))).toBe(true); // in the deck
    expect(c.hit(new Vec3(50, 2, -20))).toBe(true); // a 40 m bridge has one pier in the middle
    expect(c.hit(new Vec3(60, 2, -20))).toBe(false); // but between the pier and the abutment you can fly under the deck
    const turned = buildStructure(mk('bridge', { length: 40, size: 8, height: 6, rotDeg: 90 }));
    const ct = new SiteCollider(turned.solids, turned.cylinders);
    expect(ct.hit(new Vec3(50, 5.6, -20 + 15))).toBe(true); // now it runs north-south
    expect(ct.hit(new Vec3(50 + 15, 5.6, -20))).toBe(false);
  });

  it('an arch bridge puts ribs under the deck, and the site builder includes all structures', () => {
    const spec = emptySpec({ lat: 0, lon: 0 }, 't');
    spec.structures = [mk('bridge', { style: 'arch', length: 50 }), mk('silo', { x: 0, z: 0 }), mk('tank', { x: 20, z: 0 })];
    const model = buildSiteFromSpec(spec, { bare: true });
    expect(model.collider.trees.length).toBe(2); // silo + tank
    expect(model.collider.solids.length).toBeGreaterThan(30);
  });
});
