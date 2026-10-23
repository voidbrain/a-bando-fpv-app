import { DEFAULT_CALIBRATION, setSiteOrigin } from './constants';
import { courseDegrees, rotateCalibrationAbout, solveCalibration, toGeo, toLocal, toLocalAt, turnTowards } from './geo';

describe('geo', () => {
  beforeAll(() => setSiteOrigin({ lat: 45.528698, lon: 12.133305 })); // these cases are written against this site
  afterAll(() => setSiteOrigin({ lat: 0, lon: 0 }));

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

  it('solves a calibration from two corner pairs that match in size', () => {
    // Model corners 40 m apart along +X; real corners due east and ~40 m apart -> rot 0, ratio ~1, tiny corner error.
    const p1 = { lat: 45.5287, lon: 12.1333 };
    const p2 = { lat: 45.5287, lon: 12.1333 + 40 / (111320 * Math.cos((45.5287 * Math.PI) / 180)) };
    const r = solveCalibration(p1, p2, { x: -20, z: 0 }, { x: 20, z: 0 });
    expect(r).toBeTruthy();
    if (!r) return;
    expect(r.distanceRatio).toBeCloseTo(1, 2);
    expect(Math.abs(r.calibration.rot)).toBeLessThan(2);
    expect(r.cornerError).toBeLessThan(2);
  });

  it('reports a size mismatch through the ratio (model / real) and splits the error between the corners', () => {
    const p1 = { lat: 45.5287, lon: 12.1333 };
    const p2 = { lat: 45.5287, lon: 12.134364 }; // ~83 m east of p1: twice the model's 40 m
    const r = solveCalibration(p1, p2, { x: -20, z: 0 }, { x: 20, z: 0 });
    expect(r!.distanceRatio).toBeCloseTo(40 / 82.9, 2);
    expect(r!.cornerError).toBeCloseTo((82.9 - 40) / 2, 0);
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

describe('turning a path about its start', () => {
  it('the start stays where it is and the end swings toward the pin', () => {
    const origin = { lat: 45, lon: 12 };
    const cal = { rot: 30, dx: 12, dz: -7 };
    const a = { lat: 45.0002, lon: 12.0003 }, b = { lat: 45.0011, lon: 12.0001 };
    const [ax, az] = toLocalAt(origin, a.lat, a.lon, cal), [bx, bz] = toLocalAt(origin, b.lat, b.lon, cal);
    const pin = { x: ax + 40, z: az + 40 };
    const turned = rotateCalibrationAbout(cal, { x: ax, z: az }, turnTowards({ x: ax, z: az }, { x: bx, z: bz }, pin));
    const [ax2, az2] = toLocalAt(origin, a.lat, a.lon, turned), [bx2, bz2] = toLocalAt(origin, b.lat, b.lon, turned);
    expect(ax2).toBeCloseTo(ax, 6);
    expect(az2).toBeCloseTo(az, 6);
    expect(Math.hypot(bx2 - ax2, bz2 - az2)).toBeCloseTo(Math.hypot(bx - ax, bz - az), 6); // a GPS path keeps its length
    expect(Math.atan2(bz2 - az2, bx2 - ax2)).toBeCloseTo(Math.atan2(pin.z - az, pin.x - ax), 6); // and points at the pin
  });
});
