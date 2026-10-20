import { Vec3, eulerYXZ } from '../math3d';
import { SiteCollider, type SolidBox } from './collider';
import { applyExpo, createDroneState, resetDroneState, stepDrone, toggleMode, type ControlSettings, type PilotInput } from './drone-physics';
import { SimRecorder } from './recorder';
import { DEFAULT_CALIBRATION } from '../constants';

const CFG: ControlSettings = { rate: 400, expo: 0.3 };
const neutral = (): PilotInput => ({ roll: 0, pitch: 0, yaw: 0, throttle: 0, gamepad: false, spring: false });
const run = (d: ReturnType<typeof createDroneState>, seconds: number, input: PilotInput, world: SiteCollider | null = null) => {
  let crashed = false;
  for (let i = 0; i < seconds * 120; i++) crashed = stepDrone(d, 1 / 120, input, CFG, world).crashed || crashed;
  return crashed;
};

describe('expo', () => {
  it('has a dead zone and keeps full stick at full stick', () => {
    expect(applyExpo(0.02, 0.3)).toBe(0);
    expect(applyExpo(1, 0.3)).toBeCloseTo(1, 9);
    expect(applyExpo(-1, 0.5)).toBeCloseTo(-1, 9);
    expect(applyExpo(0.5, 0.5)).toBeLessThan(0.5); // expo softens the centre
  });
});

describe('drone physics', () => {
  // the take-off pad these cases were written against (a blank site starts at 0,0)
  const PAD = { x: -44, z: 26 };

  it('starts disarmed on the apron facing the store and stays put', () => {
    const d = createDroneState(1, PAD);
    expect(d.armed).toBe(false);
    expect(d.p.x).toBe(-44);
    expect(d.p.y).toBeCloseTo(0.06, 6);
    run(d, 2, neutral());
    expect(d.p.y).toBeCloseTo(0.06, 3);
    expect(d.v.length()).toBeCloseTo(0, 3);
  });

  it('scales the start position with the model scale', () => {
    const d = createDroneState(1.5, PAD);
    expect(d.p.x).toBeCloseTo(-66, 6);
    expect(d.p.z).toBeCloseTo(39, 6);
  });

  it('hovers when armed with no stick input', () => {
    const d = createDroneState();
    d.armed = true;
    d.p.y = 20;
    run(d, 2, neutral());
    expect(d.p.y).toBeCloseTo(20, 1);
  });

  it('climbs with throttle and descends with negative throttle', () => {
    const d = createDroneState();
    d.armed = true;
    d.p.y = 20;
    run(d, 1, { ...neutral(), throttle: 1 });
    expect(d.p.y).toBeGreaterThan(24);
    const e = createDroneState();
    e.armed = true;
    e.p.y = 40;
    run(e, 1, { ...neutral(), throttle: -1 });
    expect(e.p.y).toBeLessThan(36);
  });

  it('pitching forward in angle mode accelerates along the heading (-Z for yaw 0)', () => {
    const d = createDroneState();
    d.armed = true;
    d.p.y = 30;
    d.yaw = 0;
    d.q.setFromEuler(0, 0, 0, 'YXZ');
    run(d, 1.5, { ...neutral(), pitch: 1 });
    expect(d.v.z).toBeLessThan(-2);
    expect(Math.abs(d.v.x)).toBeLessThan(0.5);
  });

  it('yaw stick turns the heading in angle mode', () => {
    const d = createDroneState();
    d.armed = true;
    d.p.y = 30;
    const y0 = d.yaw;
    run(d, 1, { ...neutral(), yaw: 1 });
    expect(Math.abs(d.yaw - y0)).toBeGreaterThan(1.5);
  });

  it('acro mode rotates freely and can go fully inverted', () => {
    const d = createDroneState();
    d.armed = true;
    d.p.y = 60;
    toggleMode(d);
    expect(d.mode).toBe('acro');
    run(d, 1, { ...neutral(), roll: 1 }); // 4.5 rad/s for 1 s ~ 258 deg
    const up = new Vec3(0, 1, 0).applyQuat(d.q);
    expect(up.y).toBeLessThan(0);
  });

  it('a disarmed fall from height ends in a crash and the drone rests on the ground', () => {
    const d = createDroneState();
    d.p.y = 30;
    const crashed = run(d, 6, neutral());
    expect(crashed).toBe(true);
    expect(d.p.y).toBeCloseTo(0.06, 3);
  });

  it('bounces off solids and flags hard impacts', () => {
    const wall: SolidBox = [-10, 10, 0, 50, 0, 1, false];
    const world = new SiteCollider([wall]);
    const d = createDroneState();
    d.armed = true;
    d.p.set(0, 10, -5);
    d.v.set(0, 0, 12);
    const crashed = run(d, 1, neutral(), world);
    expect(crashed).toBe(true);
    expect(d.p.z).toBeLessThan(0); // never got through
  });

  it('stays inside the world limits', () => {
    const d = createDroneState();
    d.armed = true;
    d.p.set(249, 10, 0);
    d.v.set(60, 0, 0);
    run(d, 1, neutral());
    expect(d.p.x).toBeLessThan(250.0001);
  });

  it('reset restores the start pose', () => {
    const d = createDroneState();
    d.armed = true;
    d.p.set(5, 5, 5);
    d.v.set(1, 1, 1);
    resetDroneState(d, 1, PAD);
    expect(d.armed).toBe(false);
    expect(d.p.x).toBe(-44);
    expect(eulerYXZ(d.q).y).toBeCloseTo(-Math.PI / 2, 6);
  });
});

