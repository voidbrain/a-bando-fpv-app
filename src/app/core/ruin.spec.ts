import { describe, expect, it } from 'vitest';
import { ROOFLESS, roofCells, roofRuns, ruinRandom, wallPieces, wallTop } from './ruin';

describe('ruined walls', () => {
  it('an intact wall stands whole', () => {
    const top = wallTop(30, 12, 0, ruinRandom('a'));
    expect(top(0)).toBe(12);
    expect(top(17)).toBe(12);
    expect(wallPieces(0, 10, 0, 4)).toEqual([{ from: 0, len: 10, top: 4 }]);
  });

  it('a ruined wall loses only its upper part, along a smooth line, more with more ruin', () => {
    const lost = (ruin: number): number[] => Array.from({ length: 60 }, (_, i) => 12 - wallTop(60, 12, ruin, ruinRandom('b'))(i));
    const light = lost(0.2), heavy = lost(0.8);
    expect(Math.max(...light)).toBeLessThan(5);
    expect(heavy.reduce((a, x) => a + x, 0)).toBeGreaterThan(light.reduce((a, x) => a + x, 0) * 2);
    // smooth: neighbouring metres differ by little (no jagged teeth)
    for (let i = 1; i < heavy.length; i++) expect(Math.abs(heavy[i]! - heavy[i - 1]!)).toBeLessThan(1.5);
  });

  it('the pieces of a stretch stop at the broken line and never leave a hole lower down', () => {
    const standing = wallTop(40, 20, 0.7, ruinRandom('c'));
    const lower = wallPieces(0, 40, 0, 4, standing), upper = wallPieces(0, 40, 16, 20, standing);
    expect(lower.reduce((a, p) => a + p.len, 0)).toBeCloseTo(40); // the ground floor stands all along
    expect(upper.length).toBeLessThan(lower.length); // the top floor has fallen in places
    for (const p of upper) expect(p.top).toBeLessThanOrEqual(20);
    expect(wallTop(40, 20, 0.7, ruinRandom('c'))(13)).toBe(standing(13)); // the same wall falls the same way
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
