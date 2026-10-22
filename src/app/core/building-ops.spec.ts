import { describe, expect, it } from 'vitest';
import { stairsFor, addFloor, buildingsOverlap, columnGrid, columnRow, convertBuilding, duplicateColumn, duplicateColumns, fillModule, mergeBuildings, overlapsOthers, removeFloor, repeatOpening } from './building-ops';
import { addOpening, listOpenings, patchOpening } from './openings';
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

describe('repeating and converting', () => {
  const room = (): BuildingSpec => mk('r', 0, 0, 20, 10);

  it('duplicates a column, makes a row, and fills the floor with a grid that avoids voids', () => {
    const b = room();
    b.levels[0]!.columns = [{ x: 2, z: 2, size: 0.6 }];
    expect(duplicateColumn(b, 0, 0, 3, 0)).toBe(1);
    expect(duplicateColumn(b, 0, 0, 3, 0)).toBe(-1); // already there
    expect(duplicateColumn(b, 0, 0, 100, 0)).toBe(-1); // outside
    expect(columnRow(b, 0, 0, 4, 4, 'z')).toBe(1); // z = 6 fits; z = 10 is on the wall and 14 is outside
    const g = room();
    g.levels[0]!.columns = [{ x: 2, z: 2, size: 0.5 }];
    g.levels[0]!.voids = [{ x0: 8, z0: 3, x1: 12, z1: 7 }];
    const n = columnGrid(g, 0, 0, 4, 4, 0.8);
    expect(n).toBeGreaterThan(3);
    for (const c of g.levels[0]!.columns!) expect(c.x > 8 && c.x < 12 && c.z > 3 && c.z < 7).toBe(false);
  });

  it('fills a floor evenly with the same clear space from the wall on both sides, and no column touches a wall', () => {
    const b = room(); // 20 x 10
    b.levels[0]!.columns = [{ x: 9, z: 5, size: 0.6 }];
    const n = columnGrid(b, 0, 0, 5, 4, 0.8);
    const cols = b.levels[0]!.columns!;
    expect(cols.length).toBe(n);
    const xs = [...new Set(cols.map((c) => c.x))].sort((p, q) => p - q), zs = [...new Set(cols.map((c) => c.z))].sort((p, q) => p - q);
    // symmetric: the first and last rows are the same distance from their walls
    expect(xs[0]!).toBeCloseTo(20 - xs[xs.length - 1]!, 2);
    expect(zs[0]!).toBeCloseTo(10 - zs[zs.length - 1]!, 2);
    // clear gap of at least 0.8 m between a column's edge and the wall's inner face (wall half thickness 0.25)
    const edge = Math.min(xs[0]!, zs[0]!) - 0.3 - 0.25;
    expect(edge).toBeGreaterThanOrEqual(0.8 - 1e-6);
    // the spacing is the one asked for
    expect(xs[1]! - xs[0]!).toBeCloseTo(5, 2);
    expect(zs[1]! - zs[0]!).toBeCloseTo(4, 2);
  });

  it('repeats a window along its wall without overlapping or leaving the wall', () => {
    const b = room();
    const id = addOpening(b, 0, { x: -8, z: 5 }, 'window', 2)!;
    patchOpening(b, 0, id, { closed: true });
    expect(repeatOpening(b, 0, id, 20, 3)).toBeGreaterThan(3);
    const all = listOpenings(b, 0);
    expect(all.every((o) => o.closed)).toBe(true);
    expect(all.every((o) => o.c - o.w / 2 >= o.from && o.c + o.w / 2 <= o.to)).toBe(true);
  });

  it('converts a building to a greenhouse and back, dropping the interior', () => {
    const b = room();
    b.width = 30;
    b.levels[0]!.partitions.push([{ x: 1, z: 1 }, { x: 5, z: 1 }]);
    convertBuilding(b, 'greenhouse');
    expect(b.frame).toBe('greenhouse');
    expect(b.length).toBe(30); // the tunnel follows the long side
    expect(b.levels[0]!.partitions.length).toBe(0);
    convertBuilding(b, 'building');
    expect(b.frame).toBeUndefined();
    expect(b.levels[0]!.roof).toBe('gable');
  });
});

