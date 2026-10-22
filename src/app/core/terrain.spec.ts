import { describe, expect, it } from 'vitest';
import { siteGround, siteOutline } from './site-ground';
import { emptySpec, sanitizeSpec, type BuildingSpec } from './site-spec';
import { applyStroke, buildHeights, contourPaths, defaultTerrain, emptyGrid, flattenPad, heightAt, rangeUnder, rayGround, sanitizeTerrain, setTerrainBase, type TerrainSpec } from './terrain';

const flat = (half = 50): TerrainSpec => ({ cell: 1, half: { e: half, n: half }, strokes: [] });
const bld = (x: number, z: number, l: number, w: number, rot = 0): BuildingSpec => ({ id: `b${x}`, name: 'b', pos: { x, z }, rotDeg: rot, length: l, width: w, levels: [] });

describe('terrain grid', () => {
  it('is flat by default and 0 outside', () => {
    const g = emptyGrid(flat(10));
    expect(g.nx).toBe(21);
    expect(heightAt(g, 3.3, -2)).toBe(0);
    expect(heightAt(g, 500, 0)).toBe(0);
    expect(heightAt(null, 1, 1)).toBe(0);
  });

  it('interpolates between grid points', () => {
    const g = emptyGrid(flat(10));
    g.h[10 * g.nx + 10] = 2; // (0, 0)
    expect(heightAt(g, 0, 0)).toBeCloseTo(2);
    expect(heightAt(g, 0.5, 0)).toBeCloseTo(1);
    expect(heightAt(g, 0.5, 0.5)).toBeCloseTo(0.5);
  });
});

describe('strokes', () => {
  it('raise lifts the centre by the strength and nothing beyond the radius; lower digs', () => {
    const g = emptyGrid(flat());
    applyStroke(g, { op: 'raise', pts: [{ x: 0, z: 0 }], radius: 5, strength: 3 });
    expect(heightAt(g, 0, 0)).toBeCloseTo(3);
    expect(heightAt(g, 2.5, 0)).toBeCloseTo(1.5);
    expect(heightAt(g, 6, 0)).toBe(0);
    applyStroke(g, { op: 'lower', pts: [{ x: 20, z: 0 }], radius: 4, strength: 2, falloff: 'flat' });
    expect(heightAt(g, 20, 0)).toBeCloseTo(-2);
    expect(heightAt(g, 22, 0)).toBeCloseTo(-2);
  });

  it('a swept stroke changes the ground by the same amount along its path (no stacking)', () => {
    const g = emptyGrid(flat());
    applyStroke(g, { op: 'raise', pts: [{ x: -10, z: 0 }, { x: -9, z: 0 }, { x: 0, z: 0 }, { x: 10, z: 0 }], radius: 3, strength: 2 });
    expect(heightAt(g, -5, 0)).toBeCloseTo(2);
    expect(heightAt(g, 5, 0)).toBeCloseTo(2);
  });

  it('flatten moves the ground to the target height; smooth pulls a spike down', () => {
    const g = emptyGrid(flat());
    applyStroke(g, { op: 'raise', pts: [{ x: 0, z: 0 }], radius: 10, strength: 6 });
    applyStroke(g, { op: 'flatten', pts: [{ x: 0, z: 0 }], radius: 3, strength: 1, height: 1, falloff: 'flat' });
    expect(heightAt(g, 0, 0)).toBeCloseTo(1);
    const s = emptyGrid(flat());
    s.h[50 * s.nx + 50] = 10;
    applyStroke(s, { op: 'smooth', pts: [{ x: 0, z: 0 }], radius: 4, strength: 1 });
    expect(heightAt(s, 0, 0)).toBeLessThan(2);
  });

  it('stamps: a hill rises, a crater sinks with a rim, a ramp climbs from foot to top', () => {
    const g = emptyGrid(flat());
    applyStroke(g, { op: 'hill', pts: [{ x: -20, z: -20 }], radius: 8, strength: 5 });
    expect(heightAt(g, -20, -20)).toBeCloseTo(5);
    applyStroke(g, { op: 'crater', pts: [{ x: 20, z: 20 }], radius: 6, strength: 3 });
    expect(heightAt(g, 20, 20)).toBeCloseTo(-3);
    expect(heightAt(g, 25.7, 20)).toBeGreaterThan(0);
    applyStroke(g, { op: 'ramp', pts: [{ x: 0, z: 10 }, { x: 0, z: 30 }], radius: 2, strength: 4 });
    expect(heightAt(g, 0, 20)).toBeCloseTo(2, 1);
    expect(heightAt(g, 0, 29)).toBeGreaterThan(3.5);
  });
});

