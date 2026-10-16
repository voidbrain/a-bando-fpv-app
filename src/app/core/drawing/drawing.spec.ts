import { Quat, Vec3, attitudeQuat } from '../math3d';
import { DEFAULT_CALIBRATION } from '../constants';
import { pointTimes, flightSpeedMax } from '../flight/flight';
import { findFlips, findLiftoff } from '../flight/analysis';
import { fakeContext } from '../testing/fake-canvas';
import { makeFlight, makeTelemetry } from '../testing/fixtures';
import { createBlackboxState, drawBlackbox, inDroneDragArea } from './blackbox';
import { cameraUpAngle, drawCompass } from './compass';
import { drawDroneModel, DEFAULT_DRONE_VIEW, heatRGB } from './drone-model';
import { createPathView, dragPathView, drawFlightPath, niceStep, resetPathView, zoomPathView, type PathViewMode } from './flight-path';
import { drawGauge, replayScaleMax } from './gauge';
import { drawInstruments } from './instruments';
import { drawSyncPlot } from './sync-plot';
import { drawTimeline, tickStep, timeAtX } from './timeline';
import { matchVideoToLog } from '../sync/matcher';
import { ReplayPose } from '../flight/replay';

describe('speed gauge', () => {
  it('shows the rounded speed, the source and a scale that fits the flight', () => {
    const c = fakeContext();
    drawGauge(c.g, { speed: 10, scaleMax: 60, source: 'REPLAY' });
    expect(c.texts()).toContain('36');
    expect(c.texts()).toContain('km/h · REPLAY');
    expect(c.texts()).toContain('60'); // labelled at the top of the dial
    expect(replayScaleMax(10)).toBe(60);
    expect(replayScaleMax(25)).toBe(100);
    expect(replayScaleMax(0)).toBe(60);
  });

  it('pins the needle at full scale when over the dial', () => {
    const c = fakeContext();
    drawGauge(c.g, { speed: 100, scaleMax: 120, source: 'SIM' });
    expect(c.texts()).toContain('360');
  });
});

describe('instruments', () => {
  it('prints attitude and heading', () => {
    const c = fakeContext();
    drawInstruments(c.g, { pitch: -5, roll: 10, heading: 270 });
    expect(c.texts()).toContain('ROLL 10°  PITCH -5°');
    expect(c.texts()).toContain('HDG 270°');
    expect(c.texts()).toContain('N');
  });

  it('keeps drawing at extreme attitudes', () => {
    const c = fakeContext();
    drawInstruments(c.g, { pitch: 200, roll: -170, heading: 359.9 });
    expect(c.count('stroke')).toBeGreaterThan(20);
  });
});

