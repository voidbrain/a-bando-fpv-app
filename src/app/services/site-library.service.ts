import { Injectable, inject } from '@angular/core';
import type { SiteSpec } from '../core/site-spec';
import { sanitizeSpec } from '../core/site-spec';
import { StorageService } from './storage.service';

const INDEX_KEY = 'abando-ng-sites';
const specKey = (id: string): string => `abando-ng-site-${id}`;

/** Index row: what the library list shows without parsing every spec. */
export interface SiteEntry {
  id: string;
  name: string;
  createdAt: number;
  origin: { lat: number; lon: number };
  buildings: number;
}

/**
 * The site library: every generated / edited model is a plain {@link SiteSpec} stored in localStorage — open data
 * (OSM footprints + own edits), so saving it is allowed with attribution. One index key lists the entries; each spec
 * lives under its own key so a corrupt entry cannot break the whole library.
 */
@Injectable({ providedIn: 'root' })
export class SiteLibraryService {
  private readonly storage = inject(StorageService);

  list(): SiteEntry[] {
    const raw = this.storage.readRaw(INDEX_KEY);
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw) as unknown;
      return Array.isArray(arr) ? (arr as SiteEntry[]).filter((e) => e && typeof e.id === 'string') : [];
    } catch {
      return [];
    }
  }

  load(id: string): SiteSpec | null {
    const raw = this.storage.readRaw(specKey(id));
    if (!raw) return null;
    try {
      return sanitizeSpec(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }

  save(spec: SiteSpec): void {
    this.storage.write(specKey(spec.id), spec);
    const entries = this.list().filter((e) => e.id !== spec.id);
    entries.unshift({ id: spec.id, name: spec.name, createdAt: spec.createdAt, origin: spec.origin, buildings: spec.buildings.length });
    this.storage.write(INDEX_KEY, entries.slice(0, 50));
  }

  remove(id: string): void {
    this.storage.remove(specKey(id));
    this.storage.write(INDEX_KEY, this.list().filter((e) => e.id !== id));
  }

  rename(id: string, name: string): void {
    const spec = this.load(id);
    if (!spec) return;
    spec.name = name;
    this.save(spec);
  }

  /** Import a spec exported by {@link exportJson} (JSON.parse + sanitize). Returns null when invalid. */
  importJson(text: string): SiteSpec | null {
    try {
      return sanitizeSpec(JSON.parse(text) as unknown);
    } catch {
      return null;
    }
  }

  exportJson(spec: SiteSpec): string {
    return JSON.stringify(spec, null, 2);
  }
}