describe('buildHeights', () => {
  it('feathers the edges back to 0 and levels pads to the lowest ground under them', () => {
    const t = flat();
    t.strokes.push({ op: 'raise', pts: [{ x: -60, z: 0 }, { x: 60, z: 0 }], radius: 200, strength: 4, falloff: 'flat' });
    const { grid } = buildHeights(t);
    expect(heightAt(grid, 0, 0)).toBeCloseTo(4);
    expect(heightAt(grid, 50, 0)).toBeCloseTo(0);
    const slope = emptyGrid(flat());
    for (let j = 0; j < slope.nz; j++) for (let i = 0; i < slope.nx; i++) slope.h[j * slope.nx + i] = i * 0.1;
    const y = flattenPad(slope, { poly: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 5 }, { x: 0, z: 5 }] });
    expect(y).toBeCloseTo(5);
    expect(rangeUnder(slope, [{ x: 1, z: 1 }, { x: 9, z: 1 }, { x: 9, z: 4 }, { x: 1, z: 4 }]).max).toBeCloseTo(5);
  });

  it('uses the registered base heights when present', () => {
    const t: TerrainSpec = { ...flat(30), base: { source: 'aws-terrarium', key: 'test-base', fetchedAt: 1, datum: 100 } };
    const g = emptyGrid(t);
    setTerrainBase('test-base', new Float32Array(g.h.length).fill(3));
    expect(heightAt(buildHeights(t).grid, 0, 0)).toBeCloseTo(3);
  });
});

describe('site ground', () => {
  it('a site without terrain is flat; with terrain every building stands on its own levelled pad', () => {
    const spec = emptySpec();
    spec.buildings = [bld(0, 0, 10, 6), bld(30, 0, 8, 8, 30)];
    expect(siteGround(spec).grid).toBeNull();
    expect(siteGround(spec).at(5, 5)).toBe(0);
    spec.terrain = flat(80);
    spec.terrain.strokes.push({ op: 'hill', pts: [{ x: 30, z: 0 }], radius: 25, strength: 6 });
    const g = siteGround(spec);
    const y = g.building.get('b30')!;
    expect(y).toBeGreaterThan(0.5);
    for (const p of siteOutline(spec.buildings[1]!)) expect(g.at(p.x * 0.9 + 3, p.z * 0.9)).toBeCloseTo(y, 1);
    expect(g.start).toBeCloseTo(g.at(spec.droneStart.x, spec.droneStart.z));
  });

  it('sanitizes saved terrain: clamps numbers, drops unknown ops, keeps old specs loading', () => {
    const t = sanitizeTerrain({ cell: 99, half: { e: 9999, n: 10 }, strokes: [{ op: 'nuke', pts: [{ x: 0, z: 0 }] }, { op: 'raise', pts: [{ x: 0, z: 0 }], radius: 1e6, strength: 3 }] })!;
    expect(t.cell).toBe(4);
    expect(t.half).toEqual({ e: 300, n: 20 });
    expect(t.strokes).toHaveLength(1);
    expect(t.strokes[0]!.radius).toBe(200);
    expect(sanitizeTerrain(null)).toBeUndefined();
    const old = sanitizeSpec({ ...emptySpec(), terrain: undefined });
    expect(old?.terrain).toBeUndefined();
    expect(defaultTerrain(1000).half.e).toBe(300);
  });

  it('finds where a ray meets the ground, over a hill and on flat ground', () => {
    const t = flat();
    t.strokes.push({ op: 'hill', pts: [{ x: 0, z: 0 }], radius: 15, strength: 10 });
    const { grid } = buildHeights(t);
    const p = rayGround(grid, { x: -40, y: 5, z: 0 }, { x: 1, y: 0, z: 0 })!;
    expect(heightAt(grid, p.x, p.z)).toBeCloseTo(5, 0);
    expect(p.x).toBeLessThan(0);
    const q = rayGround(null, { x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 })!;
    expect(q.x).toBeCloseTo(0);
    expect(rayGround(grid, { x: 0, y: 50, z: 0 }, { x: 0, y: 1, z: 0 })).toBeNull();
  });
});

describe('contours', () => {
  it('draws nothing on flat ground and rings around a hill, every 5th one major', () => {
    expect(contourPaths(emptyGrid(flat(20)))).toEqual({ minor: '', major: '' });
    const g = emptyGrid(flat(30));
    applyStroke(g, { op: 'hill', pts: [{ x: 0, z: 0 }], radius: 20, strength: 6 });
    const c = contourPaths(g);
    expect(c.minor.length).toBeGreaterThan(100);
    expect(c.major.length).toBeGreaterThan(10);
    expect(c.minor).toMatch(/^M-?\d/);
  });
});
