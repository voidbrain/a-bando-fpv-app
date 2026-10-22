import { describe, expect, it } from 'vitest';
import { autoAlign, magnetAngle, snapBeside } from './align';
import { buildingsOverlap } from './building-ops';
import type { BuildingSpec } from './site-spec';

const bld = (id: string, x: number, z: number, l: number, w: number, rot = 0): BuildingSpec => ({ id, name: id, pos: { x, z }, rotDeg: rot, length: l, width: w, levels: [] });

describe('align', () => {
  it('closes a small gap flush and lines up a nearly aligned edge', () => {
    const a = bld('a', 0, 0, 20, 10), b = bld('b', 11.5, 0.8, 10, 6);
    // a spans x -10..10, b starts at 6.5..16.5?? no: b centre 11.5, half 5 -> 6.5..16.5 overlaps
    expect(snapBeside(a, b)).not.toBeNull();
    expect(b.pos.x).toBeCloseTo(15); // flush against the east wall (10 + 5)
    const c = bld('c', 0, 8.5, 20, 6); // 0.5 m gap on the south side (a ends z=5, c starts 5.5)
    snapBeside(a, c);
    expect(c.pos.z).toBeCloseTo(8);
  });

  it('pushes a clear overlap out along the shorter way and straightens a small angle', () => {
    const a = bld('a', 0, 0, 20, 10), b = bld('b', 0, 7, 10, 6, 4);
    snapBeside(a, b);
    expect(b.rotDeg).toBe(0);
    expect(b.pos.z).toBeCloseTo(8);
    expect(buildingsOverlap(a, b)).toBe(false);
  });

  it('leaves far or clearly turned buildings alone, and works on rotated neighbours', () => {
    const a = bld('a', 0, 0, 20, 10);
    expect(snapBeside(a, bld('far', 50, 0, 10, 10))).toBeNull();
    expect(snapBeside(a, bld('t', 12, 0, 10, 10, 40))).toBeNull();
    const r = bld('r', 0, 0, 20, 10, 90), n = bld('n', 0, -9, 10, 6, 90); // in r's frame n is 9 m to its local east... touching after snap
    snapBeside(r, n);
    expect(buildingsOverlap(r, n)).toBe(false);
  });

  it('autoAlign snaps to the nearest neighbours', () => {
    const a = bld('a', 0, 0, 20, 10), b = bld('b', 25, 0, 10, 10), n = bld('n', 14, 0.4, 8, 10);
    expect(autoAlign(n, [a, b])).toBeGreaterThan(0);
    expect(buildingsOverlap(n, a)).toBe(false);
  });
});

describe('magnetAngle', () => {
  it('sticks to the map axes and to a neighbour within the tolerance, and leaves other angles alone', () => {
    expect(magnetAngle(2, [])).toBe(0);
    expect(magnetAngle(358.5, [])).toBe(0);
    expect(magnetAngle(88, [])).toBe(90);
    expect(magnetAngle(33, [])).toBe(33);
    const n = bld('n', 0, 0, 10, 10, 30);
    expect(magnetAngle(32, [n])).toBe(30);
    expect(magnetAngle(122, [n])).toBe(120);
    expect(magnetAngle(40, [n])).toBe(40);
  });
});
