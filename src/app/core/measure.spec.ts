import { describe, expect, it } from 'vitest';
import { anglesAt, arcOf, chainClick, fmtLength, groundProfile, measureLabel, nearestSnap, orthoSnap, shiftEnds, snapTargets } from './measure';
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

describe('measures over the ground', () => {
  it('report the height difference and the length along a slope; flat ground adds nothing', () => {
    const flat = groundProfile({ a: { x: 0, z: 0 }, b: { x: 30, z: 40 } }, () => 0);
    expect(flat).toEqual({ dh: 0, along: 50, flat: 50 });
    const slope = groundProfile({ a: { x: 0, z: 0 }, b: { x: 40, z: 0 } }, (x) => x * 0.75);
    expect(slope.dh).toBeCloseTo(30);
    expect(slope.along).toBeCloseTo(50);
  });
});

describe('measure chains', () => {
  const o = { x: 0, z: 0 }, e = { x: 10, z: 0 }, n = { x: 10, z: -5 };
  it('every click continues the chain; the same point twice ends it', () => {
    let m = chainClick({ segs: [], a: null, start: null }, o).chain;
    m = chainClick(m, e).chain;
    m = chainClick(m, n).chain;
    expect(m.segs).toEqual([{ a: o, b: e }, { a: e, b: n }]);
    const end = chainClick(m, n);
    expect(end.ended).toBe(true);
    expect(end.chain.a).toBeNull();
    expect(end.chain.segs).toHaveLength(2);
  });
  it('closing on the start ends the loop', () => {
    let m = chainClick({ segs: [], a: null, start: null }, o).chain;
    m = chainClick(m, e).chain;
    m = chainClick(m, n).chain;
    const r = chainClick(m, o);
    expect(r.ended).toBe(true);
    expect(r.chain.segs).toHaveLength(3);
  });
  it('moving a shared point moves every end on it', () => {
    const segs = shiftEnds([{ a: o, b: e }, { a: e, b: n }], [e], 1, 2);
    expect(segs[0]!.b).toEqual({ x: 11, z: 2 });
    expect(segs[1]!.a).toEqual({ x: 11, z: 2 });
    expect(segs[1]!.b).toEqual(n);
  });
  it('labels the ground length only on a slope', () => {
    expect(measureLabel({ a: o, b: e }, null)).toBe('10.0 m');
    expect(measureLabel({ a: o, b: e }, () => 3)).toBe('10.0 m');
    expect(measureLabel({ a: o, b: e }, (x) => x)).toContain('↑10.0 m');
  });
});
