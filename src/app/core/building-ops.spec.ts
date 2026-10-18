import { describe, expect, it } from 'vitest';
import { addFloor, buildingsOverlap, mergeBuildings, overlapsOthers, removeFloor } from './building-ops';
import { addOpening, listOpenings } from './openings';
import { emptySpec, type BuildingSpec } from './site-spec';

const mk = (id: string, x: number, z: number, L: number, W: number, rot = 0): BuildingSpec => ({
  id, name: id, pos: { x, z }, rotDeg: rot, length: L, width: W,
  levels: [{ baseY: 0, height: 4, sides: { n: true, s: true, e: true, w: true }, doors: {}, partitions: [], roof: 'gable', roofRise: 2 }],
});

describe('building ops', () => {
  it('adds a floor that copies the last one and moves the roof up', () => {
    const b = mk('a', 0, 0, 20, 10);
    addOpening(b, 0, { x: 0, z: 5 }, 'door', 2);
    b.levels[0]!.partitions.push([{ x: 10, z: 0 }, { x: 10, z: 10 }]);
    b.levels[0]!.voids = [{ x0: 2, z0: 2, x1: 4, z1: 4, water: true }];
    addFloor(b);
    expect(b.levels.length).toBe(2);
    expect(b.levels[0]!.roof).toBe('none');
    expect(b.levels[1]!.roof).toBe('gable');
    expect(b.levels[1]!.baseY).toBe(4);
    expect(listOpenings(b, 1).length).toBe(1);
    expect(b.levels[1]!.partitions.length).toBe(1);
    expect(b.levels[1]!.voids![0]!.water).toBeUndefined();
    removeFloor(b, 1);
    expect(b.levels[0]!.roof).toBe('gable');
  });

  it('detects buildings placed inside or across each other, but not neighbours', () => {
    const a = mk('a', 0, 0, 20, 10);
    expect(buildingsOverlap(a, mk('b', 3, 0, 4, 4))).toBe(true);
    expect(buildingsOverlap(a, mk('c', 20, 0, 20, 10))).toBe(false); // wall to wall with a gap of 0
    expect(buildingsOverlap(a, mk('d', 19.95, 0, 20, 10))).toBe(false); // 5 cm overlap is tolerated
    const s = emptySpec();
    s.buildings = [a, mk('e', 25, 0, 20, 10, 45)];
    expect(overlapsOthers(s, 'a')).toBe(false);
  });

  it('merges two touching buildings into one shaped building and carries the interior', () => {
    const s = emptySpec();
    const a = mk('a', 0, 0, 20, 10), b = mk('b', 0, 10, 10, 10);
    b.levels[0]!.partitions.push([{ x: 0, z: 5 }, { x: 10, z: 5 }]);
    s.buildings = [a, b];
    expect(mergeBuildings(s, 'a', 'b')).toBeNull();
    expect(s.buildings.length).toBe(1);
    const m = s.buildings[0]!;
    expect(m.footprint?.length).toBe(8); // a T
    expect(m.length).toBeCloseTo(20, 3);
    expect(m.width).toBeCloseTo(20, 3);
    expect(m.levels[0]!.partitions.length).toBe(1);
  });

  it('refuses to merge buildings that do not touch or point different ways', () => {
    const s = emptySpec();
    s.buildings = [mk('a', 0, 0, 20, 10), mk('b', 0, 40, 10, 10)];
    expect(mergeBuildings(s, 'a', 'b')).toMatch(/touch/);
    s.buildings = [mk('a', 0, 0, 20, 10), mk('b', 0, 10, 10, 10, 30)];
    expect(mergeBuildings(s, 'a', 'b')).toMatch(/directions/);
  });
});
