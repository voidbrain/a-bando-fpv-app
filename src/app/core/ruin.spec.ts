import { describe, expect, it } from 'vitest';
import { ruinPieces, ruinRandom } from './ruin';

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
});
