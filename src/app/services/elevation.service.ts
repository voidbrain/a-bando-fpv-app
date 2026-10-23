import { Service } from '@angular/core';
import { ELEVATION_ZOOM, TERRARIUM_URL, baseKey, resampleToGrid, terrainBox, tileSampler, tilesFor } from '../core/elevation';
import type { SiteSpec } from '../core/site-spec';
import { MAX_HALF, defaultTerrain, hasTerrainBase, setTerrainBase, type TerrainBase, type TerrainSpec } from '../core/terrain';

const DB = 'abando-terrain';
const STORE = 'bases';

/**
 * Real ground for a bando: downloads the elevation tiles over its area, resamples them onto the terrain grid and hands
 * the heights to the terrain registry. The heights are cached in IndexedDB under the base key, so a saved bando does not
 * download them again (and opens offline once they are cached). Only the key and the datum go into the spec.
 */
@Service()
export class ElevationService {
  /** The terrain size for a spec: its own, else its map zone plus 20 m (capped like every terrain). */
  dims(spec: SiteSpec): Pick<TerrainSpec, 'cell' | 'half'> {
    if (spec.terrain) return { cell: spec.terrain.cell, half: spec.terrain.half };
    const z = spec.zone;
    if (!z) return defaultTerrain(spec.extent);
    const r = (v: number): number => Math.round(Math.min(MAX_HALF, Math.max(60, v + 20)));
    return { cell: 1, half: { e: r(z.halfE), n: r(z.halfN) } };
  }

  /** Download the real ground for `spec` (its origin and terrain size): the new base, already registered and cached. */
  async fetchBase(spec: SiteSpec): Promise<{ base: TerrainBase; dims: Pick<TerrainSpec, 'cell' | 'half'> }> {
    const dims = this.dims(spec);
    const box = terrainBox(dims, spec.origin);
    const tiles = new Map<string, Uint8ClampedArray>();
    await Promise.all(
      tilesFor(box.south, box.west, box.north, box.east, ELEVATION_ZOOM).map(async (t) => {
        const url = TERRARIUM_URL.replace('{z}', String(ELEVATION_ZOOM)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Elevation tile ${t.x}/${t.y}: HTTP ${res.status}`);
        tiles.set(`${t.x}/${t.y}`, await decode(await res.blob()));
      }),
    );
    const { heights, datum } = resampleToGrid(dims, spec.origin, tileSampler(tiles));
    const key = baseKey(spec.origin, dims);
    setTerrainBase(key, heights);
    await put(key, heights);
    return { base: { source: 'aws-terrarium', key, fetchedAt: Date.now(), datum: Math.round(datum * 10) / 10 }, dims };
  }

  /**
   * Make sure the base a spec refers to is registered: from the cache, else downloaded again. Resolves true when it was
   * missing and is now there (the caller rebuilds the scene), false when nothing changed or it could not be had.
   */
  async ensure(spec: SiteSpec): Promise<boolean> {
    const b = spec.terrain?.base;
    if (!b || b.source === 'flat' || hasTerrainBase(b.key)) return false;
    const cached = await get(b.key);
    if (cached) {
      setTerrainBase(b.key, cached);
      return true;
    }
    if (b.source === 'embedded') return false; // it came in a file and the cache lost it: nothing to download from
    try {
      const again = await this.fetchBase(spec);
      return again.base.key === b.key;
    } catch {
      return false;
    }
  }
}

/** Register heights under a key and keep them in the cache (the ground that came inside a shared file). */
export async function cacheBase(key: string, h: Float32Array): Promise<void> {
  setTerrainBase(key, h);
  await put(key, h);
}

/** PNG bytes to RGBA pixels (via an ImageBitmap on an offscreen canvas). */
async function decode(blob: Blob): Promise<Uint8ClampedArray> {
  // no colour management: the pixel values ARE the heights (one step of red is 256 m)
  const img = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(img.width, img.height);
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('No 2D canvas');
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, img.width, img.height).data;
}

function open(): Promise<IDBDatabase> {
  return new Promise((ok, ko) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}

async function put(key: string, h: Float32Array): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((ok, ko) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(h, key);
      tx.oncomplete = () => ok();
      tx.onerror = () => ko(tx.error);
    });
    db.close();
  } catch {
    /* no IndexedDB (private window): the heights live until the page closes */
  }
}

async function get(key: string): Promise<Float32Array | null> {
  try {
    const db = await open();
    const v = await new Promise<unknown>((ok, ko) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
    db.close();
    return v instanceof Float32Array ? v : null;
  } catch {
    return null;
  }
}
