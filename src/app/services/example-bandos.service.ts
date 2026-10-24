import { Service, inject, signal } from '@angular/core';
import { sanitizeExamples, type ExampleBando } from '../core/examples';
import { SiteService } from './site.service';
import { ToastService } from './toast.service';

/** Where the published examples are, relative to the app (served from `public/library/`). */
const BASE = 'library/';

/** The example bandos that ship with the app: listed in the Bandos panel, opened as the pilot's own copy. */
@Service()
export class ExampleBandosService {
  private readonly site = inject(SiteService);
  private readonly toast = inject(ToastService);
  readonly list = signal<ExampleBando[]>([]);
  readonly status = signal<'idle' | 'loading' | 'error'>('idle');
  private loaded = false;

  /** Download the list once (later calls do nothing unless the first one failed). */
  async load(): Promise<void> {
    if (this.loaded || this.status() === 'loading') return;
    this.status.set('loading');
    try {
      const res = await fetch(new URL(`${BASE}bandos.json`, document.baseURI).toString(), { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.list.set(sanitizeExamples(await res.json()));
      this.loaded = true;
      this.status.set('idle');
    } catch {
      this.status.set('error');
    }
  }

  /** Copy an example into the library and open it (it is then an ordinary bando: edit it, the example stays as it is). */
  async open(e: ExampleBando): Promise<boolean> {
    try {
      const res = await fetch(new URL(`${BASE}${e.file}`, document.baseURI).toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // the copy remembers which example and release it came from: a newer release can be pointed out later
      const raw = (await res.json()) as Record<string, unknown>;
      return this.site.importJson(JSON.stringify({ ...raw, derivedFrom: { example: e.file, release: e.release } }));
    } catch {
      this.toast.show(`Could not download “${e.name}”. Check the connection and try again.`);
      return false;
    }
  }
}
