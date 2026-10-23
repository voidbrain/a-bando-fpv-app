import { describe, expect, it } from 'vitest';
import { sanitizeExamples } from './examples';
import { sanitizeSpec } from './site-spec';
import index from '../../../public/library/bandos.json';
import villetta from '../../../public/library/bandos/villetta.json';
import chiari from '../../../public/library/bandos/chiari-e-forti.json';

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
    expect(rows.map((r) => r.name)).toEqual(['Chiari e Forti', 'Bando Villetta']);
    for (const raw of [villetta, chiari]) {
      const spec = sanitizeSpec(raw);
      expect(spec).not.toBeNull();
      expect(spec!.buildings.length).toBeGreaterThan(5);
      expect(spec!.terrain?.base?.key).toBeTruthy(); // the real ground is fetched again on the pilot's machine
    }
    // the factory's ruin and its landmarks come from the library
    const c = sanitizeSpec(chiari)!;
    expect(c.buildings.some((b) => (b.ruin ?? 0) > 0.5)).toBe(true);
    expect(c.structures?.map((s) => s.block?.id).sort()).toEqual(['abando/lantern-tower', 'abando/water-tower']);
    expect(sanitizeSpec(villetta)!.buildings.find((b) => b.block?.id === 'abando/vault-shed')?.levels[0]?.roof).toBe('vault');
  });
});
