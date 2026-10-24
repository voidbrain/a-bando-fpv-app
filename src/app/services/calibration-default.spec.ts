import { describe, expect, it } from 'vitest';
import { toLocalAt } from '../core/geo';
import { emptySpec } from '../core/site-spec';
import { calibrationForSpec } from './site.service';

describe('the default flight alignment', () => {
  it('puts a flight on a generated (north-up) bando the way its map data is drawn: north is -z, east is +x', () => {
    const spec = emptySpec({ lat: 45.6, lon: 12.3 });
    const cal = calibrationForSpec(spec);
    const [nx, nz] = toLocalAt(spec.origin, 45.6 + 100 / 111132, 12.3, cal); // 100 m north
    expect(nx).toBeCloseTo(0, 3);
    expect(nz).toBeCloseTo(-100, 1);
    const [ex, ez] = toLocalAt(spec.origin, 45.6, 12.3 + 0.001, cal); // a little east
    expect(ex).toBeGreaterThan(70);
    expect(ez).toBeCloseTo(0, 3);
  });
});
