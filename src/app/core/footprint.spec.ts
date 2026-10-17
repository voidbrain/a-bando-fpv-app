import { describe, expect, it } from 'vitest';
import { area, bounds, combine, rectPoly, rectilinear, slabs } from './footprint';

describe('footprint', () => {
  it('cuts a notch out of a rectangle (U shape) and keeps the area right', () => {
    const u = combine(rectPoly(20, 10), { x0: -4, x1: 4, z0: -5, z1: 1 }, 'cut');
    expect(u).not.toBeNull();
    expect(u!.length).toBe(8);
    expect(area(u!)).toBeCloseTo(200 - 8 * 6, 3);
  });

  it('builds an H from a rectangle with two notches', () => {
    const a = combine(rectPoly(20, 12), { x0: -3, x1: 3, z0: -6, z1: -1 }, 'cut')!;
    const h = combine(a, { x0: -3, x1: 3, z0: 1, z1: 6 }, 'cut')!;
    expect(area(h)).toBeCloseTo(240 - 30 - 30, 3);
    expect(slabs(h).reduce((s, r) => s + (r.x1 - r.x0) * (r.z1 - r.z0), 0)).toBeCloseTo(180, 3);
  });

  it('adds a wing and refuses a cut that splits the building', () => {
    const l = combine(rectPoly(10, 10), { x0: 5, x1: 12, z0: -5, z1: 0 }, 'add')!;
    expect(bounds(l).x1).toBe(12);
    expect(combine(rectPoly(10, 10), { x0: -1, x1: 1, z0: -6, z1: 6 }, 'cut')).toBeNull();
  });

  it('snaps a slightly crooked L outline to a rectilinear one', () => {
    const ring = [{ x: 0, z: 0 }, { x: 20, z: 0.3 }, { x: 20.2, z: 8 }, { x: 10, z: 8.1 }, { x: 10.1, z: 14 }, { x: 0, z: 14.2 }];
    const p = rectilinear(ring);
    expect(p).not.toBeNull();
    expect(p!.length).toBe(6);
  });
});
