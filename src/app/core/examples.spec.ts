import { describe, expect, it } from 'vitest';
import { newerExample, sanitizeExamples } from './examples';
import { sanitizeSpec } from './site-spec';
import index from '../../../public/library/bandos.json';
import chiari from '../../../public/library/bandos/chiari-e-forti.json';
import hidden from '../../../public/library/bandos/villetta-no-place.json';
import playground from '../../../public/library/bandos/playground.json';
import catalog from '../../../public/library/catalog.json';

describe('example bandos', () => {
  it('keeps only well-formed rows, with files inside bandos/', () => {
    const rows = sanitizeExamples({
      bandos: [
        { file: 'bandos/a.json', name: 'A', origin: { lat: 1, lon: 2 }, buildings: 3 },
        { file: '../secret.json', name: 'B', origin: { lat: 1, lon: 2 } },
        { file: 'bandos/c.json', name: 'C', origin: { lat: 'x', lon: 2 } },
        null,
      ],
    });
    expect(rows.map((r) => r.name)).toEqual(['A']);
    expect(sanitizeExamples('nope')).toEqual([]);
  });

  it('every published example is listed and loads as a bando', () => {
    const rows = sanitizeExamples(index);
    expect(rows.map((r) => r.name)).toEqual(['Chiari e Forti', 'Playground', 'Villetta (place hidden)']);
    expect(rows.find((r) => r.name === 'Villetta (place hidden)')?.privacy).toBe('hidden');
    for (const raw of [hidden, chiari]) {
      const spec = sanitizeSpec(raw);
      expect(spec).not.toBeNull();
      expect(spec!.buildings.length).toBeGreaterThan(5);
      expect(spec!.terrain?.base?.key).toBeTruthy(); // its real ground: fetched again, or carried inside
    }
    // the factory's roofless mill with battlements, and its landmarks from the library
    const c = sanitizeSpec(chiari)!;
    expect(c.buildings.find((b) => b.name === 'Ruined mill')).toMatchObject({ roofless: true, crenels: true });
    expect(c.structures?.map((s) => s.block?.id).sort()).toEqual(['abando/sign-tower', 'abando/water-tower']);
    expect(sanitizeSpec(hidden)!.buildings.find((b) => b.block?.id === 'abando/vault-shed')?.levels[0]?.roof).toBe('vault');
  });

  it('the example without its place gives nothing away and carries its own ground', () => {
    const h = sanitizeSpec(hidden)!;
    expect(h.privacy).toBe('hidden');
    expect(h.origin).toEqual({ lat: 0, lon: 0 });
    expect(h.zone ?? h.areas ?? h.geoCorners ?? h.calibration).toBeUndefined();
    expect(h.terrain?.base?.source).toBe('embedded');
    expect((h.terrain?.base?.data ?? '').length).toBeGreaterThan(1000);
    expect(JSON.stringify(hidden)).not.toMatch(/Via |nameFromMap/);
    // nothing near the real place: no coordinates of any kind in the file
    expect(JSON.stringify(hidden)).not.toMatch(/"(lat|lon)": *[1-9]/);
  });
});

describe('the Playground', () => {
  const p = sanitizeSpec(playground)!;
  it('is a made-up place: hidden, at no coordinates, its ground shaped by brush strokes', () => {
    expect(p).not.toBeNull();
    expect(p.privacy).toBe('hidden');
    expect(p.origin).toEqual({ lat: 0, lon: 0 });
    expect(JSON.stringify(playground)).not.toMatch(/"(lat|lon)": *[1-9]/);
    expect(p.terrain?.base).toBeUndefined();
    expect(p.terrain!.strokes.map((s) => s.op)).toEqual(expect.arrayContaining(['hill', 'ramp', 'crater', 'raise']));
  });
  it('has water, a tunnel, a basement under a hole in the floor, ruins, trees and every block of the library', () => {
    expect(p.waters?.length).toBeGreaterThan(0);
    expect(p.underground?.length).toBeGreaterThan(0);
    const wh = p.buildings.find((b) => b.basement)!;
    expect(wh.levels[0]!.voids?.length).toBeGreaterThan(0);
    expect(p.buildings.some((b) => b.roofless && b.crenels)).toBe(true);
    expect(p.trees.length).toBeGreaterThan(40);
    const placed = new Set([...p.buildings, ...(p.structures ?? []), ...(p.walls ?? []), ...p.trees].map((e) => e.block?.id).filter(Boolean));
    const patterns = (catalog.blocks as { id: string; kind?: string }[]).filter((b) => b.kind === 'pattern').map((b) => b.id);
    for (const b of catalog.blocks as { id: string; kind?: string }[]) if (b.kind !== 'pattern') expect(placed.has(b.id), b.id).toBe(true);
    expect(patterns.length).toBeGreaterThan(0); // patterns write ordinary openings and columns: checked by the builder
  });
});

describe('example releases', () => {
  const ex = sanitizeExamples({ bandos: [{ file: 'bandos/a.json', name: 'A', origin: { lat: 0, lon: 0 }, release: 3 }, { file: 'bandos/b.json', name: 'B', origin: { lat: 0, lon: 0 } }] });
  it('reads the release (1 when absent)', () => {
    expect(ex.map((e) => e.release)).toEqual([3, 1]);
  });
  it('a copy hears of a newer release of its example, not of an equal one or a missing example', () => {
    expect(newerExample({ derivedFrom: { example: 'bandos/a.json', release: 2 } }, ex)?.name).toBe('A');
    expect(newerExample({ derivedFrom: { example: 'bandos/a.json', release: 3 } }, ex)).toBeNull();
    expect(newerExample({ derivedFrom: { example: 'bandos/gone.json', release: 1 } }, ex)).toBeNull();
    expect(newerExample({}, ex)).toBeNull();
  });
  it('a spec keeps where it came from, checked', () => {
    const base = { ...emptySpecLike(), derivedFrom: { example: 'bandos/a.json', release: 2.4 } };
    expect(sanitizeSpec(base)!.derivedFrom).toEqual({ example: 'bandos/a.json', release: 2 });
    expect(sanitizeSpec({ ...base, derivedFrom: { example: '../x', release: 1 } })!.derivedFrom).toBeUndefined();
  });
});
const emptySpecLike = () => JSON.parse(JSON.stringify(chiari)) as Record<string, unknown>;
