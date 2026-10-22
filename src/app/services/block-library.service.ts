import { Service, computed, inject, signal } from '@angular/core';
import { forkBlock, sanitizeBlock, type BlockSpec } from '../core/blocks';
import { latestVersions, mergeCatalog, sanitizeCatalog } from '../core/catalog';
import { LibraryStore } from './library-store.service';

/** Where the published catalogue is, relative to the app (served from `public/library/`). */
const CATALOG_PATH = 'library/catalog.json';

/**
 * The blocks the pilot can place: their own (`local/...`, made here, forked or imported; never touched by a sync) and the
 * online catalogue, cached in the {@link LibraryStore} so it works offline. {@link sync} asks for the catalogue with its
 * ETag and only stores it again when it changed.
 */
@Service()
export class BlockLibraryService {
  private readonly store = inject(LibraryStore);
  readonly status = signal<'idle' | 'syncing' | 'offline' | 'error'>('idle');
  /** What the last sync changed, for a one-line note in the panel. */
  readonly lastSync = signal<{ at: number; added: number; updated: number; removed: number } | null>(null);

  readonly own = computed(() => {
    this.store.revision();
    return this.store.all<BlockSpec>('blocks').sort((a, b) => a.name.localeCompare(b.name));
  });
  readonly catalog = computed(() => {
    this.store.revision();
    return this.store.all<BlockSpec>('catalog').sort((a, b) => a.name.localeCompare(b.name));
  });
  /** Everything placeable: own blocks first. */
  readonly all = computed(() => [...this.own(), ...this.catalog()]);
  /** Newest version of each catalogue block (placed copies of older versions can be updated). */
  readonly latest = computed(() => latestVersions(this.catalog()));

  get(id: string): BlockSpec | null {
    return this.store.get<BlockSpec>('blocks', id) ?? this.store.get<BlockSpec>('catalog', id);
  }

  /** Download the catalogue when it changed (ETag); keeps the cached one when offline. */
  async sync(): Promise<void> {
    if (this.status() === 'syncing') return;
    this.status.set('syncing');
    try {
      const etag = this.store.get<string>('meta', 'catalog-etag');
      const url = new URL(CATALOG_PATH, document.baseURI).toString();
      const res = await fetch(url, { headers: etag && this.catalog().length ? { 'If-None-Match': etag } : {}, cache: 'no-cache' });
      if (res.status === 304) {
        this.status.set('idle');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { blocks } = sanitizeCatalog(await res.json());
      const m = mergeCatalog(this.catalog(), blocks);
      for (const id of m.removed) this.store.delete('catalog', id);
      for (const b of m.blocks) if (m.added.includes(b.id) || m.updated.includes(b.id) || !this.store.get('catalog', b.id)) this.store.put('catalog', b.id, b);
      const tag = res.headers.get('ETag');
      if (tag) this.store.put('meta', 'catalog-etag', tag);
      this.lastSync.set({ at: Date.now(), added: m.added.length, updated: m.updated.length, removed: m.removed.length });
      this.status.set('idle');
    } catch {
      this.status.set(navigator.onLine === false ? 'offline' : 'error');
    }
  }

  /**
   * Keep one of the pilot's own blocks: always under `local/` (a catalogue id becomes a fork), a newer version when it
   * replaces an existing one. Returns the stored block, or null when it does not pass the check.
   */
  saveOwn(raw: unknown): BlockSpec | null {
    const b = sanitizeBlock(raw);
    if (!b) return null;
    const own = b.id.startsWith('local/') ? b : forkBlock(b, b.author);
    const prev = this.store.get<BlockSpec>('blocks', own.id);
    const out: BlockSpec = { ...own, version: prev ? Math.max(prev.version + 1, own.version) : own.version };
    this.store.put('blocks', out.id, out);
    return out;
  }

  /** An editable copy of a catalogue block. */
  fork(id: string, author = 'me'): BlockSpec | null {
    const b = this.get(id);
    return b ? this.saveOwn(forkBlock(b, author)) : null;
  }

  removeOwn(id: string): void {
    if (id.startsWith('local/')) this.store.delete('blocks', id);
  }

  /** Blocks from a `.json` file: one block, a list, or a catalogue. Every one is checked and kept as the pilot's own. */
  importJson(text: string): { saved: BlockSpec[]; rejected: number } {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return { saved: [], rejected: 1 };
    }
    const list: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { blocks?: unknown }).blocks) ? (raw as { blocks: unknown[] }).blocks : [raw];
    const saved: BlockSpec[] = [];
    let rejected = 0;
    for (const r of list.slice(0, 200)) {
      const b = this.saveOwn(r);
      if (b) saved.push(b);
      else rejected++;
    }
    return { saved, rejected };
  }

  exportJson(id: string): string | null {
    const b = this.get(id);
    return b ? JSON.stringify(b, null, 2) : null;
  }
}
