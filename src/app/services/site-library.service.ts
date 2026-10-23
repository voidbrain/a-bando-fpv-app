import { Injectable, computed, inject } from '@angular/core';
import type { SiteSpec } from '../core/site-spec';
import { cloneSpec, sanitizeSpec, uid } from '../core/site-spec';
import { LibraryStore } from './library-store.service';
import { StorageService } from './storage.service';

/** Where older versions kept bandos in localStorage (moved into the store once, then removed). */
const LEGACY_INDEX = 'abando-ng-sites';
const legacyKey = (id: string): string => `abando-ng-site-${id}`;

/** Index row: what the library list shows without parsing every spec. */
export interface SiteEntry {
  id: string;
  name: string;
  createdAt: number;
  origin: { lat: number; lon: number };
  /** A shared copy whose place is rounded or hidden. */
  privacy?: 'rounded' | 'hidden';
  buildings: number;
}

/** One stored bando: the spec and when it was last saved (the list shows the newest first). */
interface SiteRecord {
  savedAt: number;
  spec: SiteSpec;
}

/**
 * The site library: every generated / edited model is a plain {@link SiteSpec} — open data (OSM footprints + own edits),
 * so saving it is allowed with attribution. It lives in the {@link LibraryStore} (IndexedDB), one record per bando, so a
 * corrupt entry cannot break the whole library. Bandos saved by older versions in localStorage are moved over once.
 */
@Injectable({ providedIn: 'root' })
export class SiteLibraryService {
  private readonly store = inject(LibraryStore);
  private readonly storage = inject(StorageService);
  /** Reactive library index: re-evaluates whenever a site is saved, renamed, duplicated or removed. */
  readonly entries = computed<SiteEntry[]>(() => this.list());

  constructor() {
    if (typeof indexedDB === 'undefined') this.migrateLegacy();
  }

  list(): SiteEntry[] {
    this.store.revision(); // any computed reading the list follows the library
    return this.store
      .all<SiteRecord>('sites')
      .filter((r) => r && r.spec && typeof r.spec.id === 'string')
      .sort((a, b) => b.savedAt - a.savedAt)
      .map(({ spec }) => ({ id: spec.id, name: spec.name, createdAt: spec.createdAt, origin: spec.origin, buildings: spec.buildings?.length ?? 0, ...(spec.privacy ? { privacy: spec.privacy } : {}) }));
  }

  load(id: string): SiteSpec | null {
    const r = this.store.get<SiteRecord>('sites', id);
    return r ? sanitizeSpec(r.spec) : null;
  }

  save(spec: SiteSpec): void {
    this.store.put('sites', spec.id, { savedAt: Date.now(), spec: cloneSpec(spec) } satisfies SiteRecord);
  }

  remove(id: string): void {
    this.store.delete('sites', id);
  }

  /** Move bandos saved by older versions (one localStorage key each, plus an index) into the store, once. */
  migrateLegacy(): number {
    const raw = this.storage.readRaw(LEGACY_INDEX);
    if (!raw) return 0;
    let ids: string[] = [];
    try {
      const arr = JSON.parse(raw) as unknown;
      ids = Array.isArray(arr) ? (arr as { id?: unknown }[]).map((e) => e?.id).filter((x): x is string => typeof x === 'string') : [];
    } catch {
      /* corrupt index: nothing to move */
    }
    let n = 0;
    const now = Date.now(); // once: a clock tick between two bandos must not swap their order
    ids.forEach((id, i) => {
      const t = this.storage.readRaw(legacyKey(id));
      if (!t || this.store.get('sites', id)) return;
      try {
        const spec = sanitizeSpec(JSON.parse(t) as unknown);
        if (spec) {
          this.store.put('sites', id, { savedAt: now - i, spec } satisfies SiteRecord);
          n++;
        }
      } catch {
        /* skip a corrupt bando */
      }
    });
    for (const id of ids) this.storage.remove(legacyKey(id));
    this.storage.remove(LEGACY_INDEX);
    return n;
  }

  /** Store a copy of a site under a new id; returns it (null when the source is missing). */
  duplicate(id: string): SiteSpec | null {
    const src = this.load(id);
    if (!src) return null;
    const copy = cloneSpec(src);
    copy.id = uid();
    copy.name = `${src.name} (copy)`;
    copy.createdAt = Date.now();
    this.save(copy);
    return copy;
  }

  rename(id: string, name: string): void {
    const spec = this.load(id);
    if (!spec) return;
    spec.name = name;
    this.save(spec);
  }

  /** Read a bando file (JSON.parse + sanitize). Returns null when invalid. */
  importJson(text: string): SiteSpec | null {
    try {
      return sanitizeSpec(JSON.parse(text) as unknown);
    } catch {
      return null;
    }
  }
}
