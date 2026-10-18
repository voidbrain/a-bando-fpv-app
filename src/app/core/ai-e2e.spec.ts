import { describe, expect, it } from 'vitest';
import { buildSiteFromSpec } from '../three/site-model';
import { normalizeCommands, runCommands } from './ai-commands';
import { parseReply } from './ai-prompt';
import { cloneSpec, emptySpec, type BuildingSpec } from './site-spec';

const spec = () => {
  const s = emptySpec({ lat: 45, lon: 12 }, 'T');
  const b: BuildingSpec = {
    id: 'b12', name: 'Building 12', pos: { x: 10, z: 5 }, rotDeg: 0, length: 30, width: 12,
    levels: [{ baseY: 0, height: 4, sides: { n: true, s: true, e: true, w: true }, doors: {}, partitions: [], roof: 'gable', roofRise: 2 }],
  };
  s.buildings = [b];
  return s;
};

describe('AI request → commands → 3D solids (everything except the language model)', () => {
  it('"3 rooms in Building 12, each wall with a door gap" really adds walls to the built scene', () => {
    // what a model answers for that request
    const answer = '{"reply":"Done, three rooms.","commands":[{"op":"split_rooms","building":"Building 12","count":3,"doors":true}]}';
    const parsed = parseReply(answer);
    expect(parsed.commands.length).toBe(1);

    const s = spec();
    const before = buildSiteFromSpec(cloneSpec(s)).collider.solids.length;
    const r = runCommands(s, parsed.commands, '');
    expect(r.errors).toEqual([]);
    expect(r.changed).toBe(true);
    expect(s.buildings[0]!.levels[0]!.partitions.length).toBe(4); // 2 walls × 2 halves (door gap between)
    const after = buildSiteFromSpec(cloneSpec(s)).collider.solids.length;
    expect(after - before).toBe(4);
  });

  it('on an upper floor the interior walls stand on that floor, not on the ground', () => {
    const s = spec();
    runCommands(s, normalizeCommands([{ op: 'add_floor' }, { op: 'split_rooms', count: 2, level: 2, doors: false }]).cmds, '');
    const solids = buildSiteFromSpec(cloneSpec(s)).collider.solids;
    const walls = solids.filter((b) => Math.abs(b[1] - b[0] - 0.3) < 0.01 && b[2] >= 3.9); // 0.3 m thick, starting at the 2nd floor
    expect(walls.length).toBe(1);
  });

  it('every floor gets its own outer walls, standing on that floor', () => {
    const s = spec();
    runCommands(s, normalizeCommands([{ op: 'add_floor' }, { op: 'add_floor' }]).cmds, '');
    const solids = buildSiteFromSpec(cloneSpec(s)).collider.solids;
    for (const base of [0, 4, 8]) {
      const here = solids.filter((b) => !b[6] && Math.abs(b[2] - base) < 0.01 && Math.abs(b[3] - (base + 4)) < 0.01);
      expect(here.length, `walls of the floor at ${base} m`).toBeGreaterThanOrEqual(4);
    }
  });

  it('a reply that claims success with no commands changes nothing', () => {
    const p = parseReply('{"reply":"Done! I added three rooms.","commands":[]}');
    const s = spec();
    expect(runCommands(s, p.commands, '').changed).toBe(false);
  });
});
