import { describe, expect, it } from 'vitest';
import { makeBackup, readBackup, restoreAction } from './backup';
import { decodeHeights } from './share';
import { emptySpec } from './site-spec';

const bando = (id: string, embedded = false) => {
  const s = { ...emptySpec(), id, name: id };
  if (embedded) s.terrain = { cell: 2, half: { e: 2, n: 2 }, strokes: [], base: { source: 'embedded', key: 'embedded:k', fetchedAt: 0, datum: 0 } };
  return s;
};

describe('backups', () => {
  it('carry every bando, the ground that cannot be downloaded again, and the own blocks', () => {
    const h = new Float32Array(9).fill(3.5);
    const b = makeBackup([{ savedAt: 5, spec: bando('a') }, { savedAt: 6, spec: bando('b', true) }], [], (k) => (k === 'embedded:k' ? h : null), 100);
    const back = readBackup(JSON.stringify(b))!;
    expect(back.bandos.map((x) => x.spec.id)).toEqual(['a', 'b']);
    expect(back.bandos[1]!.savedAt).toBe(6);
    expect(decodeHeights(back.bandos[1]!.spec.terrain!.base!.data!, 9)![4]).toBeCloseTo(3.5);
    expect(back.dropped).toBe(0);
  });
  it('drop what is broken, refuse what is not a backup', () => {
    const r = readBackup(JSON.stringify({ format: 'abando-backup', v: 1, bandos: [{ savedAt: 1, spec: 'x' }, { spec: bando('ok') }], blocks: [{}] }))!;
    expect(r.bandos.map((x) => x.spec.id)).toEqual(['ok']);
    expect(r.dropped).toBe(2);
    expect(readBackup('{"buildings":[]}')).toBeNull();
    expect(readBackup('not json')).toBeNull();
  });
  it('restoring keeps the newer copy', () => {
    expect(restoreAction(null, 3)).toBe('add');
    expect(restoreAction(2, 3)).toBe('replace');
    expect(restoreAction(3, 3)).toBe('keep');
  });
});
