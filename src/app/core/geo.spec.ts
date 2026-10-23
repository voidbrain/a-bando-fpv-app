import { DEFAULT_CALIBRATION, setSiteOrigin } from './constants';
import { courseDegrees, rotateCalibrationAbout, solveCalibration, toGeo, toLocal, toLocalAt, turnTowards, latLonText, parseLatLon, siteFromLatLon } from './geo';

describe('geo', () => {
  beforeAll(() => setSiteOrigin({ lat: 45.648698, lon: 12.303305 })); // these cases are written against this site (Chiari e Forti)
  afterAll(() => setSiteOrigin({ lat: 0, lon: 0 }));

  it('maps the site origin through the default calibration to (dx, dz)', () => {
    const [x, z] = toLocal(45.648698, 12.303305, DEFAULT_CALIBRATION);
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
    const [x, z] = toLocal(45.648698 + 0.0001, 12.303305, cal);
    expect(Math.abs(x)).toBeLessThan(1e-6);
    expect(z).toBeLessThan(-10);
  });

  it('solves a calibration from two corner pairs that match in size', () => {
    // Model corners 40 m apart along +X; real corners due east and ~40 m apart -> rot 0, ratio ~1, tiny corner error.
    const p1 = { lat: 45.6487, lon: 12.3033 };
    const p2 = { lat: 45.6487, lon: 12.3033 + 40 / (111320 * Math.cos((45.6487 * Math.PI) / 180)) };
    const r = solveCalibration(p1, p2, { x: -20, z: 0 }, { x: 20, z: 0 });
    expect(r).toBeTruthy();
    if (!r) return;
    expect(r.distanceRatio).toBeCloseTo(1, 2);
    expect(Math.abs(r.calibration.rot)).toBeLessThan(2);
    expect(r.cornerError).toBeLessThan(2);
  });

  it('reports a size mismatch through the ratio (model / real) and splits the error between the corners', () => {
    const p1 = { lat: 45.6487, lon: 12.3033 };
    const p2 = { lat: 45.6487, lon: 12.304364 }; // ~83 m east of p1: twice the model's 40 m
    const r = solveCalibration(p1, p2, { x: -20, z: 0 }, { x: 20, z: 0 });
    expect(r!.distanceRatio).toBeCloseTo(40 / 82.9, 2);
    expect(r!.cornerError).toBeCloseTo((82.9 - 40) / 2, 0);
  });


  it('refuses corners that are too close to give a rotation', () => {
    const p = { lat: 45.6487, lon: 12.3033 };
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

describe('coordinates typed by the pilot', () => {
  it('reads decimal and degrees-minutes-seconds, refuses the rest', () => {
    expect(parseLatLon('45.6469, 12.3002')).toEqual({ lat: 45.6469, lon: 12.3002 });
    expect(parseLatLon(' -33.8568 151.2153 ')).toEqual({ lat: -33.8568, lon: 151.2153 });
    const d = parseLatLon(`45°38'48.8"N 12°18'00.8"E`)!;
    expect(d.lat).toBeCloseTo(45.64689, 4);
    expect(d.lon).toBeCloseTo(12.30022, 4);
    expect(parseLatLon(`33°51'24"S 151°12'55"E`)!.lat).toBeLessThan(0);
    expect(parseLatLon('95, 12')).toBeNull();
    expect(parseLatLon('Via Roma 3')).toBeNull();
  });
});

describe('bando points and coordinates', () => {
  it('a point goes to degrees and back', () => {
    const o = { lat: 45.6469, lon: 12.3002 };
    const p = siteFromLatLon(o, parseLatLon(latLonText(o, { x: 120.5, z: -40.25 }))!);
    expect(p.x).toBeCloseTo(120.5, 1);
    expect(p.z).toBeCloseTo(-40.25, 1);
    expect(siteFromLatLon(o, o)).toEqual({ x: 0, z: 0 });
  });
});