describe('map-north compass', () => {
  it('draws N E S W', () => {
    const c = fakeContext();
    drawCompass(c.g, { calRot: -6.76, cameraUp: 0.3, droneHeading: 1 });
    for (const l of ['N', 'E', 'S', 'W']) expect(c.texts()).toContain(l);
  });

  it('derives the camera up angle for the top view and for perspective views', () => {
    expect(cameraUpAngle('top', { x: 0, z: -1 }, { x: 0, z: 0 })).toBeCloseTo(0, 9);
    expect(cameraUpAngle('top', { x: 1, z: 0 }, { x: 0, z: 0 })).toBeCloseTo(Math.PI / 2, 9);
    expect(cameraUpAngle('orbit', { x: 0, z: 0 }, { x: 0, z: -1 })).toBeCloseTo(0, 9);
    expect(cameraUpAngle('chase', { x: 0, z: 0 }, { x: 1, z: 0 })).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe('drone model', () => {
  const mot = [1000, 1000, 1000, 1000];
  it('knows whether it is upright or upside down', () => {
    const c = fakeContext();
    expect(drawDroneModel(c.g, 0, 0, 160, 120, new Quat(), mot, DEFAULT_DRONE_VIEW).up).toBeCloseTo(1, 6);
    expect(drawDroneModel(c.g, 0, 0, 160, 120, attitudeQuat(new Quat(), 0, 0, Math.PI), mot, DEFAULT_DRONE_VIEW).up).toBeCloseTo(-1, 6);
  });

  it('paints the battery (orange top) over the stack when seen from above', () => {
    const c = fakeContext();
    const info = drawDroneModel(c.g, 0, 0, 160, 120, new Quat(), mot, DEFAULT_DRONE_VIEW);
    expect(info.order.indexOf('stack-top')).toBeLessThan(info.order.indexOf('battery-top'));
    expect(info.order).toContain('arrow-top');
    expect(info.order.indexOf('arrow-bot')).toBe(-1); // the underside arrow faces away: culled
  });

  it('draws the underside arrow when the drone is flipped', () => {
    const c = fakeContext();
    const info = drawDroneModel(c.g, 0, 0, 160, 120, attitudeQuat(new Quat(), 0, 0, Math.PI), mot, DEFAULT_DRONE_VIEW);
    expect(info.order).toContain('arrow-bot');
    expect(info.order.indexOf('arrow-top')).toBe(-1);
  });

  it('colours motors green at idle and red at full power', () => {
    const idle = heatRGB(0);
    const full = heatRGB(1);
    expect(idle[1]).toBeGreaterThan(idle[0]);
    expect(full[0]).toBeGreaterThan(full[1]);
  });
});

describe('blackbox card', () => {
  const tel = makeTelemetry({ duration: 30, liftoff: 3, flips: [{ at: 10, axis: 'roll' }] });

  it('draws the sticks, four motors and the gyro graph', () => {
    const c = fakeContext();
    drawBlackbox(c.g, tel, 5, createBlackboxState());
    const t = c.texts();
    for (const l of ['yaw / throttle', 'roll / pitch', 'M1', 'M2', 'M3', 'M4']) expect(t).toContain(l);
    expect(t.some((s) => s.startsWith('gyro roll/pitch/yaw'))).toBe(true);
    expect(t.some((s) => s.startsWith('hdg'))).toBe(true);
    expect(t.includes('▼ INVERTED')).toBe(false);
  });

  it('warns when the drone is upside down', () => {
    const upside = makeTelemetry({ duration: 10, liftoff: 1 });
    for (let i = 0; i < upside.t.length; i++) upside.att[i * 3] = Math.PI;
    const c = fakeContext();
    drawBlackbox(c.g, upside, 5, createBlackboxState());
    expect(c.texts()).toContain('▼ INVERTED');
  });

  it('only the drone area is draggable', () => {
    expect(inDroneDragArea(80, 180)).toBe(true);
    expect(inDroneDragArea(250, 180)).toBe(false);
    expect(inDroneDragArea(80, 50)).toBe(false);
  });
});

describe('flight-path card', () => {
  const f = makeFlight(null, 30);

  for (const mode of ['top', 'side', 'front', '3d'] as PathViewMode[]) {
    it(`draws the ${mode} view with the speed caption and both end points`, () => {
      const c = fakeContext();
      const view = createPathView();
      view.mode = mode;
      const label = drawFlightPath(c.g, 300, 220, [f], view, DEFAULT_CALIBRATION, 10, new Vec3(f.loc[10]!.x, f.loc[10]!.y, f.loc[10]!.z));
      expect(label).toBe('0 – 36 km/h');
      expect(c.count('arc')).toBeGreaterThan(3); // start, end, replay ring x2
      expect(c.texts().length).toBeGreaterThan(2); // axis labels
    });
  }

  it('draws nothing without a flight', () => {
    const c = fakeContext();
    expect(drawFlightPath(c.g, 300, 220, [], createPathView(), DEFAULT_CALIBRATION, 10, null)).toBe('');
  });

  it('picks readable grid steps', () => {
    expect(niceStep(46, 10)).toBe(5);
    expect(niceStep(46, 0.01)).toBe(500);
    expect(niceStep(34, 100)).toBe(0.5);
  });

  it('rotates in 3D, pans with shift and in 2D, and zooms within limits', () => {
    const v = createPathView();
    v.mode = '3d';
    dragPathView(v, 100, 50, false);
    expect(v.yaw).toBeCloseTo(1.7, 9);
    expect(v.px).toBe(0);
    dragPathView(v, 10, 10, true);
    expect(v.px).toBe(10);
    v.mode = 'top';
    dragPathView(v, 5, 5, false);
    expect(v.py).toBe(15);
    zoomPathView(v, -1e9);
    expect(v.zoom).toBe(30);
    zoomPathView(v, 1e9);
    expect(v.zoom).toBeCloseTo(0.2, 9);
    resetPathView(v);
    expect(v.zoom).toBe(1);
    expect(v.px + v.py).toBe(0);
  });
});

describe('timeline', () => {
  const f = makeFlight(makeTelemetry({ duration: 30, liftoff: 3, flips: [{ at: 10, axis: 'roll' }] }), 30);

  it('draws the markers and returns the caption', () => {
    const c = fakeContext();
    const cap = drawTimeline(c.g, 520, 46, { flight: f, times: pointTimes(f), time: 5, liftoff: findLiftoff(f), firstFlip: findFlips(f)[0]?.t ?? null, speedMax: flightSpeedMax(f) });
    expect(c.texts()).toContain('T/O');
    expect(c.texts()).toContain('F');
    expect(cap.startsWith('0:05.0 / 0:30.0 · max ')).toBe(true);
  });

  it('spaces the tick labels and maps a click to a time', () => {
    expect(tickStep(520, 30)).toBe(5); // 17 px per second: 5 s ticks are the first >= 56 px apart
    expect(tickStep(520, 600)).toBe(120);
    expect(timeAtX(260, 520, 30)).toBeCloseTo(15, 9);
    expect(timeAtX(-20, 520, 30)).toBe(0);
    expect(timeAtX(999, 520, 30)).toBe(30);
  });
});

describe('sync plot', () => {
  it('plots both curves from the matcher features', () => {
    const tel = makeTelemetry({ duration: 60, liftoff: 3, flips: [{ at: 11, axis: 'roll' }], flicks: [5, 8, 14, 17, 22] });
    const flight = makeFlight(tel, 60);
    const samples = Array.from({ length: 1000 }, (_, i) => ({ t: i * 0.05, pan: Math.sin(i / 7) + 1, diff: 0.01, mag: 0.01, tb: 0.1 }));
    const r = matchVideoToLog(samples, flight);
    expect(r.features).toBeTruthy();
    const c = fakeContext();
    drawSyncPlot(c.g, 300, 60, r.features!, 2);
    expect(c.count('stroke')).toBe(2);
    expect(c.texts()[0]).toContain('blue = log');
  });
});

describe('replay pose', () => {
  it('interpolates the position between GPS points', () => {
    const f = makeFlight(null, 10);
    const pose = new ReplayPose();
    pose.update(f, 2.25, DEFAULT_CALIBRATION, 0.016);
    const a = f.loc[22]!, b = f.loc[23]!;
    expect(pose.p.x).toBeCloseTo((a.x + b.x) / 2, 6);
    expect(pose.p.y).toBeCloseTo((a.y + b.y) / 2, 6);
  });

  it('points the nose along the direction of travel without attitude data', () => {
    const f = makeFlight(null, 20);
    const pose = new ReplayPose();
    for (let i = 0; i < 200; i++) pose.update(f, 5 + i * 0.01, DEFAULT_CALIBRATION, 0.016);
    expect(pose.source).toBe('gps');
    const fwd = new Vec3(0, 0, -1).applyQuat(pose.q);
    const d = new Vec3().copy(f.loc[60]!).sub(f.loc[40]!);
    const cosine = (fwd.x * d.x + fwd.z * d.z) / (Math.hypot(fwd.x, fwd.z) * Math.hypot(d.x, d.z));
    expect(cosine).toBeGreaterThan(0.99);
  });

  it('uses telemetry attitude when the log has it, and live attitude for live links', () => {
    const f = makeFlight(makeTelemetry({ duration: 30, liftoff: 3 }), 30);
    const pose = new ReplayPose();
    pose.update(f, 5, DEFAULT_CALIBRATION, 0.016);
    expect(pose.source).toBe('telemetry');
    const live = makeFlight(null, 10);
    live.att = { roll: 0.2, pitch: 0.1, hdg: 1 };
    pose.update(live, 3, DEFAULT_CALIBRATION, 0.016);
    expect(pose.source).toBe('live');
  });

  it('is safe on a flight with fewer than two points and rewinds the cursor on seek-back', () => {
    const pose = new ReplayPose();
    const f = makeFlight(null, 10);
    pose.update(f, 8, DEFAULT_CALIBRATION, 0.016);
    expect(f.cursor).toBeGreaterThan(70);
    pose.update(f, 1, DEFAULT_CALIBRATION, 0.016);
    expect(f.cursor).toBeLessThan(15);
    const tiny = makeFlight(null, 0);
    tiny.pts.length = 1;
    pose.update(tiny, 0, DEFAULT_CALIBRATION, 0.016);
  });
});
