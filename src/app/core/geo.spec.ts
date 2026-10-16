import { DEFAULT_CALIBRATION } from './constants';
import { courseDegrees, solveCalibration, toGeo, toLocal } from './geo';

describe('geo', () => {
  it('maps the site origin through the default calibration to (dx, dz)', () => {
    const [x, z] = toLocal(45.528698, 12.133305, DEFAULT_CALIBRATION);
    expect(x).toBeCloseTo(DEFAULT_CALIBRATION.dx, 6);
    expect(z).toBeCloseTo(DEFAULT_CALIBRATION.dz, 6);
  });

  it('round-trips local <-> geographic', () => {
    for (const [x, z] of [[0, 0], [-98.5, -95.88], [27.5, 75.88], [120, -40]] as const) {
      const [lat, lon] = toGeo(x, z, DEFAULT_CALIBRATION);
      const [x2, z2] = toLocal(lat, lon, DEFAULT_CALIBRATION);
      expect(x2).toBeCloseTo(x, 6);
      expect(z2).toBeCloseTo(z, 6);
    }
  });

  it('north is -Z when the model is not rotated', () => {
    const cal = { rot: 0, dx: 0, dz: 0 };
    const [x, z] = toLocal(45.528698 + 0.0001, 12.133305, cal);
    expect(Math.abs(x)).toBeLessThan(1e-6);
    expect(z).toBeLessThan(-10);
  });

  it('solves a calibration from two synthetic corner pairs', () => {
    // Model corners 40 m apart along the model +X axis; real corners due east, 80 m apart -> rot 0, ratio 2.
    const p1 = { lat: 45.5287, lon: 12.1333 };
    const p2 = { lat: 45.5287, lon: 12.134364 }; // ~80 m east of p1 at this latitude
    const r = solveCalibration(p1, p2, { x: -20, z: 0 }, { x: 20, z: 0 });
    expect(r).toBeTruthy();
    if (!r) return;
    expect(r.distanceRatio).toBeCloseTo(2, 1);
    expect(Math.abs(r.calibration.rot)).toBeLessThan(2);
    expect(r.cornerError).toBeLessThan(2);
  });

  it('refuses corners that are too close to give a rotation', () => {
    const p = { lat: 45.5287, lon: 12.1333 };
    expect(solveCalibration(p, { lat: p.lat + 1e-5, lon: p.lon }, { x: 0, z: 0 }, { x: 1, z: 1 })).toBeNull();
  });

  it('computes the geographic course of a model-frame velocity', () => {
    const cal = { rot: 0, dx: 0, dz: 0 };
    expect(courseDegrees(0, -5, cal)).toBeCloseTo(0, 6); // -Z = north
    expect(courseDegrees(5, 0, cal)).toBeCloseTo(90, 6); // +X = east
    expect(courseDegrees(0, 5, cal)).toBeCloseTo(180, 6);
  });
});
