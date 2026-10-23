import { describe, expect, it } from 'vitest';
import { alignShift, decodeHeights, encodeHeights, shareCopy } from './share';
import { emptySpec, sanitizeSpec } from './site-spec';

const bando = () => {
  const s = emptySpec({ lat: 45.66694, lon: 12.24311 }, 'Old mill');
  s.zone = { lat: 45.66694, lon: 12.24311, halfE: 100, halfN: 80 };
  s.geoCorners = { p1: { lat: 45.666, lon: 12.242 }, p2: { lat: 45.667, lon: 12.244 } };
  s.calibration = { rot: 3, dx: 1, dz: 2 };
  s.terrain = { cell: 1, half: { e: 20, n: 20 }, base: { source: 'aws-terrarium', key: 'terrarium:x', fetchedAt: 1, datum: 18.2 }, strokes: [{ op: 'hill', pts: [{ x: 0, z: 0 }], radius: 5, strength: 2 }] };
  return s;
};

describe('sharing a bando', () => {
  it('packs heights to decimetres and back', () => {
    const h = new Float32Array([0, 1.23, -4.5, 300.07]);
    const back = decodeHeights(encodeHeights(h), 4)!;
    expect([...back].map((v) => Math.round(v * 10) / 10)).toEqual([0, 1.2, -4.5, 300.1]);
    expect(decodeHeights(encodeHeights(h), 5)).toBeNull();
    expect(decodeHeights('%%%', 1)).toBeNull();
  });

  it('a hidden copy loses everything that gives the place away and carries its ground', () => {
    const h = new Float32Array(41 * 41).fill(1.5);
    const c = shareCopy(bando(), 'hidden', h);
    expect(c.origin).toEqual({ lat: 0, lon: 0 });
    expect(c.zone).toBeUndefined();
    expect(c.geoCorners).toBeUndefined();
    expect(c.calibration).toBeUndefined();
    expect(c.privacy).toBe('hidden');
    expect(c.terrain!.base!.source).toBe('embedded');
    expect(c.terrain!.base!.datum).toBe(0);
    expect(decodeHeights(c.terrain!.base!.data!, 41 * 41)![0]).toBeCloseTo(1.5);
    expect(c.terrain!.strokes).toHaveLength(1);
    // and it survives the import check
    const back = sanitizeSpec(JSON.parse(JSON.stringify(c)))!;
    expect(back.privacy).toBe('hidden');
    expect(back.terrain!.base!.data).toBe(c.terrain!.base!.data);
  });

  it('a rounded copy keeps the place to ~1 km; an exact copy keeps everything; the original is untouched', () => {
    const s = bando();
    const r = shareCopy(s, 'rounded', null);
    expect(r.origin).toEqual({ lat: 45.67, lon: 12.24 });
    expect(r.terrain!.base).toBeUndefined(); // nothing registered to carry
    const e = shareCopy(s, 'exact', null);
    expect(e.origin.lat).toBe(45.66694);
    expect(e.calibration).toEqual({ rot: 3, dx: 1, dz: 2 });
    expect(s.zone).toBeDefined();
  });

  it('moves a flight so its first fix lands on the take-off pad', () => {
    expect(alignShift({ x: 120, z: -30 }, { x: -14, z: 0 })).toEqual({ dx: -134, dz: 30 });
  });
});
