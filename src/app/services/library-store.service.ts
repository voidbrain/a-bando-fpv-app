import { Service, signal } from '@angular/core';

/** What the library keeps: bandos, the pilot's own blocks, the cached online catalogue, and small bookkeeping values. */
export type Collection = 'sites' | 'blocks' | 'catalog' | 'meta';
const COLLECTIONS: readonly Collection[] = ['sites', 'blocks', 'catalog', 'meta'];
const DB = 'abando-library';
const LS = 'abando-lib/';

/**
 * The local library store. In the browser it is IndexedDB (bandos with terrain, thumbnails and the catalogue do not fit
 * in localStorage), mirrored in memory so every read is synchronous; {@link init} loads it before the app starts. Where
 * IndexedDB is missing (tests, some private windows) it falls back to localStorage, loaded at once.
 */
@Service()
export class LibraryStore {
  private readonly mem = new Map<Collection, Map<string, unknown>>(COLLECTIONS.map((c) => [c, new Map()]));
  private db: IDBDatabase | null = null;
  /** Bumped on every write: computed views of the library re-evaluate. */
  readonly revision = signal(0);
  private ready: Promise<void> | null = null;

  constructor() {
    if (typeof indexedDB === 'undefined') this.loadLocal();
  }

  /** Open the database and load it into memory (once). The app waits for this before it starts. */
  init(): Promise<void> {
    if (typeof indexedDB === 'undefined') return Promise.resolve();
    this.ready ??= this.open().then(
      async (db) => {
        this.db = db;
        for (const c of COLLECTIONS) {
          const rows = await req<{ key: string; value: unknown }[]>(db.transaction(c, 'readonly').objectStore(c).getAll());
          for (const r of rows) this.mem.get(c)!.set(r.key, r.value);
        }
        this.revision.update((n) => n + 1);
      },
      () => {
        this.loadLocal(); // no database after all: work from localStorage
      },
    );
    return this.ready;
  }

  all<T>(c: Collection): T[] {
    return [...this.mem.get(c)!.values()] as T[];
  }

  get<T>(c: Collection, key: string): T | null {
    return (this.mem.get(c)!.get(key) as T | undefined) ?? null;
  }

  put(c: Collection, key: string, value: unknown): void {
    this.mem.get(c)!.set(key, value);
    this.revision.update((n) => n + 1);
    if (this.db) void this.write(c, (s) => s.put({ key, value }));
    else this.lsWrite(`${LS}${c}/${key}`, value);
  }

  delete(c: Collection, key: string): void {
    this.mem.get(c)!.delete(key);
    this.revision.update((n) => n + 1);
    if (this.db) void this.write(c, (s) => s.delete(key));
    else
      try {
        localStorage.removeItem(`${LS}${c}/${key}`);
      } catch {
        /* ignore */
      }
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((ok, ko) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        for (const c of COLLECTIONS) if (!r.result.objectStoreNames.contains(c)) r.result.createObjectStore(c, { keyPath: 'key' });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
      r.onblocked = () => ko(new Error('blocked'));
    });
  }

  private write(c: Collection, fn: (s: IDBObjectStore) => void): Promise<void> {
    return new Promise((ok) => {
      try {
        const tx = this.db!.transaction(c, 'readwrite');
        fn(tx.objectStore(c));
        tx.oncomplete = () => ok();
        tx.onerror = () => ok(); // a failed write keeps the value in memory for this visit
      } catch {
        ok();
      }
    });
  }

  private loadLocal(): void {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(LS)) continue;
        const [c, ...rest] = k.slice(LS.length).split('/');
        if (!COLLECTIONS.includes(c as Collection)) continue;
        try {
          this.mem.get(c as Collection)!.set(rest.join('/'), JSON.parse(localStorage.getItem(k) ?? 'null'));
        } catch {
          /* a corrupt entry is skipped, the rest still loads */
        }
      }
    } catch {
      /* no storage at all: memory only */
    }
  }

  private lsWrite(k: string, v: unknown): void {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* full or unavailable: kept in memory for this visit */
    }
  }
}

function req<T>(r: IDBRequest): Promise<T> {
  return new Promise((ok, ko) => {
    r.onsuccess = () => ok(r.result as T);
    r.onerror = () => ko(r.error);
  });
}
