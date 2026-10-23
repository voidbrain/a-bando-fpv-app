import { describe, expect, it } from 'vitest';
import { cloneSpec, emptySpec } from './site-spec';
import { parseReply } from './ai-prompt';
import { runCommands } from './ai-commands';
import { backTarget, captionPlace, AI_SCRIPTS, SNIPPETS, TOURS, checkGuide, playTime, snippetForMark, tourBeats } from './tour';

describe('guided tour', () => {
  it('every tour uses known snippets, every snippet has captions and known hooks', () => {
    expect(checkGuide()).toEqual([]);
    expect(checkGuide([{ id: 'x', section: 'bandos', title: 'X', beats: [{ actions: [{ do: 'hook', hook: 'nope' as never }] }] }], [{ id: 't', title: 'T', about: '', snippets: ['x', 'y'] }])).toEqual([
      'x: needs at least one beat with a caption',
      'x: unknown hook nope',
      't: unknown snippet y',
    ]);
  });

  it('the full tour plays every snippet once, in a few minutes', () => {
    const full = TOURS.find((t) => t.id === 'full')!;
    expect(new Set(full.snippets).size).toBe(SNIPPETS.length);
    const ms = playTime(tourBeats(full).map((b) => b.beat));
    expect(ms).toBeGreaterThan(60_000);
    expect(ms).toBeLessThan(300_000);
  });

  it('hover tips find their snippet', () => {
    expect(snippetForMark('tool-building')?.id).toBe('add-building');
    expect(snippetForMark('nothing')).toBeNull();
  });

  it('the scripted AI answer really changes the building', () => {
    const spec = emptySpec({ lat: 45, lon: 12 });
    spec.buildings.push({ id: 'b1', name: 'Barrel-vault shed', pos: { x: 0, z: 0 }, rotDeg: 0, length: 60, width: 30, levels: [{ baseY: 0, height: 6, sides: { n: true, s: true, e: true, w: true }, doors: {}, partitions: [], roof: 'flat', roofRise: 1 }] });
    const parsed = parseReply(AI_SCRIPTS['door']!);
    expect(parsed.errors).toEqual([]);
    const s = cloneSpec(spec);
    const r = runCommands(s, parsed.commands, 'b1');
    expect(r.changed).toBe(true);
    const l = s.buildings[0]!.levels[0]!;
    expect(Object.values(l.doors).flat().filter((o) => o.kind === 'window').length).toBe(8);
    expect(Object.values(l.doors).flat().some((o) => o.kind === 'door')).toBe(true);
  });
});

describe('guide Back', () => {
  // two snippets: beats 0-2 and 3-4
  const first = [true, false, false, true, false];
  it('replays the current step from its start, or goes to the step before', () => {
    expect(backTarget(first, 2)).toBe(0);
    expect(backTarget(first, 4)).toBe(3);
    expect(backTarget(first, 3)).toBe(0);
    expect(backTarget(first, 0)).toBe(0);
  });
});

describe('guide caption place', () => {
  const view = { w: 1200, h: 800 }, bar = { w: 500, h: 110 };
  it('sits below the target, centred on it, inside the window', () => {
    expect(captionPlace({ x: 100, y: 100, w: 40, h: 30 }, view, bar)).toEqual({ left: 16, top: 144 });
    expect(captionPlace({ x: 600, y: 100, w: 100, h: 30 }, view, bar)).toEqual({ left: 400, top: 144 });
  });
  it('goes above a target near the bottom, and to the bottom without one', () => {
    expect(captionPlace({ x: 600, y: 700, w: 100, h: 40 }, view, bar).top).toBe(576);
    expect(captionPlace(null, view, bar)).toEqual({ left: 350, top: 642 });
  });
});
