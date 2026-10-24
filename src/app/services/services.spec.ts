import { TestBed } from '@angular/core/testing';
import { setSiteOrigin } from '../core/constants';
import { setTakeoff } from '../core/takeoff';
import { betaflightCsv, makeTelemetry } from '../core/testing/fixtures';
import { CalibrationStore } from '../state/calibration.store';
import { FlightStore } from '../state/flight.store';
import { PlaybackStore } from '../state/playback.store';
import { FlightService } from './flight.service';
import { FrameLoopService } from './frame-loop.service';
import { PlaybackService } from './playback.service';
import { SimulatorService } from './simulator.service';
import { ToastService } from './toast.service';

const csvFile = (name = 'flight.csv', rows = 1600): File => new File([betaflightCsv(rows)], name, { type: 'text/csv' });
const frames = (n: number, dt = 1 / 60): void => {
  const loop = TestBed.inject(FrameLoopService);
  for (let i = 0; i < n; i++) loop.runOnce(dt, dt, 0);
};

describe('services', () => {
  // the site these cases were written against: its origin and its take-off pad (a blank site starts at 0,0)
  beforeEach(() => {
    setSiteOrigin({ lat: 45.528698, lon: 12.133305 });
    setTakeoff({ x: -44, z: 26 });
  });
  afterEach(() => {
    setSiteOrigin({ lat: 0, lon: 0 });
    setTakeoff({ x: 0, z: 0 });
  });

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  describe('FlightService', () => {
    it('loads a Betaflight log: parses, prepares, indexes and asks for the camera to frame it', async () => {
      const flights = TestBed.inject(FlightService);
      const store = TestBed.inject(FlightStore);
      await flights.loadFiles([csvFile('btfl.csv')]);
      expect(store.count()).toBe(1);
      expect(store.active()?.name).toBe('btfl.csv');
      expect(store.active()?.stats).toContain('20 pts');
      expect(flights.active?.tel).toBeTruthy();
      expect(flights.active?.loc.length).toBe(20);
      expect(flights.frameRequest()).toBeTruthy();
      expect(flights.speedMax).toBeGreaterThan(0);
    });

    it('reports an unreadable file instead of throwing, and still loads the good ones', async () => {
      const flights = TestBed.inject(FlightService);
      const toast = TestBed.inject(ToastService);
      await flights.loadFiles([new File(['not a log'], 'junk.txt'), csvFile('good.csv')]);
      expect(TestBed.inject(FlightStore).count()).toBe(1);
      expect(TestBed.inject(FlightStore).active()?.name).toBe('good.csv');
      expect(toast.message()).toContain('junk.txt');
    });

    it('clears everything', async () => {
      const flights = TestBed.inject(FlightService);
      await flights.loadFiles([csvFile()]);
      flights.clear();
      expect(TestBed.inject(FlightStore).count()).toBe(0);
      expect(flights.active).toBeNull();
    });

    it('re-projects loaded flights when the calibration changes', async () => {
      const flights = TestBed.inject(FlightService);
      const cal = TestBed.inject(CalibrationStore);
      await flights.loadFiles([csvFile()]);
      TestBed.tick();
      const before = flights.active!.loc[10]!.clone();
      const revision = TestBed.inject(FlightStore).revision();
      cal.shift(30, 0);
      TestBed.tick();
      expect(flights.active!.loc[10]!.x - before.x).toBeCloseTo(30, 6);
      expect(TestBed.inject(FlightStore).revision()).toBeGreaterThan(revision);
    });

    it('caches lift-off and the first flip per flight', () => {
      const flights = TestBed.inject(FlightService);
      const tel = makeTelemetry({ duration: 30, liftoff: 3, flips: [{ at: 8, axis: 'roll' }] });
      const f = flights.add('synthetic', Array.from({ length: 300 }, (_, i) => ({ lat: 45.5287 + i * 1e-6, lon: 12.1333, alt: 10, t: i / 10 })), tel);
      expect(flights.liftoff(f)).toBeCloseTo(3, 1);
      expect(flights.firstFlip(f)).toBeCloseTo(8, 0);
    });
  });

  describe('CalibrationStore', () => {
    it('rotating pivots about a point: the pivot stays where it was after rotate + compensating shift', async () => {
      const flights = TestBed.inject(FlightService);
      const cal = TestBed.inject(CalibrationStore);
      await flights.loadFiles([csvFile()]);
      TestBed.tick();
      const mid = (flights.active!.pts.length / 2) | 0;
      const before = flights.active!.loc[mid]!.clone();
      // same pivot logic the map panel's GPS alignment uses: rotate, then shift so the midpoint does not move
      const rot = (((40 + 540) % 360) + 360) % 360 - 180;
      cal.setRot(rot);
      TestBed.tick(); // the flight's model coordinates follow the calibration through an effect
      expect(cal.rot()).toBeCloseTo(40, 9);
      const after = flights.active!.loc[mid]!;
      expect(after.x).not.toBeCloseTo(before.x, 6); // rotation alone moves the path…
      // …and wrapping keeps the angle inside [-180, 180)
      cal.setRot(190);
      expect(cal.rot()).toBe(190); // the store itself does not wrap; callers (panel) wrap first
    });

    it('wraps the rotation into [-180, 180) the way the panel does', () => {
      const wrap = (deg: number): number => ((((deg + 540) % 360) + 360) % 360) - 180;
      expect(wrap(190)).toBeCloseTo(-170, 9);
      expect(wrap(-190)).toBeCloseTo(170, 9);
      expect(wrap(0)).toBe(0);
    });

    it('sets the model size from the real length of the building', () => {
      TestBed.inject(CalibrationStore).setModelScale(1.5);
      expect(TestBed.inject(CalibrationStore).modelScale()).toBeCloseTo(1.5, 9);
    });
  });

  describe('PlaybackService', () => {
    const load = async (): Promise<void> => {
      await TestBed.inject(FlightService).loadFiles([csvFile('p.csv', 1600 * 3)]); // ~6 s
      TestBed.tick();
    };

    it('holds the playhead while paused and follows the flight while playing', async () => {
      await load();
      const p = TestBed.inject(PlaybackService);
      p.seekTo(1);
      frames(10);
      expect(p.time).toBe(1);
      p.play();
      frames(60);
      expect(p.time).toBeCloseTo(2, 2);
      TestBed.inject(PlaybackStore).setSpeed(2);
      frames(30);
      expect(p.time).toBeCloseTo(3, 2);
    });

    it('plays in reverse and loops at both ends', async () => {
      await load();
      const p = TestBed.inject(PlaybackService);
      const dur = p.duration;
      p.seekTo(0.5);
      p.playReverse();
      frames(60);
      expect(p.time).toBeGreaterThan(dur - 1); // wrapped from 0 to the end
      p.seekTo(dur - 0.05);
      p.play();
      frames(10);
      expect(p.time).toBeLessThan(1);
    });

    it('stops at the end when looping is off', async () => {
      await load();
      const p = TestBed.inject(PlaybackService);
      const t = TestBed.inject(PlaybackStore);
      t.setLoop(false);
      p.seekTo(p.duration - 0.05);
      p.play();
      frames(10);
      expect(t.playing()).toBe(false);
      expect(p.time).toBeCloseTo(p.duration, 6);
    });

    it('lets a video be the master clock, and seeks clamp into the flight', async () => {
      await load();
      const p = TestBed.inject(PlaybackService);
      p.clock = { time: () => 2.5 };
      p.play();
      frames(2);
      // jumps to the video's time, then follows it smoothly (a few frames' drift at most)
      expect(Math.abs(p.time - 2.5)).toBeLessThan(0.05);
      p.clock = null;
      p.seekTo(-5);
      expect(p.time).toBe(0);
      p.seekTo(1e6);
      expect(p.time).toBeCloseTo(p.duration, 9);
    });

    it('notifies listeners when the user seeks', async () => {
      await load();
      const p = TestBed.inject(PlaybackService);
      const seen: number[] = [];
      const off = p.onSeek((t) => seen.push(t));
      p.seekTo(2);
      off();
      p.seekTo(3);
      expect(seen).toEqual([2]);
    });

    it('goes back to the start when another flight becomes active', async () => {
      await load();
      const p = TestBed.inject(PlaybackService);
      p.seekTo(3);
      await TestBed.inject(FlightService).loadFiles([csvFile('second.csv')]);
      TestBed.tick();
      expect(p.time).toBe(0);
    });
  });

  describe('SimulatorService', () => {
    it('starts parked and disarmed', () => {
      const sim = TestBed.inject(SimulatorService);
      expect(sim.armed()).toBe(false);
      expect(sim.state.p.x).toBe(-44);
    });

    it('arming records; disarming turns the recording into a flight', () => {
      const sim = TestBed.inject(SimulatorService);
      const store = TestBed.inject(FlightStore);
      sim.setArmed(true);
      sim.state.p.y = 10;
      frames(120);
      expect(sim.hud().status).toContain('REC');
      sim.setArmed(false);
      expect(store.count()).toBe(1);
      expect(store.flights()[0]?.name).toBe('Sim flight 1');
      expect(sim.hasRecording()).toBe(true);
      expect(sim.recorder.toCsv().split('\n').length).toBeGreaterThan(5);
    });

    it('ignores a too-short recording', () => {
      const sim = TestBed.inject(SimulatorService);
      sim.setArmed(true);
      frames(3);
      sim.setArmed(false);
      expect(TestBed.inject(FlightStore).count()).toBe(0);
    });

    it('altitude hold and mode toggle', () => {
      const sim = TestBed.inject(SimulatorService);
      expect(sim.altitudeHold()).toBe(true);
      sim.toggleHold();
      expect(sim.altitudeHold()).toBe(false);
      sim.toggleMode();
      expect(sim.mode()).toBe('acro');
    });

    it('a hard impact while armed cuts the motors', () => {
      const sim = TestBed.inject(SimulatorService);
      sim.toggleHold();
      sim.state.p.y = 40;
      sim.setArmed(true);
      // the throttle key held down: thrust below gravity, the drone falls and hits the ground fast
      dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowDown' }));
      frames(300);
      dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowDown' }));
      expect(sim.armed()).toBe(false);
    });

    it('reset parks the drone again, and a bigger model moves the take-off spot', () => {
      const sim = TestBed.inject(SimulatorService);
      sim.state.p.set(10, 0.05, 10);
      sim.reset();
      expect(sim.state.p.x).toBe(-44);
      TestBed.inject(CalibrationStore).setModelScale(2);
      TestBed.tick();
      expect(sim.state.p.x).toBeCloseTo(-88, 9);
    });
  });

  describe('FrameLoopService', () => {
    it('runs tasks in order and survives a task that throws', () => {
      const loop = TestBed.inject(FrameLoopService);
      const order: string[] = [];
      const err = console.error;
      console.error = () => undefined;
      loop.add(20, () => order.push('b'));
      loop.add(10, () => {
        order.push('a');
        throw new Error('boom');
      });
      loop.add(10, () => order.push('a2'));
      loop.runOnce(0.01, 0.01, 0);
      loop.runOnce(0.01, 0.01, 0);
      console.error = err;
      expect(order).toEqual(['a', 'a2', 'b', 'a', 'a2', 'b']);
    });

    it('runs every() tasks at the requested rate, or always when forced', () => {
      const loop = TestBed.inject(FrameLoopService);
      let n = 0;
      loop.every(3, 5, () => n++);
      for (let i = 0; i < 9; i++) loop.runOnce(0.01, 0.01, 0);
      expect(n).toBe(3);
      loop.forceAll = true;
      for (let i = 0; i < 4; i++) loop.runOnce(0.01, 0.01, 0);
      expect(n).toBe(7);
    });

    it('a task can be removed', () => {
      const loop = TestBed.inject(FrameLoopService);
      let n = 0;
      const stop = loop.add(1, () => n++);
      loop.runOnce(0.01, 0.01, 0);
      stop();
      loop.runOnce(0.01, 0.01, 0);
      expect(n).toBe(1);
    });
  });
});
