import { TestBed } from '@angular/core/testing';
import { CalibrationStore } from './calibration.store';
import { FlightStore } from './flight.store';
import { LayoutStore } from './layout.store';
import { MapStore, mergeMapState } from './map.store';
import { PlaybackStore } from './playback.store';
import { RadioStore } from './radio.store';
import { ViewStore } from './view.store';

const saved = (key: string): Record<string, any> => JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, any>;

describe('stores', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  describe('LayoutStore', () => {
    it('starts with the default panels visible', () => {
      const s = TestBed.inject(LayoutStore);
      expect(s.panels().views.visible).toBe(true);
      expect(s.panels().radio.visible).toBe(false);
    });

    it('raising a panel puts it in front of the others, even on the very first click', () => {
      const s = TestBed.inject(LayoutStore);
      s.raise('radio');
      s.raise('flights');
      expect(s.panels().flights.z).toBeGreaterThan(s.panels().radio.z);
      expect(s.panels().radio.z).toBeGreaterThan(s.panels().views.z);
      s.raise('radio');
      expect(s.panels().radio.z).toBeGreaterThan(s.panels().flights.z);
    });

    it('renumbers the stacking order instead of growing without bound', () => {
      const s = TestBed.inject(LayoutStore);
      for (let i = 0; i < 6000; i++) s.raise(i % 2 ? 'radio' : 'flights');
      expect(s.zTop()).toBeLessThan(5001);
      expect(s.panels().flights.z).not.toBe(s.panels().radio.z);
    });

    it('remembers position, size and flags, and resets to defaults', () => {
      const s = TestBed.inject(LayoutStore);
      s.moveTo('flights', 123, 45);
      s.toggleGhost('flights');
      s.toggleMinimized('flights');
      s.resizeTo('path', 400, 300);
      TestBed.tick();
      const p = saved('abando-ng-layout')['panels'];
      expect(p.flights.x).toBe(123);
      expect(p.flights.ghost).toBe(true);
      expect(p.flights.minimized).toBe(true);
      expect(p.path.w).toBe(400);
      s.reset();
      expect(s.panels().flights.x).toBeNull();
      expect(s.panels().flights.ghost).toBe(false);
    });

    it('restores the saved layout in a new session and fills in panels added later', () => {
      localStorage.setItem('abando-ng-layout', JSON.stringify({ panels: { flights: { x: 10, y: 20, visible: false } }, zTop: 40 }));
      const s = TestBed.inject(LayoutStore);
      expect(s.panels().flights.x).toBe(10);
      expect(s.panels().flights.visible).toBe(false);
      expect(s.panels().flights.minimized).toBe(false); // missing field gets its default
      expect(s.panels().timeline.visible).toBe(true); // panel absent from the save keeps its default
      expect(s.zTop()).toBe(40);
    });
  });

  describe('ViewStore', () => {
    it('toggles and persists', () => {
      const v = TestBed.inject(ViewStore);
      expect(v.xray()).toBe(true);
      v.toggleXray();
      v.setCameraView('fpv');
      v.setMainSource('video');
      TestBed.tick();
      expect(saved('abando-ng-view')['xray']).toBe(false);
      expect(saved('abando-ng-view')['cameraView']).toBe('fpv');
      expect(saved('abando-ng-view')['mainSource']).toBe('video');
    });
  });

  describe('CalibrationStore', () => {
    it('defaults to the solved site calibration', () => {
      const c = TestBed.inject(CalibrationStore);
      expect(c.calibration().rot).toBeCloseTo(-6.7608, 4);
      expect(c.modelScale()).toBe(1);
    });

    it('keeps the model scale in range and ignores nonsense', () => {
      const c = TestBed.inject(CalibrationStore);
      c.setModelScale(100);
      expect(c.modelScale()).toBe(3);
      c.setModelScale(0.001);
      expect(c.modelScale()).toBe(0.3);
      c.setModelScale(NaN);
      expect(c.modelScale()).toBe(1);
      c.setRot(NaN);
      expect(c.rot()).toBe(0);
    });

    it('shifts and applies calibrations', () => {
      const c = TestBed.inject(CalibrationStore);
      const dx = c.dx();
      c.shift(5, -3);
      expect(c.dx()).toBeCloseTo(dx + 5, 9);
      c.apply({ rot: 12, dx: 1, dz: 2 });
      expect(c.calibration()).toEqual({ rot: 12, dx: 1, dz: 2 });
      c.reset();
      expect(c.rot()).toBeCloseTo(-6.7608, 4);
    });
  });

  describe('RadioStore', () => {
    it('applies presets and edits single axes', () => {
      const r = TestBed.inject(RadioStore);
      r.applyPreset('gamepad');
      expect(r.spring()).toBe(true);
      expect(r.thr().a).toBe(1);
      r.setAxis('roll', { a: 5 });
      expect(r.roll().a).toBe(5);
      expect(r.roll().inv).toBe(false); // untouched field kept
      r.setAxis('pitch', { inv: false });
      expect(r.pitch().inv).toBe(false);
      TestBed.tick();
      expect(saved('abando-ng-radio')['roll'].a).toBe(5);
    });
  });

  describe('PlaybackStore and FlightStore', () => {
    it('tracks the transport', () => {
      const p = TestBed.inject(PlaybackStore);
      p.setPlaying(true);
      p.setDirection(-1);
      p.setSpeed(2);
      expect(p.playing()).toBe(true);
      expect(p.direction()).toBe(-1);
      expect(p.speed()).toBe(2);
    });

    it('indexes flights and only activates ones that exist', () => {
      const f = TestBed.inject(FlightStore);
      f.add({ id: 'a', name: 'A', live: false, stats: '' });
      f.add({ id: 'b', name: 'B', live: false, stats: '' });
      expect(f.count()).toBe(2);
      expect(f.activeId()).toBe('b');
      f.activate('a');
      expect(f.active()?.name).toBe('A');
      f.activate('nope');
      expect(f.activeId()).toBe('a');
      const rev = f.revision();
      f.touch();
      expect(f.revision()).toBe(rev + 1);
      f.clear();
      expect(f.count()).toBe(0);
      expect(f.active()).toBeNull();
    });
  });

  describe('MapStore', () => {
    it('defaults to the live OpenStreetMap background, not the fixed screenshot', () => {
      const m = TestBed.inject(MapStore);
      expect(m.background()).toBe('osm');
      expect(m.osmUrl()).toContain('openstreetmap.org/export/embed.html');
    });

    it('migrates a persisted "img" background (old builds) to the live map but keeps other saved values', () => {
      localStorage.setItem('abando-ng-map', JSON.stringify({ background: 'img', rotation: 12.5, dx: 3 }));
      const m = TestBed.inject(MapStore);
      expect(m.background()).toBe('osm');
      expect(m.rotation()).toBe(12.5);
      expect(m.dx()).toBe(3);
    });

    it('respects an explicit Google or 3D-only choice from storage', () => {
      expect(mergeMapState({ background: 'goog' }).background).toBe('goog');
      expect(mergeMapState({ background: 'none' }).background).toBe('none');
    });
  });
});
