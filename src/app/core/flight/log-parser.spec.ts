import { cleanHeights, parseLog } from './log-parser';
import { createFlight, curvePoint, flightStats, maxSpeed, prepareFlight } from './flight';
import { Vec3 } from '../math3d';
import { DEFAULT_CALIBRATION } from '../constants';
import { betaflightCsv } from '../testing/fixtures';

describe('log parser', () => {
  it('reads Betaflight CSV: raw 1e-7 degrees, decimetres, microseconds', () => {
    const { pts, tel } = parseLog(betaflightCsv(1600));
    expect(pts.length).toBe(20);
    expect(pts[0]?.lat).toBeCloseTo(45.4642, 6);
    expect(pts[0]?.lon).toBeCloseTo(9.1900, 6);
    expect(pts[0]?.alt).toBeCloseTo(13, 6);
    expect(pts[1]!.t - pts[0]!.t).toBeCloseTo(0.1, 6); // 80 rows x 1250 us
    expect(tel).toBeTruthy();
  });

  it('takes heights from the barometer when the log has it (GPS altitude wanders)', () => {
    const csv = 'time,GPS_coord[0],GPS_coord[1],GPS_altitude,baroAlt\n' + [0, 1, 2].map((i) => `${i * 100000},${454642000 + i * 10},${91900000},${1300 + i * 200},${-60 + i * 200}`).join('\n');
    const { pts } = parseLog(csv);
    expect(pts.map((p) => +p.alt.toFixed(6))).toEqual([-0.6, 1.4, 3.4]); // baroAlt is cm; GPS would have said 130, 150, 170 m
  });

  it('cleans the barometer: spikes go, real climbs stay', () => {
    const t = Array.from({ length: 30 }, (_, i) => i * 0.1);
    const h = t.map((x) => x * 2); // a steady 2 m/s climb
    h[10] = -25; // prop wash in a flip
    h[20] = 60;
    const c = cleanHeights(h, t);
    expect(Math.abs(c[10]! - 2)).toBeLessThan(0.5);
    expect(Math.abs(c[20]! - 4)).toBeLessThan(0.5);
    expect(c[29]!).toBeGreaterThan(5); // the climb is kept
  });

  it('decimates telemetry to every 8th row and keeps the units', () => {
    const { tel } = parseLog(betaflightCsv(1600));
    expect(tel?.t.length).toBe(200);
    expect(tel?.mot[0]).toBe(500);
    expect(tel?.mot[3]).toBe(530);
    expect(tel?.vbat[0]).toBeCloseTo(16, 6); // 1600 -> 16.00 V
    expect(tel?.gyro[2]).toBe(3);
    expect(tel?.t[0]).toBeCloseTo(0.01, 2);
  });

  it('aligns the IMU yaw to the GPS course while moving', () => {
    const { tel } = parseLog(betaflightCsv(1600));
    // course 45.0 deg, IMU yaw 1.0 rad -> offset = 45 deg in rad - 1.0
    expect(tel?.yawOff).toBeCloseTo((45 * Math.PI) / 180 - 1.0, 4);
  });

  it('works with semicolon and tab delimiters', () => {
    const base = betaflightCsv(400);
    expect(parseLog(base.replace(/,/g, ';')).pts.length).toBe(5);
    expect(parseLog(base.replace(/,/g, '\t')).pts.length).toBe(5);
  });

  it('reads plain CSV with latitude / longitude / time columns', () => {
    const text = 'time,lat,lon,alt\n0,45.4642,9.1900,10\n1,45.4643,9.1901,12\n2,45.4644,9.1902,14';
    const { pts, tel } = parseLog(text);
    expect(pts.length).toBe(3);
    expect(pts[2]?.t).toBe(2);
    expect(tel).toBeNull();
  });

  it('skips duplicate and empty fixes', () => {
    const text = 'time,lat,lon,alt\n0,45.4642,9.1900,10\n1,45.4642,9.1900,10\n2,0,0,0\n3,45.4644,9.1902,14';
    expect(parseLog(text).pts.length).toBe(2);
  });

  it('reads GPX tracks', () => {
    const gpx = `<gpx><trk><trkseg>
      <trkpt lat="45.4642" lon="9.1900"><ele>10</ele><time>2026-01-01T10:00:00Z</time></trkpt>
      <trkpt lat="45.4643" lon="9.1901"><ele>12</ele><time>2026-01-01T10:00:01Z</time></trkpt>
    </trkseg></trk></gpx>`;
    const { pts } = parseLog(gpx);
    expect(pts.length).toBe(2);
    expect(pts[1]!.t - pts[0]!.t).toBeCloseTo(1, 6);
    expect(pts[1]?.alt).toBe(12);
  });

  it('reads JSON arrays and { points: [] } objects', () => {
    const arr = JSON.stringify([{ lat: 45.46, lon: 9.19, alt: 5, t: 0 }, { latitude: 45.47, lng: 9.2, altitude: 6, time: 1 }]);
    expect(parseLog(arr).pts.length).toBe(2);
    expect(parseLog(JSON.stringify({ points: JSON.parse(arr) as unknown[] })).pts[1]?.lon).toBe(9.2);
  });

  it('rejects logs without usable GPS', () => {
    expect(() => parseLog('a,b,c\n1,2,3')).toThrow('no latitude/longitude');
    expect(() => parseLog('time,lat,lon\n0,45.5,12.1')).toThrow('fewer than 2');
  });
});

describe('flight preparation', () => {
  const log = parseLog('time,lat,lon,alt\n0,45.4642,9.1900,10\n1,45.4643,9.1901,12\n2,45.4644,9.1902,14\n3,45.4645,9.1903,14');

  it('puts the lowest fix just above ground and computes the duration', () => {
    const f = createFlight('t', log.pts);
    prepareFlight(f, DEFAULT_CALIBRATION);
    expect(f.loc[0]?.y).toBeCloseTo(0.3, 6);
    expect(f.loc[2]?.y).toBeCloseTo(4.3, 6);
    expect(f.dur).toBe(3);
    expect(f.spd.length).toBe(4);
  });

  it('reports distance, duration and top speed', () => {
    const f = createFlight('t', log.pts);
    prepareFlight(f, DEFAULT_CALIBRATION);
    const s = flightStats(f);
    expect(s.points).toBe(4);
    expect(s.distanceKm).toBeGreaterThan(0.01);
    expect(s.maxKmh).toBeGreaterThan(5);
    expect(maxSpeed([f])).toBeGreaterThan(1);
  });
});

describe('the smooth flight curve', () => {
  it('passes through every fix and bends through a corner instead of cutting it', () => {
    const pts = [new Vec3(0, 0, 0), new Vec3(10, 0, 0), new Vec3(10, 0, 10), new Vec3(10, 0, 20)];
    const q = new Vec3();
    expect(curvePoint(q, pts, 1, 0).x).toBeCloseTo(10, 9);
    expect(curvePoint(q, pts, 1, 1).z).toBeCloseTo(10, 9);
    curvePoint(q, pts, 1, 0.5); // the corner piece bulges outwards, not along the straight chord (x = 10)
    expect(q.x).toBeGreaterThan(10);
  });
});
