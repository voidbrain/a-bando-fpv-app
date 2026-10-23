import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySpec } from '../core/site-spec';
import { LibraryStore } from './library-store.service';
import { SiteLibraryService } from './site-library.service';

describe('the local library', () => {
  beforeEach(() => localStorage.clear());

  it('moves bandos saved by older versions into the store once, newest first, and removes the old keys', () => {
    const a = emptySpec({ lat: 1, lon: 2 }, 'Older'), b = emptySpec({ lat: 3, lon: 4 }, 'Newer');
    a.id = 'a';
    b.id = 'b';
    localStorage.setItem('abando-ng-sites', JSON.stringify([{ id: 'b' }, { id: 'a' }, { id: 'gone' }]));
    localStorage.setItem('abando-ng-site-a', JSON.stringify(a));
    localStorage.setItem('abando-ng-site-b', JSON.stringify(b));
    const lib = TestBed.inject(SiteLibraryService); // no IndexedDB in tests: it migrates at once
    expect(lib.list().map((e) => e.name)).toEqual(['Newer', 'Older']);
    expect(localStorage.getItem('abando-ng-sites')).toBeNull();
    expect(localStorage.getItem('abando-ng-site-a')).toBeNull();
    expect(lib.migrateLegacy()).toBe(0);
  });

  it('saves, lists newest first, loads a checked copy and removes', () => {
    const lib = TestBed.inject(SiteLibraryService);
    const s = emptySpec({ lat: 1, lon: 1 }, 'One');
    s.id = 'one';
    lib.save(s);
    s.name = 'changed after saving';
    expect(lib.load('one')!.name).toBe('One');
    expect(lib.entries()).toHaveLength(1);
    lib.remove('one');
    expect(lib.load('one')).toBeNull();
    expect(lib.entries()).toHaveLength(0);
  });

  it('the store survives a reload (localStorage fallback) and skips corrupt entries', () => {
    TestBed.inject(LibraryStore).put('blocks', 'local/x', { id: 'local/x' });
    localStorage.setItem('abando-lib/blocks/bad', '{not json');
    TestBed.resetTestingModule();
    const again = TestBed.inject(LibraryStore);
    expect(again.get('blocks', 'local/x')).toEqual({ id: 'local/x' });
    expect(again.all('blocks')).toHaveLength(1);
  });
});

describe('the block library', () => {
  beforeEach(() => localStorage.clear());
  const block = (id: string, version = 1): object => ({ schema: 1, id, version, name: 'Box', kind: 'structure', tags: [], author: 'a', licence: 'CC0', params: [], content: { shapes: [{ prim: 'box', at: { x: 0, y: 1, z: 0 }, size: { x: 1, y: 2, z: 1 }, color: '#123456' }] } });

  it("keeps the pilot's blocks under local/, bumps the version on a save, forks catalogue blocks", async () => {
    const { BlockLibraryService } = await import('./block-library.service');
    const lib = TestBed.inject(BlockLibraryService);
    const a = lib.saveOwn(block('local/box'))!;
    expect(a.version).toBe(1);
    expect(lib.saveOwn(block('local/box'))!.version).toBe(2);
    expect(lib.saveOwn(block('abando/crate'))!.id).toBe('local/crate');
    expect(lib.saveOwn({ id: 'x' })).toBeNull();
    expect(lib.own().map((b) => b.id)).toEqual(['local/box', 'local/crate']);
    lib.removeOwn('local/box');
    expect(lib.get('local/box')).toBeNull();
  });

  it('imports one block, a list or a catalogue, and counts what it refused', async () => {
    const { BlockLibraryService } = await import('./block-library.service');
    const lib = TestBed.inject(BlockLibraryService);
    expect(lib.importJson(JSON.stringify(block('local/one'))).saved).toHaveLength(1);
    expect(lib.importJson(JSON.stringify({ schema: 1, blocks: [block('abando/two'), { bad: true }] }))).toMatchObject({ rejected: 1 });
    expect(lib.importJson('not json').rejected).toBe(1);
    expect(lib.exportJson('local/two')).toContain('"local/two"');
  });

  it('syncs the catalogue: stores it, then keeps it when the server says nothing changed or is offline', async () => {
    const { BlockLibraryService } = await import('./block-library.service');
    const lib = TestBed.inject(BlockLibraryService);
    const calls: (Record<string, string> | undefined)[] = [];
    let reply: () => Response = () => new Response(JSON.stringify({ schema: 1, blocks: [block('abando/one'), block('abando/two')] }), { status: 200, headers: { ETag: '"v1"' } });
    vi.stubGlobal('fetch', vi.fn(async (_u: string, o?: RequestInit) => {
      calls.push(o?.headers as Record<string, string> | undefined);
      return reply();
    }));
    await lib.sync();
    expect(lib.catalog().map((b) => b.id)).toEqual(['abando/one', 'abando/two']);
    expect(lib.lastSync()).toMatchObject({ added: 2 });
    reply = () => new Response(null, { status: 304 });
    await lib.sync();
    expect(calls[1]).toEqual({ 'If-None-Match': '"v1"' });
    expect(lib.catalog()).toHaveLength(2);
    reply = () => { throw new TypeError('offline'); };
    await lib.sync();
    expect(lib.status()).not.toBe('idle');
    expect(lib.catalog()).toHaveLength(2);
    vi.unstubAllGlobals();
  });
});

describe('sharing a bando without its place', () => {
  beforeEach(() => localStorage.clear());

  it('imports a hidden copy: the carried ground is registered and leaves the spec, the id is fresh, flights snap to the pad', async () => {
    const { SiteService } = await import('./site.service');
    const { FlightService } = await import('./flight.service');
    const { shareCopy } = await import('../core/share');
    const { getTerrainBase, setTerrainBase, emptyGrid } = await import('../core/terrain');
    const { autoAlignFlights, takeoffSpot } = await import('../core/takeoff');
    const site = TestBed.inject(SiteService);
    const spec = emptySpec({ lat: 45.6, lon: 12.2 }, 'Mill');
    spec.id = 'mill';
    spec.terrain = { cell: 1, half: { e: 20, n: 20 }, base: { source: 'aws-terrarium', key: 'k-mill', fetchedAt: 1, datum: 18 }, strokes: [] };
    setTerrainBase('k-mill', new Float32Array(emptyGrid(spec.terrain).h.length).fill(2));
    TestBed.inject(SiteLibraryService).save(spec);
    const file = JSON.stringify(shareCopy(spec, 'hidden', getTerrainBase('k-mill')));
    expect(site.importJson(file)).toBe(true);
    const got = site.active();
    expect(got.id).not.toBe('mill'); // the original stays
    expect(got.privacy).toBe('hidden');
    expect(got.terrain!.base!.data).toBeUndefined();
    expect(getTerrainBase(got.terrain!.base!.key)![0]).toBeCloseTo(2);
    expect(autoAlignFlights()).toBe(true);
    const f = TestBed.inject(FlightService).add('log', [
      { lat: 10, lon: 10, alt: 50, t: 0 },
      { lat: 10.0001, lon: 10, alt: 55, t: 1 },
    ]);
    expect(f.loc[0]!.x).toBeCloseTo(takeoffSpot().x, 3);
    expect(f.loc[0]!.z).toBeCloseTo(takeoffSpot().z, 3);
    expect(autoAlignFlights()).toBe(false);
  });
});
