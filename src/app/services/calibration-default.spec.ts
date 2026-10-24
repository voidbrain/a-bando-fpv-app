import { describe, expect, it } from 'vitest';
import { siteFromLatLon, toLocalAt } from '../core/geo';
import { emptySpec } from '../core/site-spec';
import { calibrationForSpec } from './site.service';

describe('the default flight alignment', () => {
  it('puts a flight on a generated (north-up) bando the way its map data is drawn: north is -z, east is +x', () => {
    const spec = emptySpec({ lat: 45.46, lon: 9.19 });
    const cal = calibrationForSpec(spec);
    const [nx, nz] = toLocalAt(spec.origin, 45.46 + 100 / 111132, 9.19, cal); // 100 m north
    expect(nx).toBeCloseTo(0, 3);
    expect(nz).toBeCloseTo(-100, 1);
    const [ex, ez] = toLocalAt(spec.origin, 45.46, 9.19 + 0.001, cal); // a little east
    expect(ex).toBeGreaterThan(70);
    expect(ez).toBeCloseTo(0, 3);
  });

  it('a GPS fix lands where the map puts the same point (Move to coordinates, map data): one frame for both', () => {
    const spec = emptySpec({ lat: 45.4642, lon: 9.19 });
    const cal = calibrationForSpec(spec);
    for (const p of [{ lat: 45.4651, lon: 9.1912 }, { lat: 45.4633, lon: 9.1884 }]) {
      const [x, z] = toLocalAt(spec.origin, p.lat, p.lon, cal);
      const m = siteFromLatLon(spec.origin, p);
      expect(Math.hypot(x - m.x, z - m.z)).toBeLessThan(0.02);
    }
  });
});
