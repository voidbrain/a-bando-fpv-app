import { describe, expect, it } from 'vitest';
import { anglesAt, arcOf, nearestSnap, orthoSnap, snapTargets, fmtLength } from './measure';
import { emptySpec } from './site-spec';

describe('measure helpers', () => {
  it('magnetises to building corners and trees, and only when close', () => {
    const s = emptySpec({ lat: 45, lon: 12 }, 'T');
    s.buildings = [{ id: 'b', name: 'B', pos: { x: 10, z: 0 }, rotDeg: 0, length: 20, width: 10, levels: [] }];
    s.trees = [{ x: 30, z: 5, h: 8, r: 2, kind: 'd' }];
    const t = snapTargets(s);
    expect(nearestSnap(t, { x: 20.4, z: 5.3 }, 1)?.pt).toEqual({ x: 20, z: 5 });
    expect(nearestSnap(t, { x: 30.2, z: 5 }, 1)?.kind).toBe('tree');
    expect(nearestSnap(t, { x: 60, z: 60 }, 1)).toBeNull();
  });
  it('shows the angle where two measures share a point', () => {
    const o = { x: 0, z: 0 };
    const r = anglesAt([{ a: o, b: { x: 10, z: 0 } }, { a: { x: 0, z: 0 }, b: { x: 0, z: 5 } }, { a: { x: 50, z: 50 }, b: { x: 60, z: 50 } }]);
    expect(r.length).toBe(1);
    expect(r[0]!.deg).toBeCloseTo(90);
  });
  it('draws the angle arc between the two arms, label on the bisector', () => {
    const r = anglesAt([{ a: { x: 0, z: 0 }, b: { x: 10, z: 0 } }, { a: { x: 0, z: 0 }, b: { x: 0, z: 5 } }])[0]!;
    const arc = arcOf(r.at, r.d1, r.d2, 4);
    expect(arc.path).toMatch(/^M 4 0 A 4 4 0 0 1 /);
    expect(arc.label.x).toBeGreaterThan(0);
    expect(arc.label.z).toBeGreaterThan(0);
    expect(Math.hypot(arc.label.x, arc.label.z)).toBeLessThan(4);
  });
  it('straightens nearly axis-aligned lines', () => {
    const q = orthoSnap({ x: 0, z: 0 }, { x: 10, z: 0.3 });
    expect(q.z).toBeCloseTo(0);
    expect(q.x).toBeCloseTo(10, 1);
    const p = orthoSnap({ x: 0, z: 0 }, { x: 10, z: 3 });
    expect(p.z).toBeCloseTo(3);
    expect(fmtLength(5)).toBe('5.00 m');
  });
});
