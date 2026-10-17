import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Panel, FormsModule, BandoEditor],
  template: `
    <app-panel id="studio">
      @if (studio.view() === 'list') {
        <div class="row">
          <button class="btn primary" (click)="studio.create()">＋ New bando</button>
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
                <span class="dim small mono">{{ b.buildings }} buildings · {{ b.origin.lat.toFixed(4) }}, {{ b.origin.lon.toFixed(4) }}</span>
              </button>
              <div class="acts">
                <button class="btn" (click)="studio.edit(b.id)" title="Change the area on the map and regenerate">Edit area</button>
                <button class="btn" (click)="rename(b.id, b.name)">Rename</button>
                <button class="btn" (click)="duplicate(b.id)">Duplicate</button>
                <button class="btn danger" (click)="remove(b.id, b.name)">Delete</button>
              </div>
            </div>
          }
        </div>
      } @else {
        <div class="zone">
          <div class="row">
            <button class="btn" (click)="studio.back()">← Bandos</button>
            <input type="text" class="grow" [ngModel]="studio.name()" (ngModelChange)="studio.name.set($event)" placeholder="Bando name" aria-label="Bando name" />
          </div>
          <app-bando-editor />
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

  protected rename(id: string, current: string): void {
    const name = prompt('Bando name', current);
    if (name) this.site.rename(id, name);
  }

  protected duplicate(id: string): void {
    if (this.site.duplicate(id)) this.toast.show('Bando duplicated.');
  }

  protected remove(id: string, name: string): void {
    if (confirm(`Delete “${name}”? This cannot be undone.`)) this.site.remove(id);
  }

  protected async importFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.site.importJson(await file.text());
    input.value = '';
  }
}
