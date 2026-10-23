import { describe, expect, it } from 'vitest';
import { latToTileY, lonToTileX, satelliteTiles, tileUrl, tileXToLon, tileYToLat } from './satellite';

describe('satellite tiles', () => {
  const origin = { lat: 45.6469, lon: 12.3002 };
  it('converts between degrees and tile numbers both ways', () => {
    expect(tileXToLon(lonToTileX(12.3002, 17), 17)).toBeCloseTo(12.3002, 9);
    expect(tileYToLat(latToTileY(45.6469, 17), 17)).toBeCloseTo(45.6469, 9);
  });
  it('covers the rectangle with at most `max` tiles at the sharpest zoom', () => {
    const r = { x0: -300, z0: -300, x1: 300, z1: 300 };
    const t = satelliteTiles(origin, r, 64);
    expect(t.length).toBeGreaterThan(0);
    expect(t.length).toBeLessThanOrEqual(64);
    const z = t[0]!.z;
    expect(satelliteTiles(origin, r, 400)[0]!.z).toBeGreaterThan(z); // more tiles allowed, sharper
    // together the tiles cover the whole rectangle, each one north-west to south-east
    expect(Math.min(...t.map((x) => x.x0))).toBeLessThanOrEqual(r.x0);
    expect(Math.max(...t.map((x) => x.x1))).toBeGreaterThanOrEqual(r.x1);
    expect(Math.min(...t.map((x) => x.z0))).toBeLessThanOrEqual(r.z0);
    expect(Math.max(...t.map((x) => x.z1))).toBeGreaterThanOrEqual(r.z1);
    for (const x of t) expect(x.x1 > x.x0 && x.z1 > x.z0).toBe(true);
    expect(tileUrl({ z: 17, x: 1, y: 2 })).toMatch(/tile\/17\/2\/1$/);
  });
});
