import { describe, expect, it } from 'vitest';
import { addOpening, listOpenings, moveOpening, patchOpening, reshapeBuilding } from './openings';
import { emptySpec, type BuildingSpec } from './site-spec';

const building = (): BuildingSpec => ({
  id: 'b', name: 'B', pos: { x: 100, z: 50 }, rotDeg: 0, length: 20, width: 12,
  levels: [{ baseY: 0, height: 4, sides: { n: true, s: true, e: true, w: true }, doors: {}, partitions: [], roof: 'gable', roofRise: 2 }],
});

describe('openings & reshaping', () => {
  it('adds a window with a sill on the nearest wall and moves it along the wall', () => {
    const b = building();
    const id = addOpening(b, 0, { x: 2, z: 6.1 }, 'window', 3)!;
    expect(id).toBeTruthy();
    let o = listOpenings(b, 0)[0]!;
    expect(o.axis).toBe('x');
    expect(o.sill).toBeGreaterThan(0);
    moveOpening(b, 0, id, 7);
    o = listOpenings(b, 0)[0]!;
    expect(o.c).toBeCloseTo(7, 1);
    patchOpening(b, 0, id, { sill: 1.1, h: 1.4 });
    expect(listOpenings(b, 0)[0]!.sill).toBeCloseTo(1.1, 3);
  });

  it('keeps openings and the world position when a notch is cut', () => {
    const b = building();
    addOpening(b, 0, { x: -8, z: 6 }, 'door', 3);
    const before = { ...b.pos };
    expect(reshapeBuilding(b, { x0: 0, x1: 6, z0: -6, z1: 0 }, 'cut')).toBe(true);
    expect(b.footprint).toBeTruthy();
    expect(listOpenings(b, 0).length).toBe(1);
    // the bounding box did not change, so neither does the position
    expect(b.pos.x).toBeCloseTo(before.x, 3);
    expect(b.pos.z).toBeCloseTo(before.z, 3);
  });

  it('drops an opening whose wall was cut away', () => {
    const b = building();
    addOpening(b, 0, { x: 2, z: -6 }, 'window', 3);
    expect(reshapeBuilding(b, { x0: -5, x1: 8, z0: -6, z1: -2 }, 'cut')).toBe(true);
    expect(listOpenings(b, 0).length).toBe(0);
  });

  it('refuses to split a building in two', () => {
    const b = building();
    expect(reshapeBuilding(b, { x0: -1, x1: 1, z0: -7, z1: 7 }, 'cut')).toBe(false);
    expect(emptySpec().buildings.length).toBe(0);
  });
});
