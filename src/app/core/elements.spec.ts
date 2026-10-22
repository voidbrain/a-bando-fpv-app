import { describe, expect, it } from 'vitest';
import { columnGroups, columnsInLine, convexHull, pointsInside, stairsIn, treeZones } from './elements';
import { emptySpec, type BuildingSpec, type ColumnSpec, type TreeSpec } from './site-spec';

const tree = (x: number, z: number): TreeSpec => ({ x, z, h: 8, r: 2, kind: 'd' });

describe('elements helpers', () => {
  it('hulls a square and ignores inner points', () => {
    const h = convexHull([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }, { x: 2, z: 2 }]);
    expect(h.length).toBe(4);
  });
  it('keeps one brush stroke as one zone and splits far-apart strokes', () => {
    const a = Array.from({ length: 20 }, (_, i) => tree(i * 5, (i % 3) * 3));
    const b = Array.from({ length: 5 }, (_, i) => tree(300 + i * 5, 200));
    const zones = treeZones([...a, ...b]);
    expect(zones.length).toBe(2);
    expect(zones[0]!.idx.length).toBe(20);
    expect(zones[1]!.idx.length).toBe(5);
    expect(zones[0]!.hull.length).toBeGreaterThan(3);
  });
  it('groups columns per row and leaves stragglers loose', () => {
    const c = (x: number, z: number) => ({ x, z, size: 0.6 });
    const cols = [c(2, 5), c(12, 5), c(22, 5), c(2, 15), c(12, 15), c(22, 15), c(7, 30)];
    const g = columnGroups(cols);
    expect(g.filter((x) => x.axis === 'x').length).toBe(2);
    expect(g[0]!.idx.length).toBe(3);
    expect(g[g.length - 1]!.axis).toBe('loose');
    expect(g[g.length - 1]!.idx).toEqual([6]);
  });
  it('finds the stairs inside a building and the floor they start on', () => {
    const s = emptySpec({ lat: 45, lon: 12 }, 'T');
    const lvl = (baseY: number) => ({ baseY, height: 3, sides: { n: true, s: true, e: true, w: true }, doors: {}, partitions: [], roof: 'flat' as const, roofRise: 0 });
    const b: BuildingSpec = { id: 'b', name: 'B', pos: { x: 0, z: 0 }, rotDeg: 0, length: 20, width: 10, levels: [lvl(0), lvl(3)] };
    s.buildings = [b];
    s.structures = [
      { id: 's1', kind: 'stairs', name: 'S', x: 2, z: 1, rotDeg: 0, y: 3, height: 3, size: 1.2, length: 4 },
      { id: 's2', kind: 'stairs', name: 'Out', x: 50, z: 0, rotDeg: 0, height: 3, size: 1.2 },
    ];
    const r = stairsIn(s, b);
    expect(r.length).toBe(1);
    expect(r[0]!.level).toBe(1);
  });
});

describe('selecting columns and points', () => {
  const grid: ColumnSpec[] = [0, 6, 12].flatMap((z) => [0, 6, 12, 18].map((x) => ({ x, z, size: 0.4 })));
  grid.push({ x: 3, z: 3, size: 0.8, round: true });

  it('finds the row, the line and the module of a column', () => {
    expect(columnsInLine(grid, 5, 'x')).toEqual([4, 5, 6, 7]); // z = 6
    expect(columnsInLine(grid, 5, 'z')).toEqual([1, 5, 9]); // x = 6
    expect(columnsInLine(grid, 0, 'grid')).toHaveLength(12);
    expect(columnsInLine(grid, 12, 'grid')).toEqual([12]);
    expect(columnsInLine(grid, 99, 'x')).toEqual([]);
  });

  it('keeps the points inside a box or a lasso', () => {
    expect(pointsInside(grid, [{ x: -1, z: -1 }, { x: 7, z: -1 }, { x: 7, z: 7 }, { x: -1, z: 7 }])).toEqual([0, 1, 4, 5, 12]);
    const lasso = [{ x: -1, z: -1 }, { x: 19, z: -1 }, { x: -1, z: 13 }]; // a triangle: the top-left half
    const hit = pointsInside(grid, lasso);
    expect(hit).toContain(0);
    expect(hit).not.toContain(11); // (18, 12) is outside
    expect(pointsInside(grid, [{ x: 0, z: 0 }])).toEqual([]);
  });
});
