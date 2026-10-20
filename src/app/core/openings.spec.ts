import { describe, expect, it } from 'vitest';
import { addOpening, listOpenings, moveOpening, patchOpening, previewOpening, reshapeBuilding } from './openings';
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

  it('carries columns and voids along when the building re-centres', () => {
    const b = building();
    b.levels[0]!.columns = [{ x: 15, z: 6, size: 0.6 }];
    b.levels[0]!.voids = [{ x0: 14, z0: 2, x1: 16, z1: 4 }];
    // cut the west end away: the bounding box shrinks from the left and the min corner moves 4 m east
    expect(reshapeBuilding(b, { x0: -10, x1: -6, z0: -6, z1: 6 }, 'cut')).toBe(true);
    expect(b.length).toBeCloseTo(16, 3);
    expect(b.levels[0]!.columns![0]!.x).toBeCloseTo(11, 3);
    expect(b.levels[0]!.voids![0]!.x0).toBeCloseTo(10, 3);
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

describe('opening preview', () => {
  it('shows exactly where a door would go, and the gaps to the wall ends and the neighbours', () => {
    const b = building();
    const first = addOpening(b, 0, { x: -5, z: 6 }, 'window', 2)!;
    expect(first).toBeTruthy();
    const pv = previewOpening(b, 0, { x: 3.04, z: 5.2 }, 'window', 2)!;
    expect(pv.axis).toBe('x');
    expect(pv.at).toBe(6); // the south wall of the 20 x 12 building
    expect(pv.c).toBeCloseTo(3, 1);
    expect(pv.gaps.length).toBe(2);
    expect(pv.gaps[1]!.d).toBeCloseTo(10 - 3 - 0.6, 1); // to the east end of the wall
    expect(pv.gaps[0]!.d).toBeCloseTo(3 - 0.6 - (-5 + 0.6), 1); // to the window at x = -5
    expect(previewOpening(b, 0, { x: 0, z: 0 }, 'door', 1)).toBeNull(); // the middle of the room is not near a wall
    // the preview and the real thing agree
    const id = addOpening(b, 0, { x: 3.04, z: 5.2 }, 'window', 2)!;
    expect(listOpenings(b, 0).find((o) => o.id === id)!.c).toBeCloseTo(pv.c, 5);
  });
});
