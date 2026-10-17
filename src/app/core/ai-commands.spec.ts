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
