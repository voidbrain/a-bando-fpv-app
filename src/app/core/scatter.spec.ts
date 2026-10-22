import { describe, expect, it } from 'vitest';
import { areaOf, mulberry, nearBuilding, scatterTrees } from './scatter';
import type { BuildingSpec } from './site-spec';

describe('tree scatter', () => {
  const square = areaOf('rect', [{ x: 0, z: 0 }, { x: 40, z: 40 }]);

  it('fills an area with spaced trees, repeatably for a seed', () => {
    const a = scatterTrees(square, [], { spacing: 5, rng: mulberry(1) });
    const b = scatterTrees(square, [], { spacing: 5, rng: mulberry(1) });
    expect(a.length).toBeGreaterThan(20);
    expect(a).toEqual(b);
    expect(a.every((t) => t.x >= 0 && t.x <= 40 && t.z >= 0 && t.z <= 40)).toBe(true);
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) expect(Math.hypot(a[i]!.x - a[j]!.x, a[i]!.z - a[j]!.z)).toBeGreaterThanOrEqual(3.4);
  });

  it('a circle stays inside its radius and a pen stays near its path', () => {
    const c = scatterTrees(areaOf('circle', [{ x: 0, z: 0 }, { x: 10, z: 0 }]), [], { spacing: 3, rng: mulberry(2) });
    expect(c.length).toBeGreaterThan(3);
    expect(c.every((t) => Math.hypot(t.x, t.z) <= 10.01)).toBe(true);
    const pen = scatterTrees(areaOf('pen', [{ x: 0, z: 0 }, { x: 30, z: 0 }], 6), [], { spacing: 3, rng: mulberry(3) });
    expect(pen.length).toBeGreaterThan(3);
    expect(pen.every((t) => Math.abs(t.z) <= 3.01)).toBe(true);
  });

  it('keeps clear of existing trees, of buildings and respects the cap', () => {
    const old = [{ x: 20, z: 20, h: 8, r: 2, kind: 'd' as const }];
    const t = scatterTrees(square, old, { spacing: 5, rng: mulberry(4) });
    expect(t.every((n) => Math.hypot(n.x - 20, n.z - 20) >= 3.5)).toBe(true);
    const b: BuildingSpec = { id: 'b', name: 'B', pos: { x: 20, z: 20 }, rotDeg: 0, length: 10, width: 10, levels: [] };
    const free = scatterTrees(square, [], { spacing: 4, rng: mulberry(5) }, (p) => nearBuilding([b], p));
    expect(free.every((n) => Math.abs(n.x - 20) > 5 || Math.abs(n.z - 20) > 5)).toBe(true);
    expect(scatterTrees(square, [], { spacing: 1.5, max: 10, rng: mulberry(6) }).length).toBe(10);
  });

  it('gives nothing for a degenerate stroke', () => {
    expect(areaOf('lasso', [{ x: 0, z: 0 }, { x: 1, z: 1 }])).toEqual([]);
    expect(scatterTrees([], [])).toEqual([]);
  });
});
