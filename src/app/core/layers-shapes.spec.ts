import { describe, expect, it } from 'vitest';
import { insidePolygon, mergeWaters, polygonArea, polygonsTouch, stripOutline, unionOutline } from './layers';

const square = (x: number, z: number, s: number) => [{ x, z }, { x: x + s, z }, { x: x + s, z: z + s }, { x, z: z + s }];

describe('water shapes', () => {
  it('a strip along a line is as wide as asked and covers the line', () => {
    const o = stripOutline([{ x: 0, z: 0 }, { x: 20, z: 0 }], 6);
    expect(polygonArea(o)).toBeCloseTo(120);
    expect(insidePolygon(o, 10, 0)).toBe(true);
    expect(insidePolygon(o, 10, 4)).toBe(false);
    expect(stripOutline([{ x: 0, z: 0 }], 6)).toEqual([]);
  });

  it('overlapping outlines become one, about as big as both together', () => {
    const u = unionOutline([square(0, 0, 10), square(5, 5, 10)], 0.5);
    expect(polygonArea(u)).toBeGreaterThan(165);
    expect(polygonArea(u)).toBeLessThan(185); // 100 + 100 - 25 = 175
    expect(insidePolygon(u, 2, 2)).toBe(true);
    expect(insidePolygon(u, 13, 13)).toBe(true);
    expect(insidePolygon(u, 13, 2)).toBe(false);
  });
});

describe('merging water', () => {
  it('merges the selected water with the ones it overlaps, and leaves the rest', () => {
    const waters = [
      { pts: square(0, 0, 10), depth: 1 },
      { pts: square(100, 100, 5), depth: 1 },
      { pts: square(8, 8, 10), depth: 3 },
    ];
    const r = mergeWaters(waters, 2)!;
    expect(r.waters.length).toBe(2);
    expect(r.waters[r.index]!.depth).toBe(3);
    expect(insidePolygon(r.waters[r.index]!.pts, 2, 2)).toBe(true);
    expect(mergeWaters(waters, 1)).toBeNull(); // the far pond touches nothing
    expect(polygonsTouch(square(0, 0, 10), square(10, 0, 5))).toBe(true); // sharing an edge counts
  });
});
