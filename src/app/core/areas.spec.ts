import { describe, expect, it } from 'vitest';
import { areaCorners, boundingZone, insideArea, keepInsideAreas, sameArea } from './areas';
import { emptySpec, type ZoneSpec } from './site-spec';

const M_LAT = 111132;
const at = (lat: number, lon: number, e: number, n: number, rotDeg = 0): ZoneSpec => ({ lat, lon, halfE: e, halfN: n, ...(rotDeg ? { rotDeg } : {}) });

describe('map areas', () => {
  const a = at(45, 12, 50, 40);
  const b = at(45 - 200 / M_LAT, 12, 50, 40); // 200 m south of a

  it('covers two areas with one north-up rectangle centred between them', () => {
    const z = boundingZone([a, b]);
    expect(z.halfE).toBeCloseTo(50, 0);
    expect(z.halfN).toBeCloseTo(140, 0); // 40 + 200 + 40 = 280 tall
    expect(z.lat).toBeCloseTo(45 - 100 / M_LAT, 6);
    const one = boundingZone([at(45, 12, 50, 40, 90)]);
    expect(one.halfE).toBeCloseTo(40, 0); // a quarter turn swaps the sides
  });

  it('knows what is inside a (turned) area', () => {
    expect(insideArea(a, a, 49, 39)).toBe(true);
    expect(insideArea(a, a, 55, 0)).toBe(false);
    expect(insideArea(a, a, 55, 0, 6)).toBe(true);
    const turned = at(45, 12, 50, 10, 90);
    expect(insideArea(turned, turned, 0, 45)).toBe(true);
    expect(insideArea(turned, turned, 45, 0)).toBe(false);
    expect(areaCorners(a, a)).toHaveLength(4);
  });

  it('keeps only what is in an area, never the take-off pad', () => {
    const z = boundingZone([a, b]);
    const spec = emptySpec({ lat: z.lat, lon: z.lon });
    spec.trees = [{ x: 0, z: -100, h: 8, r: 2, kind: 'd' }, { x: 0, z: 0, h: 8, r: 2, kind: 'd' }, { x: 0, z: 100, h: 8, r: 2, kind: 'd' }];
    spec.buildings = [{ id: 'gap', name: '', pos: { x: 0, z: 0 }, rotDeg: 0, length: 10, width: 10, levels: [] }];
    spec.pads = [{ x: 0, z: 0, w: 6, d: 6 }];
    keepInsideAreas(spec, [a, b]);
    expect(spec.trees.map((t) => t.z)).toEqual([-100, 100]);
    expect(spec.buildings).toHaveLength(0);
    expect(spec.pads).toHaveLength(1);
  });

  it('recognises the same area framed twice', () => {
    expect(sameArea(a, at(45 + 1 / M_LAT, 12, 51, 40))).toBe(true);
    expect(sameArea(a, b)).toBe(false);
  });
});
