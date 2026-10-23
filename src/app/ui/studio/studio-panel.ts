import { Component, inject, signal } from '@angular/core';
import type { Privacy } from '../../core/share';
import { DownloadService } from '../../services/download.service';
import { tr } from '../../services/i18n.service';
import { ExampleBandosService } from '../../services/example-bandos.service';
import type { ExampleBando } from '../../core/examples';
import { FormsModule } from '@angular/forms';
import { SiteService } from '../../services/site.service';
import { StudioService } from '../../services/studio.service';
import { ToastService } from '../../services/toast.service';
import { Panel } from '../panel/panel';
import { BandoEditor } from './bando-editor';

/**
 * Bandos: the entry point of the map builder. First a list — open, create, edit the area of, duplicate, rename or
 * delete a bando — then, for a new / edited bando, the zone map where you search a place, drag and zoom the map to
 * frame the area, and generate the 3D model from it.
 */
@Component({
  selector: 'app-studio-panel',
  imports: [Panel, FormsModule, BandoEditor],
  template: `
    <app-panel id="studio">
      @if (studio.view() === 'list') {
        <div class="row">
          <button class="btn primary" (click)="studio.create()" data-tour="new-bando">＋ New bando</button>
          <label class="btn">Import<input type="file" accept=".json,application/json" hidden (change)="importFile($event)" /></label>
          <span class="grow"></span>
        </div>
        @if (site.bandos().length === 0) {
          <div class="empty dim">
            No bando yet. Press <b>New bando</b>, search a place, frame the area on the map and generate the 3D model.
          </div>
        }
        <div class="list">
          @for (b of site.bandos(); track b.id) {
            <div class="card" [class.active]="b.id === site.active().id">
              <button class="title" (click)="studio.open(b.id)" [title]="'Show ' + b.name + ' in 3D'">
                <b>{{ b.name }}</b>
                @if (b.id === site.active().id) { <span class="badge">open</span> }
                <span class="dim small mono">{{ b.buildings }} buildings · {{ b.privacy === 'hidden' ? 'place hidden' : (b.privacy === 'rounded' ? '~' : '') + b.origin.lat.toFixed(b.privacy === 'rounded' ? 2 : 4) + ', ' + b.origin.lon.toFixed(b.privacy === 'rounded' ? 2 : 4) }}</span>
              </button>
              <div class="acts">
                <button class="btn" (click)="studio.edit(b.id)" [title]="b.privacy === 'hidden' ? 'Edit the model (its place is hidden, so there is no map area)' : 'Change the area on the map and regenerate'">{{ b.privacy === 'hidden' ? 'Edit' : 'Edit area' }}</button>
                <button class="btn" (click)="rename(b.id, b.name)">Rename</button>
                <button class="btn" (click)="duplicate(b.id)">Duplicate</button>
                <span class="grp">
                  <select class="exp" [value]="privacy()" (change)="privacy.set(privacyOf($event))" [attr.aria-label]="'Place in the exported file of ' + b.name" title="What the file says about where it is">
                    <option value="exact" [selected]="privacy() === 'exact'">exact place</option>
                    <option value="rounded" [selected]="privacy() === 'rounded'">place ~1 km</option>
                    <option value="hidden" [selected]="privacy() === 'hidden'">place hidden</option>
                  </select>
                  <button class="btn" (click)="exportOne(b.id)" title="Save it as a file to share (the place as chosen)">Export</button>
                </span>
                <button class="btn danger" (click)="remove(b.id, b.name)">Delete</button>
              </div>
            </div>
          }
        </div>
        <h4 class="caption" data-tour="examples">Examples</h4>
        @if (examples.status() === 'error') {
          <div class="dim small">The examples could not be downloaded. <button class="btn" (click)="examples.load()">Try again</button></div>
        }
        <div class="list">
          @for (e of examples.list(); track e.file) {
            <div class="card ex">
              <div class="title static">
                <b>{{ e.name }}</b>
                <span class="dim small mono">{{ e.buildings }} buildings · {{ e.privacy === 'hidden' ? 'place hidden' : (e.privacy === 'rounded' ? '~' : '') + e.origin.lat.toFixed(e.privacy === 'rounded' ? 2 : 4) + ', ' + e.origin.lon.toFixed(e.privacy === 'rounded' ? 2 : 4) }}</span>
              </div>
              @if (e.about) { <div class="dim small about">{{ e.about }}</div> }
              <div class="acts">
                <button class="btn" (click)="openExample(e)" [disabled]="opening() === e.file" [title]="'Add a copy of ' + e.name + ' to your bandos and open it'">{{ opening() === e.file ? 'Opening…' : 'Open a copy' }}</button>
              </div>
            </div>
          }
        </div>
      } @else {
        <div class="zone">
          <app-bando-editor>
            <button class="btn" (click)="studio.back()">← Bandos</button>
            <input type="text" class="name" [ngModel]="studio.name()" (ngModelChange)="studio.name.set($event)" placeholder="Bando name" aria-label="Bando name" />
          </app-bando-editor>
        </div>
      }
    </app-panel>
  `,
  styles: `
    .zone {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
    }
    .name {
      width: 180px;
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 4px;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 6px 8px;
      background: #17211b;
    }
    .card.active {
      border-color: var(--accent);
    }
    .title {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px 8px;
      width: 100%;
      background: none;
      border: 0;
      padding: 0 0 4px;
      text-align: left;
      cursor: pointer;
    }
    .badge {
      background: var(--accent);
      color: var(--accent-ink);
      border-radius: 8px;
      padding: 0 6px;
      font-size: 10px;
      font-weight: 700;
    }
    .acts {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    .caption {
      margin: 12px 0 2px;
    }
    .title.static {
      cursor: default;
    }
    .about {
      padding: 0 0 6px;
    }
    .empty {
      padding: 18px 8px;
      text-align: center;
    }
  `,
})
export class StudioPanel {
  protected readonly studio = inject(StudioService);
  protected readonly site = inject(SiteService);
  private readonly toast = inject(ToastService);
  private readonly downloads = inject(DownloadService);
  protected readonly examples = inject(ExampleBandosService);
  /** The example being downloaded. */
  protected readonly opening = signal<string | null>(null);

