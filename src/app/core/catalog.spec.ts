import { describe, expect, it } from 'vitest';
import published from '../../../public/library/catalog.json';
import { applyPattern, placeBlock, type BlockSpec } from './blocks';
import { latestVersions, mergeCatalog, sanitizeCatalog, searchBlocks } from './catalog';
import { emptySpec, type BuildingSpec } from './site-spec';

const hall = (): BuildingSpec => ({ id: 'h', name: 'Hall', pos: { x: 0, z: 0 }, rotDeg: 0, length: 40, width: 20, levels: [{ baseY: 0, height: 6, sides: { n: true, s: true, e: true, w: true }, doors: {}, partitions: [], roof: 'flat', roofRise: 0 }] });

describe('the published catalogue (public/library/catalog.json, built from library/blocks)', () => {
  const { blocks, rejected } = sanitizeCatalog(published);

  it('every block passes the app\'s own check', () => {
    expect(rejected).toEqual([]);
    expect(blocks.length).toBe((published as { blocks: unknown[] }).blocks.length);
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('every block makes something with its defaults: placed things, or a pattern applied to a hall', () => {
    for (const b of blocks) {
      if (b.kind === 'pattern') {
        const h = hall();
        expect(applyPattern(h, 0, b).length, b.id).toBeGreaterThan(0);
      } else {
        const s = emptySpec();
        expect(placeBlock(s, b, {}, { x: 0, z: 0 }, 0).placed, b.id).toBeGreaterThan(0);
      }
    }
  });
});

describe('catalogue sync and search', () => {
  const mk = (id: string, version = 1, o: Partial<BlockSpec> = {}): BlockSpec => ({ schema: 1, id, version, name: id, kind: 'structure', tags: [], author: 't', licence: 'CC0', params: [], content: { shapes: [{ prim: 'box', at: { x: 0, y: 1, z: 0 }, size: { x: 1, y: 2, z: 1 }, color: '#123456' }] }, ...o });

  it('refuses local/ ids, duplicates and broken entries', () => {
    const r = sanitizeCatalog({ blocks: [mk('a/one'), mk('local/mine'), mk('a/one'), { id: 'a/broken' }] });
    expect(r.blocks.map((b) => b.id)).toEqual(['a/one']);
    expect(r.rejected).toEqual(['local/mine', 'a/one', 'a/broken']);
    expect(sanitizeCatalog('nonsense').blocks).toEqual([]);
  });

  it('the published version wins and the changes are reported', () => {
    const m = mergeCatalog([mk('a/x', 1), mk('a/y', 1)], [mk('a/x', 2), mk('a/z', 1)]);
    expect(m.updated).toEqual(['a/x']);
    expect(m.added).toEqual(['a/z']);
    expect(m.removed).toEqual(['a/y']);
    expect(latestVersions(m.blocks).get('a/x')).toBe(2);
  });

  it('searches names first, then tags and descriptions; every word must match', () => {
    const list = [mk('a/water-tower', 1, { name: 'Water tower', tags: ['steel'] }), mk('a/silo', 1, { name: 'Silo', tags: ['water'], description: 'grain' }), mk('a/pat', 1, { name: 'Rows', kind: 'pattern', content: { pattern: { columns: { rows: 2, step: 10, inset: 4 } } } })];
    expect(searchBlocks(list, 'water').map((b) => b.id)).toEqual(['a/water-tower', 'a/silo']);
    expect(searchBlocks(list, 'water steel').map((b) => b.id)).toEqual(['a/water-tower']);
    expect(searchBlocks(list, '', 'pattern').map((b) => b.id)).toEqual(['a/pat']);
    expect(searchBlocks(list, 'grain').map((b) => b.id)).toEqual(['a/silo']);
  });
});
