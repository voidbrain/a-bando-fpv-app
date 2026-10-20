import { describe, expect, it } from 'vitest';
import { placeColumn } from './placement';
import type { BuildingSpec } from './site-spec';

const hall = (cols: { x: number; z: number }[] = []): BuildingSpec => ({
  id: 'h', name: 'Hall', pos: { x: 0, z: 0 }, rotDeg: 20, length: 30, width: 12,
  levels: [{ baseY: 0, height: 4, sides: { n: true, s: true, e: true, w: true }, doors: {}, partitions: [], roof: 'flat', roofRise: 0, columns: cols.map((c) => ({ ...c, size: 0.6 })) }],
});

describe('column placement helpers', () => {
  it('snaps to the grid when there is nothing to align with, and reports the distances to the walls', () => {
    const p = placeColumn(hall(), 0, { x: 7.1, z: 4.9 });
    expect([p.x, p.z]).toEqual([7, 5]);
    expect(p.valid).toBe(true);
    const walls = p.labels.filter((l) => l.kind === 'wall').map((l) => l.text).sort();
    expect(walls).toEqual(['12 m'.replace('12', '7'), '23 m', '5 m', '7 m'].sort()); // west 7, east 23, north 5, south 7
  });

  it('aligns with another column on the same line and draws the alignment guide', () => {
    const p = placeColumn(hall([{ x: 4, z: 3 }]), 0, { x: 11.9, z: 3.2 }, { tol: 0.4 });
    expect(p.z).toBe(3); // same row as the existing column
    expect(p.snapped.z).toBe('align');
    expect(p.guides.some((g) => g.kind === 'align' && g.z0 === 3 && g.z1 === 3)).toBe(true);
    expect(p.labels.some((l) => l.kind === 'dist' && l.text === '8 m')).toBe(true); // 12 - 4
  });

  it('finds equal spacing between two columns, and continues the rhythm of two', () => {
    const mid = placeColumn(hall([{ x: 4, z: 6 }, { x: 14, z: 6 }]), 0, { x: 8.7, z: 6 }, { tol: 0.5 });
    expect(mid.x).toBe(9);
    expect(mid.snapped.x).toBe('equal');
    expect(mid.labels.filter((l) => l.kind === 'equal').length).toBe(2); // 5 m | 5 m
    const next = placeColumn(hall([{ x: 4, z: 6 }, { x: 10, z: 6 }]), 0, { x: 15.8, z: 6 }, { tol: 0.5 });
    expect(next.x).toBe(16);
    expect(next.snapped.x).toBe('rhythm');
  });

  it('is invalid outside the building, in a void, or on another column; moving ignores itself', () => {
    expect(placeColumn(hall(), 0, { x: 40, z: 5 }).valid).toBe(false);
    const withVoid = hall();
    withVoid.levels[0]!.voids = [{ x0: 10, z0: 2, x1: 14, z1: 8 }];
    expect(placeColumn(withVoid, 0, { x: 12, z: 5 }).valid).toBe(false);
    expect(placeColumn(hall([{ x: 5, z: 5 }]), 0, { x: 5, z: 5 }).valid).toBe(false);
    expect(placeColumn(hall([{ x: 5, z: 5 }]), 0, { x: 5, z: 5 }, { ignore: 0 }).valid).toBe(true);
  });
});
