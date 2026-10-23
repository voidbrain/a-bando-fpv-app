import { Component, inject, signal } from '@angular/core';
import type { Privacy } from '../../core/share';
import { BackupService } from '../../services/backup.service';
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
          <button class="btn" (click)="backupAll()" [disabled]="!site.bandos().length" title="Save every bando and your own blocks in one file (keep it somewhere safe: the browser can lose what it stores)">Back up all</button>
          <label class="btn" title="Bring back a backup file: bandos it has that are missing here are added, an older copy here is replaced, a newer one is kept">Restore…<input type="file" accept=".json,application/json" hidden (change)="restoreFile($event)" /></label>
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
                <span class="dim small mono">{{ b.buildings }} buildings · {{ b.privacy === 'hidden' ? 'place hidden' : b.origin.lat.toFixed(4) + ', ' + b.origin.lon.toFixed(4) }}</span>
              </button>
              <div class="acts">
                <button class="btn" (click)="studio.edit(b.id)" [title]="b.privacy === 'hidden' ? 'Edit the model (its place is hidden, so there is no map area)' : 'Change the area on the map and regenerate'">{{ b.privacy === 'hidden' ? 'Edit' : 'Edit area' }}</button>
                <button class="btn" (click)="rename(b.id, b.name)">Rename</button>
                <button class="btn" (click)="duplicate(b.id)">Duplicate</button>
                @if (b.privacy === 'hidden') {
                  <button class="btn" (click)="exportOne(b.id, 'hidden')" title="Save it as a file to share; its place stays hidden">Export</button>
                } @else {
                  <span class="grp">
                    <button class="btn" (click)="exportOne(b.id, 'exact')" title="Save it as a file to share, with its place">Export</button>
                    <button class="btn" (click)="exportOne(b.id, 'hidden')" title="Save a copy to share without its place: no map, no map names, no GPS landmarks">Export hidden</button>
                  </span>
                }
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
                <span class="dim small mono">{{ e.buildings }} buildings · {{ e.privacy === 'hidden' ? 'place hidden' : e.origin.lat.toFixed(4) + ', ' + e.origin.lon.toFixed(4) }}</span>
              </div>
              @if (e.about) { <div class="dim small about">{{ e.about }}</div> }
              <div class="acts">
                <button class="btn" (click)="openExample(e)" [attr.data-tour]="'example-' + e.file.replace('bandos/', '').replace('.json', '')" [disabled]="opening() === e.file" [title]="'Add a copy of ' + e.name + ' to your bandos and open it'">{{ opening() === e.file ? 'Opening…' : 'Open a copy' }}</button>
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
  private readonly backups = inject(BackupService);
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
  /** Export one bando: with its place or hidden (a bando whose place is hidden is always exported hidden). */
  protected async exportOne(id: string, privacy: Privacy): Promise<void> {
    const f = await this.site.exportShared(id, privacy);
    if (!f) return;
    this.downloads.save(f.name, f.text, 'application/json');
    const where = f.hidden ? ' without its place' : '';
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

  protected async backupAll(): Promise<void> {
    const b = await this.backups.backup();
    this.downloads.save(b.name, b.text, 'application/json');
    this.toast.show(`Backed up ${b.bandos} bandos and ${b.blocks} own blocks in ${b.name}.`);
  }

  protected async restoreFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const r = await this.backups.restore(await file.text());
    if (!r) return void this.toast.show('That file is not an OpenBando backup.');
    const parts = [
      r.added && `${r.added} added`,
      r.replaced && `${r.replaced} replaced by the backup's newer copy`,
      r.kept && `${r.kept} kept (newer here)`,
      r.blocks && `${r.blocks} own blocks`,
      r.dropped && `${r.dropped} broken entries skipped`,
    ].filter((x): x is string => !!x);
    this.toast.show(parts.length ? `Restored: ${parts.join(' · ')}.` : 'Nothing to restore: the backup is empty.', 5000);
  }

  protected async importFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.site.importJson(await file.text());
    input.value = '';
  }
}
