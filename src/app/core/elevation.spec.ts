import { describe, expect, it } from 'vitest';
import { baseKey, lonLatToPixel, resampleToGrid, siteToLonLat, terrainBox, terrariumHeight, tileSampler, tilesFor } from './elevation';

describe('elevation tiles', () => {
  it('decodes terrarium pixels', () => {
    expect(terrariumHeight(128, 0, 0)).toBe(0);
    expect(terrariumHeight(128, 100, 128)).toBeCloseTo(100.5);
    expect(terrariumHeight(127, 255, 0)).toBe(-1);
  });

  it('finds the tiles of a box and the pixel of a place', () => {
    const p = lonLatToPixel(0, 0, 1);
    expect(p).toEqual({ x: 256, y: 256 });
    const t = tilesFor(45.66, 12.24, 45.67, 12.25, 15);
    expect(t.length).toBeGreaterThanOrEqual(1);
    expect(t.length).toBeLessThan(10);
    const box = terrainBox({ half: { e: 100, n: 100 } }, { lat: 45, lon: 12 });
    expect(box.north).toBeGreaterThan(45);
    expect(box.west).toBeLessThan(12);
  });

  it('round-trips site metres and samples decoded tiles', () => {
    const o = { lat: 45.6669, lon: 12.2431 };
    const q = siteToLonLat(o, 100, -50);
    expect(q.lat).toBeGreaterThan(o.lat);
    expect(q.lon).toBeGreaterThan(o.lon);
    // one fake tile everywhere at 20 m
    const p = lonLatToPixel(o.lat, o.lon, 15);
    const tiles = new Map<string, Uint8ClampedArray>();
    const px = new Uint8ClampedArray(256 * 256 * 4);
    for (let k = 0; k < px.length; k += 4) {
      px[k] = 128;
      px[k + 1] = 20;
    }
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) tiles.set(`${Math.floor(p.x / 256) + dx}/${Math.floor(p.y / 256) + dy}`, px);
    expect(tileSampler(tiles)(o.lat, o.lon)).toBeCloseTo(20);
    expect(tileSampler(new Map())(o.lat, o.lon)).toBeNaN();
  });

  it('resamples a slope onto the grid relative to the origin height', () => {
    const o = { lat: 45, lon: 12 };
    const t = { cell: 1, half: { e: 20, n: 20 } };
    // 1 m per 10 m eastwards, 300 m at the origin
    const slope = (lat: number, lon: number): number => 300 + ((lon - o.lon) * 111320 * Math.cos((o.lat * Math.PI) / 180)) / 10;
    const { heights, datum } = resampleToGrid(t, o, slope);
    expect(datum).toBeCloseTo(300);
    expect(heights[20 * 41 + 20]).toBeCloseTo(0, 3); // the origin
    expect(heights[20 * 41 + 40]).toBeCloseTo(2, 2); // 20 m east
    expect(baseKey(o, t)).toContain('20x20@1');
  });
});
