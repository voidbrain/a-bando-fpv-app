import { CALIBRATION_CORNERS, DEFAULT_CALIBRATION } from './constants';
import { courseDegrees, solveCalibration, toGeo, toLocal } from './geo';
import { SITE_DIMS } from './site-dims';

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

  it('solves the default calibration from the two real corners', () => {
    const r = solveCalibration(
      CALIBRATION_CORNERS.greenhouseNW,
      CALIBRATION_CORNERS.storeSE,
      { x: SITE_DIMS.GX0, z: SITE_DIMS.AZ0 },
      { x: SITE_DIMS.BX1, z: SITE_DIMS.BZ1 },
    );
    expect(r).toBeTruthy();
    if (!r) return;
    expect(r.calibration.rot).toBeCloseTo(DEFAULT_CALIBRATION.rot, 1);
    expect(r.calibration.dx).toBeCloseTo(DEFAULT_CALIBRATION.dx, 0);
    expect(r.calibration.dz).toBeCloseTo(DEFAULT_CALIBRATION.dz, 0);
    expect(r.distanceRatio).toBeCloseTo(1.022, 2);
    expect(r.cornerError).toBeLessThan(3);
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
