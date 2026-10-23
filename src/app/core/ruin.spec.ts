import { describe, expect, it } from 'vitest';
import { ROOFLESS, roofCells, roofRuns, ruinPieces, ruinRandom } from './ruin';

describe('ruined walls', () => {
  it('an intact wall is one piece', () => {
    expect(ruinPieces(10, 4, 0, 0, 1, ruinRandom('a'))).toEqual([{ from: 0, len: 10, cut: 0 }]);
  });

  it('a ruined wall breaks into pieces covering the whole run, cut no more than its height', () => {
    const p = ruinPieces(12, 4, 0.8, 1, 2, ruinRandom('b'));
    expect(p.length).toBe(8);
    expect(p.reduce((a, x) => a + x.len, 0)).toBeCloseTo(12);
    for (const x of p) expect(x.cut).toBeLessThanOrEqual(4);
    expect(p.some((x) => x.cut > 0.5)).toBe(true);
  });

  it('the top floor loses more than the ground floor; the same building crumbles the same way', () => {
    const lost = (li: number): number => ruinPieces(30, 4, 0.7, li, 3, ruinRandom('c')).reduce((a, x) => a + x.cut, 0);
    expect(lost(2)).toBeGreaterThan(lost(0));
    expect(ruinPieces(9, 3, 0.5, 0, 1, ruinRandom('d'))).toEqual(ruinPieces(9, 3, 0.5, 0, 1, ruinRandom('d')));
  });

  it('a light ruin keeps straight tops but has breaches through the wall, inside the piece', () => {
    const p = ruinPieces(60, 4, 0.15, 0, 1, ruinRandom('e'));
    expect(p.every((x) => x.cut === 0)).toBe(true);
    const holes = p.filter((x) => x.hole);
    expect(holes.length).toBeGreaterThan(0);
    for (const x of holes) {
      expect(x.hole!.y0).toBeGreaterThan(0);
      expect(x.hole!.y1).toBeLessThan(4 - x.cut);
    }
  });
});

describe('ruined roofs', () => {
  it('an intact roof is whole, a ruin has holes, past ROOFLESS it is gone', () => {
    expect(roofRuns(20, 0, ruinRandom('r'))).toEqual([{ from: 0, len: 20 }]);
    const runs = roofRuns(40, 0.3, ruinRandom('r'));
    const kept = runs.reduce((a, r) => a + r.len, 0);
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(40);
    for (const r of runs) expect(r.from + r.len).toBeLessThanOrEqual(40 + 1e-9);
    expect(roofRuns(40, ROOFLESS, ruinRandom('r'))).toEqual([]);
  });

  it('a flat roof keeps cells inside its rectangle', () => {
    const cells = roofCells(-10, 10, -6, 6, 0.3, ruinRandom('f'));
    const area = cells.reduce((a, c) => a + (c.x1 - c.x0) * (c.z1 - c.z0), 0);
    expect(area).toBeGreaterThan(0);
    expect(area).toBeLessThan(240);
    for (const c of cells) expect(c.x0 >= -10 && c.x1 <= 10 + 1e-9 && c.z0 >= -6 && c.z1 <= 6 + 1e-9).toBe(true);
  });
});