describe('stairs on a floor', () => {
  it('stands on its floor, follows the building axes, and opens a hole in the floor above only where it arrives', () => {
    const b = mk('s', 100, 50, 20, 10, 30);
    addFloor(b);
    const r = stairsFor(b, 0, { x: 6, z: 5 }, 'stairs', { length: 5.4, size: 1.4, name: 'Stairs' });
    expect(r.structure).toMatchObject({ kind: 'stairs', y: 0, height: 4, rotDeg: 30, size: 1.4 });
    // 4 m at an 18 cm riser: about 22 steps of 28 cm = 6.2 m of run
    expect(r.structure.length).toBeCloseTo(6.2, 1);
    // world position: the point (6, 5) from the min corner is (-4, 0) from the centre, turned by 30 degrees
    expect(r.structure.x).toBeCloseTo(100 + -4 * Math.cos(Math.PI / 6), 3);
    expect(r.structure.z).toBeCloseTo(50 + -4 * Math.sin(Math.PI / 6), 3);
    expect(r.voidAbove).toMatchObject({ x0: 6, z0: 5 - 0.7 - 0.15, z1: 5 + 0.7 + 0.15 });
    expect(r.voidAbove!.x1).toBeCloseTo(6 + 6.2 / 2 + 0.3, 3);
    // the top floor has nothing above it
    expect(stairsFor(b, 1, { x: 6, z: 5 }, 'ramp', { length: 10, size: 3, name: 'Ramp' }).voidAbove).toBeNull();
  });
});

describe('column modules', () => {
  const hall = (): BuildingSpec => ({
    id: 'h', name: 'H', pos: { x: 0, z: 0 }, rotDeg: 0, length: 40, width: 20,
    levels: [{ baseY: 0, height: 5, sides: { n: true, s: true, e: true, w: true }, doors: {}, partitions: [], roof: 'flat', roofRise: 0, columns: [{ x: 10, z: 10, size: 0.6 }, { x: 15, z: 10, size: 0.6 }] }],
  });
  it('fills the floor on the lattice of the selected columns and keeps clear of the walls', () => {
    const b = hall();
    const n = fillModule(b, 0, [0, 1], 4);
    expect(n).toBeGreaterThan(5);
    const cols = b.levels[0]!.columns!;
    expect(cols.every((c) => (c.x - 10) % 5 === 0 || Math.abs(((c.x - 10) % 5 + 5) % 5) < 0.01 || Math.abs(((c.x - 10) % 5 + 5) % 5 - 5) < 0.01)).toBe(true);
    expect(cols.every((c) => c.x > 1 && c.x < 39 && c.z > 1 && c.z < 19)).toBe(true);
    expect(new Set(cols.map((c) => `${c.x}/${c.z}`)).size).toBe(cols.length);
  });
  it('duplicates a selection as one module', () => {
    const b = hall();
    expect(duplicateColumns(b, 0, [0, 1], 0, 5).length).toBe(2);
    expect(b.levels[0]!.columns!.length).toBe(4);
  });
});

describe('merge across a gap', () => {
  it('closes a small gap and merges; refuses (and leaves the building where it was) when too far', () => {
    const s = emptySpec({ lat: 45, lon: 12 }, 'T');
    s.buildings = [mk('a', 0, 0, 20, 10), mk('b', 21.5, 0, 10, 10)]; // 21.5 - 5 = 16.5 .. gap of 6.5? no: a ends at 10, b starts at 16.5
    expect(mergeBuildings(s, 'a', 'b')).not.toBeNull();
    expect(s.buildings.find((x) => x.id === 'b')!.pos.x).toBe(21.5);
    s.buildings = [mk('a', 0, 0, 20, 10), mk('b', 17, 0, 10, 10)]; // a ends 10, b starts 12: a 2 m gap
    expect(mergeBuildings(s, 'a', 'b')).toBeNull();
    expect(s.buildings.length).toBe(1);
    expect(s.buildings[0]!.length).toBeCloseTo(30);
  });
});