describe('collider', () => {
  const box: SolidBox = [0, 10, 0, 5, 0, 10, false];
  const roof: SolidBox = [0, 10, 5, 6, 0, 10, true];

  it('hits inside a box and inside the safety margin, not outside', () => {
    const c = new SiteCollider([box]);
    expect(c.hit(new Vec3(5, 2, 5))).toBe(true);
    expect(c.hit(new Vec3(10.1, 2, 5))).toBe(true); // inside the 0.15 m margin
    expect(c.hit(new Vec3(10.5, 2, 5))).toBe(false);
  });

  it('ignores roofs while they are hidden', () => {
    const c = new SiteCollider([roof]);
    expect(c.hit(new Vec3(5, 5.5, 5))).toBe(true);
    c.roofHidden = true;
    expect(c.hit(new Vec3(5, 5.5, 5))).toBe(false);
  });

  it('follows the model scale', () => {
    const c = new SiteCollider([box]);
    c.scale = 2; // the model is twice as big: the box now spans x 0..20
    expect(c.hit(new Vec3(15, 4, 10))).toBe(true);
    expect(c.hit(new Vec3(25, 4, 10))).toBe(false);
  });

  it('trees block below their top only', () => {
    const c = new SiteCollider([], [[0, 0, 1, 8]]);
    expect(c.hit(new Vec3(0.5, 3, 0))).toBe(true);
    expect(c.hit(new Vec3(0.5, 9, 0))).toBe(false);
    expect(c.hit(new Vec3(3, 3, 0))).toBe(false);
  });
});

describe('simulator recorder', () => {
  it('samples at 10 Hz, starting immediately', () => {
    const r = new SimRecorder();
    const d = createDroneState();
    r.start();
    r.tick(1.0, d, 0.5, DEFAULT_CALIBRATION);
    expect(r.length).toBe(11);
    expect(r.data[10]?.t).toBeCloseTo(1, 6);
  });

  it('converts to flight points, CSV and JSON', () => {
    const r = new SimRecorder();
    const d = createDroneState();
    d.p.set(10, 12, -20);
    r.start();
    r.tick(0.35, d, 0.5, DEFAULT_CALIBRATION); // samples at 0, 0.1, 0.2, 0.3 s
    expect(r.toGeoSamples().length).toBe(4);
    expect(r.toGeoSamples()[0]?.alt).toBeCloseTo(8 + 12, 6);
    const csv = r.toCsv().split('\n');
    expect(csv[0]).toContain('GPS_coord[0]');
    expect(csv.length).toBe(5);
    expect(csv[1]?.split(',').length).toBe(11);
    expect((JSON.parse(r.toJson()) as unknown[]).length).toBe(4);
  });

  it('restarts cleanly', () => {
    const r = new SimRecorder();
    const d = createDroneState();
    r.start();
    r.tick(1, d, 0, DEFAULT_CALIBRATION);
    r.start();
    expect(r.length).toBe(0);
  });
});
