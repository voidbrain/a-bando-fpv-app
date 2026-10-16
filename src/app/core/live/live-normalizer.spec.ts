import { hasFix, normalizeLive, summarizeLive } from './live-normalizer';

describe('live normaliser', () => {
  it('accepts flat JSON with common names', () => {
    const m = normalizeLive({ lat: 45.5287, lon: 12.1333, alt: 14, speed: 10, heading: 90, sats: 12, vbat: 16.4, lq: 100, mode: 'ACRO' });
    expect(m?.lat).toBe(45.5287);
    expect(m?.speed).toBe(10);
    expect(m?.mode).toBe('ACRO');
  });

  it('accepts nested JSON and a { data: ... } envelope', () => {
    const m = normalizeLive({ data: { gps: { latitude: 45.5, longitude: 12.1, groundspeed_kmh: 36, sats: 9 }, attitude: { roll: 5, pitch: -3, yaw: 20 } } });
    expect(m?.lat).toBe(45.5);
    expect(m?.speed).toBeCloseTo(10, 9);
    expect(m?.roll).toBe(5);
    expect(m?.pitch).toBe(-3);
  });

  it('scales latitude / longitude sent as degrees * 1e7', () => {
    const m = normalizeLive({ lat: 455287000, lon: 121333000 });
    expect(m?.lat).toBeCloseTo(45.5287, 6);
    expect(m?.lon).toBeCloseTo(12.1333, 6);
  });

  it('converts radians to degrees when the field says so', () => {
    const m = normalizeLive({ roll_rad: Math.PI / 2, pitch_rad: 0, yaw_rad: Math.PI });
    expect(m?.roll).toBeCloseTo(90, 6);
    expect(m?.yaw).toBeCloseTo(180, 6);
  });

  it('ignores junk and blanks', () => {
    expect(normalizeLive(null)).toBeNull();
    expect(normalizeLive('hello')).toBeNull();
    const m = normalizeLive({ lat: '', lon: 'x', sats: '7' });
    expect(m?.lat).toBeNull();
    expect(m?.lon).toBeNull();
    expect(m?.sats).toBe(7);
  });

  it('knows when there is no GPS fix', () => {
    expect(hasFix(normalizeLive({ lat: 0, lon: 0 })!)).toBe(false);
    expect(hasFix(normalizeLive({ lat: 45.5, lon: 12.1 })!)).toBe(true);
    expect(hasFix(normalizeLive({ sats: 3 })!)).toBe(false);
  });

  it('summarises the values present', () => {
    expect(summarizeLive(normalizeLive({ sats: 12, speed: 10, alt: 14.4, vbat: 16.4, lq: 99, mode: 'ANGL' })!)).toBe('12 sats · 36 km/h · alt 14 m · 16.4 V · LQ 99 · ANGL');
  });
});
