import { describe, expect, it } from 'vitest';
import { normalizeCommands, runCommands } from './ai-commands';
import { listOpenings } from './openings';
import { applyStore, setColumnRows, setFacade } from './modules';
import { emptySpec, type BuildingSpec, type SiteSpec } from './site-spec';

const store = (): SiteSpec => {
  const s = emptySpec({ lat: 45, lon: 12 }, 'T');
  const b: BuildingSpec = {
    id: 's', name: 'Main store', pos: { x: 0, z: 0 }, rotDeg: 0, length: 60, width: 30,
    levels: [{ baseY: 0, height: 6, sides: { n: true, s: true, e: true, w: true }, doors: {}, partitions: [], roof: 'gable', roofRise: 3 }],
  };
  s.buildings = [b];
  return s;
};

describe('building modules', () => {
  it('store pattern repeats 2 lower panels + 1 full-height door along a wall', () => {
    const b = store().buildings[0]!;
    const wall = { key: 's', axis: 'x' as const, at: 15, from: -30, to: 30 };
    expect(setFacade(b, 0, wall, 'store', { bay: 5 })).toBe(12);
    const o = listOpenings(b, 0).sort((a, c) => a.c - c.c);
    expect(o.map((x) => x.kind).join()).toBe('window,window,door,window,window,door,window,window,door,window,window,door');
    expect(o[0]!.sill).toBeCloseTo(1.5);
    expect(o[2]!.h).toBeCloseTo(5); // full height minus the 1 m lintel
    expect(o[0]!.w).toBeCloseTo(4); // 5 m pitch minus a 1 m pier
  });

  it('is idempotent: applying a façade twice does not stack openings', () => {
    const b = store().buildings[0]!;
    const wall = { key: 'n', axis: 'x' as const, at: -15, from: -30, to: 30 };
    setFacade(b, 0, wall, 'panels');
    setFacade(b, 0, wall, 'panels');
    expect(listOpenings(b, 0).length).toBe(12);
  });

  it('industrial store: north panels, south doors, one middle column row', () => {
    const s = store();
    s.buildings[0]!.length = 30; // long axis north-south, like the original hall
    s.buildings[0]!.width = 60;
    const r = runCommands(s, normalizeCommands([{ op: 'industrial_store' }]).cmds, '');
    expect(r.errors).toEqual([]);
    const b = s.buildings[0]!;
    const o = listOpenings(b, 0);
    const north = o.filter((x) => x.at === -30), south = o.filter((x) => x.at === 30);
    expect(north.length).toBe(6);
    expect(north.every((x) => x.kind === 'window' && x.sill === 1.5)).toBe(true);
    expect(south.every((x) => x.kind === 'door')).toBe(true);
    // 4 rows (1 - 2 - 1) x 5 columns (every 10 m, none within 1 m of the end), nothing doubled
    const cols = b.levels[0]!.columns!;
    expect(cols.length).toBe(20);
    expect(new Set(cols.map((c) => `${c.x}/${c.z}`)).size).toBe(20);
    expect(new Set(cols.map((c) => c.x)).size).toBe(4); // an edge row each side + two in the middle
  });

  it('running the preset twice gives the same result', () => {
    const b = store().buildings[0]!;
    applyStore(b, 0);
    const first = JSON.stringify(b.levels[0]);
    applyStore(b, 0);
    expect(JSON.stringify(b.levels[0])).toBe(first);
    expect(setColumnRows(b, 0, { rows: 1 })).toBe(5);
  });

  it('refuses shaped buildings and walls that are too short', () => {
    const s = store();
    s.buildings[0]!.width = 1;
    const r = runCommands(s, normalizeCommands([{ op: 'set_facade', facade: 'doors', side: 'east', bay: 5 }]).cmds, '');
    expect(r.changed).toBe(false);
  });
});