  constructor() {
    void this.examples.load();
  }

  protected async openExample(e: ExampleBando): Promise<void> {
    this.opening.set(e.file);
    await this.examples.open(e);
    this.opening.set(null);
  }
  /** How much of its place an exported file keeps (hidden by default: share a bando, not its address). */
  protected readonly privacy = signal<Privacy>('hidden');
  protected privacyOf = (e: Event): Privacy => {
    const v = (e.target as HTMLSelectElement).value;
    return v === 'exact' || v === 'rounded' ? v : 'hidden';
  };

  protected async exportOne(id: string): Promise<void> {
    const f = await this.site.exportShared(id, this.privacy());
    if (!f) return;
    this.downloads.save(f.name, f.text, 'application/json');
    const where = this.privacy() === 'hidden' ? ' without its place' : this.privacy() === 'rounded' ? ' with its place rounded to ~1 km' : '';
    this.toast.show(`Exported ${f.name}${where}${f.ground ? '; its real ground travels inside' : ''}.`);
  }

  protected rename(id: string, current: string): void {
    const name = prompt(tr('Bando name'), current);
    if (name) this.site.rename(id, name);
  }

  protected duplicate(id: string): void {
    if (this.site.duplicate(id)) this.toast.show('Bando duplicated.');
  }

  protected remove(id: string, name: string): void {
    if (confirm(tr(`Delete “${name}”? This cannot be undone.`))) this.site.remove(id);
  }

  protected async importFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.site.importJson(await file.text());
    input.value = '';
  }
}
