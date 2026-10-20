import { describe, expect, it } from 'vitest';
import { normalizeCommands, runCommands } from './ai-commands';
import { parseReply } from './ai-prompt';
import { listOpenings } from './openings';
import { emptySpec, type BuildingSpec, type SiteSpec } from './site-spec';

const site = (rot = 0): SiteSpec => {
  const s = emptySpec({ lat: 45, lon: 12 }, 'T');
  const b: BuildingSpec = {
    id: 'w', name: 'Warehouse', pos: { x: 0, z: 0 }, rotDeg: rot, length: 30, width: 12,
    levels: [{ baseY: 0, height: 4, sides: { n: true, s: true, e: true, w: true }, doors: {}, partitions: [], roof: 'gable', roofRise: 2 }],
  };
  s.buildings = [b];
  return s;
};

describe('ai commands', () => {
  it('puts a door on the south wall in the middle', () => {
    const s = site();
    const r = runCommands(s, normalizeCommands([{ op: 'add_door', side: 'south' }]).cmds, '');
    expect(r.errors).toEqual([]);
    const o = listOpenings(s.buildings[0]!, 0);
    expect(o.length).toBe(1);
    expect(o[0]!.at).toBeCloseTo(6, 3); // south = +z = width/2
    expect(o[0]!.c).toBeCloseTo(0, 1);
  });

  it('finds the compass wall of a rotated building', () => {
    const s = site(90); // turned a quarter: its local "east" wall now faces south
    runCommands(s, normalizeCommands([{ op: 'add_window', side: 'south', sill: 1, height: 1.2 }]).cmds, '');
    const o = listOpenings(s.buildings[0]!, 0)[0]!;
    expect(o.axis).toBe('z');
    expect(o.at).toBeCloseTo(15, 3);
    expect(o.sill).toBeCloseTo(1, 3);
  });

  it('splits into rooms with door gaps, then cuts an L-shaped corner', () => {
    const s = site();
    runCommands(s, normalizeCommands([{ op: 'split_rooms', count: 3, doors: true }]).cmds, 'w');
    expect(s.buildings[0]!.levels[0]!.partitions.length).toBe(4); // two walls, each in two halves
    const r = runCommands(s, normalizeCommands([{ op: 'cut_notch', side: 'northeast', size: 8, depth: 5 }]).cmds, 'w');
    expect(r.errors).toEqual([]);
    expect(s.buildings[0]!.footprint?.length).toBe(6);
  });

  it('adds a wing, a floor and renames; reports unknown buildings and ops', () => {
    const s = site();
    const r = runCommands(s, normalizeCommands([{ op: 'add_wing', side: 'north', size: 10, depth: 6 }, { op: 'add_floor' }, { op: 'rename', name: 'Hangar' }]).cmds, '');
    expect(r.errors).toEqual([]);
    expect(s.buildings[0]!.name).toBe('Hangar');
    expect(s.buildings[0]!.levels.length).toBe(2);
    expect(s.buildings[0]!.footprint).toBeTruthy();
    expect(normalizeCommands([{ op: 'delete_everything' }]).errors.length).toBe(1);
    const two = site();
    two.buildings.push({ ...two.buildings[0]!, id: 'x', name: 'Warehouse B' });
    expect(runCommands(two, normalizeCommands([{ op: 'add_floor', building: 'ware' }]).cmds, '').errors.length).toBe(1);
  });

  it('parses a reply wrapped in text and clamps absurd numbers', () => {
    const p = parseReply('Sure!\n```json\n{"reply":"ok","commands":[{"op":"add_door","side":"south","width":900}]}\n```');
    expect(p.reply).toBe('ok');
    expect(p.commands[0]!.width).toBe(20);
    expect(parseReply('nonsense').errors.length).toBe(1);
  });
});

describe('ai commands: structures, openings state, columns, conversion', () => {
  it('adds a container and a crane beside the selected building, on a given floor', () => {
    const s = site();
    const r = runCommands(s, normalizeCommands([{ op: 'add_structure', structure: 'container', east: 6, north: 4 }, { op: 'add_structure', structure: 'tower_crane' }]).cmds, 'w');
    expect(r.errors).toEqual([]);
    expect(s.structures!.length).toBe(2);
    expect(s.structures![0]).toMatchObject({ kind: 'container', x: 6, z: -4, length: 12.2 }); // north is -z
    expect(s.structures![1]!.x).toBeCloseTo(30 / 2 + 8, 3); // default: beside the building
    s.buildings[0]!.levels.push({ ...JSON.parse(JSON.stringify(s.buildings[0]!.levels[0]!)), baseY: 4 });
    runCommands(s, normalizeCommands([{ op: 'add_structure', structure: 'stairs', level: 2 }]).cmds, 'w');
    expect(s.structures![2]!.y).toBe(4);
    expect(runCommands(s, normalizeCommands([{ op: 'remove_structure', name: 'container' }]).cmds, 'w').errors).toEqual([]);
    expect(s.structures!.some((x) => x.kind === 'container')).toBe(false);
  });

  it('closes only the windows on a wall, then opens everything', () => {
    const s = site();
    runCommands(s, normalizeCommands([{ op: 'add_door', side: 'south' }, { op: 'add_window', side: 'north' }, { op: 'add_window', side: 'south', position: 0.2 }]).cmds, 'w');
    runCommands(s, normalizeCommands([{ op: 'set_openings', state: 'closed', what: 'window', side: 'north' }]).cmds, 'w');
    const o = listOpenings(s.buildings[0]!, 0);
    expect(o.filter((x) => x.closed).length).toBe(1);
    expect(o.find((x) => x.closed)!.kind).toBe('window');
    runCommands(s, normalizeCommands([{ op: 'set_openings', state: 'open' }]).cmds, 'w');
    expect(listOpenings(s.buildings[0]!, 0).some((x) => x.closed)).toBe(false);
  });

  it('puts columns in a row or a grid, and converts to a greenhouse', () => {
    const s = site();
    expect(runCommands(s, normalizeCommands([{ op: 'add_columns', pattern: 'row', count: 5, spacing: 5 }]).cmds, 'w').errors).toEqual([]);
    expect(s.buildings[0]!.levels[0]!.columns!.length).toBe(5);
    const g = site();
    runCommands(g, normalizeCommands([{ op: 'add_columns', pattern: 'grid', spacing: 5 }]).cmds, 'w');
    expect(g.buildings[0]!.levels[0]!.columns!.length).toBeGreaterThan(6);
    runCommands(g, normalizeCommands([{ op: 'convert', to: 'greenhouse' }]).cmds, 'w');
    expect(g.buildings[0]!.frame).toBe('greenhouse');
  });
});
