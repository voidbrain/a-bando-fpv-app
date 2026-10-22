import { describe, expect, it } from 'vitest';
import { digWater, levelRoad, padsToRoads, sanitizeLayers, simplifyPath, waterLevel } from './layers';
import { siteGround } from './site-ground';
import { emptySpec, sanitizeSpec } from './site-spec';
import { applyStroke, emptyGrid, heightAt } from './terrain';

const sq = (cx: number, cz: number, h: number) => [
  { x: cx - h, z: cz - h },
  { x: cx + h, z: cz - h },
  { x: cx + h, z: cz + h },
  { x: cx - h, z: cz + h },
];

describe('layers: stored specs', () => {
  it('turns old road pads into two-point roads and keeps the take-off pad', () => {
    const { roads, pads } = padsToRoads([{ x: 10, z: 0, w: 20, d: 6, rotDeg: 0 }, { x: 0, z: 0, w: 6, d: 6 }]);
    expect(roads).toEqual([{ pts: [{ x: 0, z: 0 }, { x: 20, z: 0 }], width: 6, kind: 'road' }]);
    expect(pads).toHaveLength(1);
    const old = sanitizeSpec({ ...emptySpec(), pads: [{ x: 10, z: 0, w: 20, d: 6, rotDeg: 90 }, { x: 0, z: 0, w: 6, d: 6 }] })!;
    expect(old.roads).toHaveLength(1);
    expect(old.pads).toHaveLength(1);
    expect(old.roads![0]!.pts[1]!.z).toBeCloseTo(10);
  });

  it('checks every value: unknown kinds fall back, short outlines drop, numbers are clamped', () => {
    const l = sanitizeLayers({
      roads: [{ pts: [{ x: 0, z: 0 }, { x: 5, z: 0 }], width: 999, kind: 'motorway' as never }, { pts: [{ x: 0, z: 0 }], width: 3, kind: 'path' }],
      surfaces: [{ pts: sq(0, 0, 5), kind: 'lava' as never }, { pts: [], kind: 'sand' }],
      waters: [{ pts: sq(0, 0, 5), depth: -4 }],
    });
    expect(l.roads).toEqual([{ pts: [{ x: 0, z: 0 }, { x: 5, z: 0 }], width: 40, kind: 'road' }]);
    expect(l.surfaces).toEqual([{ pts: sq(0, 0, 5), kind: 'grass' }]);
    expect(l.waters![0]!.depth).toBe(0.2);
  });
});

describe('layers on the ground', () => {
  it('levels a road across its width but keeps its slope along it', () => {
    const g = emptyGrid({ cell: 1, half: { e: 40, n: 40 } });
    for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) g.h[j * g.nx + i] = (j - 40) * 0.2 + i * 0.05; // tilted both ways
    levelRoad(g, { pts: [{ x: -30, z: 0 }, { x: 30, z: 0 }], width: 6, kind: 'road' });
    expect(heightAt(g, 0, 2.5)).toBeCloseTo(heightAt(g, 0, 0), 1); // flat across
    expect(heightAt(g, 20, 0) - heightAt(g, -20, 0)).toBeCloseTo(2, 1); // still climbs east
  });

  it('digs a basin below the lowest bank and reports the water level', () => {
    const g = emptyGrid({ cell: 1, half: { e: 40, n: 40 } });
    applyStroke(g, { op: 'raise', pts: [{ x: 20, z: 0 }], radius: 15, strength: 3 });
    const w = { pts: sq(0, 0, 8), depth: 2 };
    const before = waterLevel(g, w);
    const level = digWater(g, w);
    expect(level).toBeCloseTo(before);
    expect(heightAt(g, 0, 0)).toBeCloseTo(level - 2, 1);
    expect(heightAt(g, 0, 0)).toBeLessThan(level);
  });

  it('a site ground applies water, roads and pads, and is remembered', () => {
    const s = emptySpec();
    s.terrain = { cell: 1, half: { e: 60, n: 60 }, strokes: [{ op: 'raise', pts: [{ x: 0, z: 30 }], radius: 30, strength: 4 }] };
    s.waters = [{ pts: sq(30, -30, 6), depth: 1.5 }];
    s.roads = [{ pts: [{ x: -40, z: 30 }, { x: 40, z: 30 }], width: 6, kind: 'road' }];
    const a = siteGround(s);
    expect(a.water).toHaveLength(1);
    expect(a.at(30, -30)).toBeLessThan(a.water[0]!);
    expect(siteGround(s)).toBe(a);
  });

  it('simplifies a hand-drawn line', () => {
    const wobble = Array.from({ length: 50 }, (_, i) => ({ x: i, z: (i % 2) * 0.1 }));
    expect(simplifyPath(wobble)).toHaveLength(2);
    const corner = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 5 }, { x: 10, z: 10 }];
    expect(simplifyPath(corner)).toEqual([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }]);
  });
});
