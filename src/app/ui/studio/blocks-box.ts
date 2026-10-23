import { Component, computed, inject, input, output, signal } from '@angular/core';
import { tr } from '../../services/i18n.service';
import { blockFrom, detachInstance, outdated, paramValues, removeInstance, updateInstance, type BlockKind, type BlockSpec, type ParamValue } from '../../core/blocks';
import { searchBlocks } from '../../core/catalog';
import type { BuildingSpec, StructureSpec } from '../../core/site-spec';
import { AiService } from '../../services/ai.service';
import { BlockLibraryService } from '../../services/block-library.service';
import { DownloadService } from '../../services/download.service';
import { SiteService } from '../../services/site.service';
import { ToastService } from '../../services/toast.service';
import { FloatBox } from '../float-box';
import { ToolIcon } from './tool-icon';

/** "Place this block with these values, turned so much" — the editor then places it where the pilot clicks. */
export interface BlockArm {
  block: BlockSpec;
  params: Record<string, ParamValue>;
  rot: number;
}

/**
 * The blocks library: the pilot's own blocks and the online catalogue, searchable; pick one, set its values, then
 * Place (click the map) or, for a pattern, Apply it to the selected building's floor. Also: placed blocks with a newer
 * version, saving the selection as a block, import / export, and describing a new object to the AI.
 */
@Component({
  selector: 'app-blocks-box',
  imports: [FloatBox, ToolIcon],
  template: `
    <app-float-box fid="blocks-v1" title="Library" [x]="70" [y]="8" [w]="300" [h]="440" [minW]="250" [minH]="180">
      <div class="top">
        <input type="search" class="q" placeholder="Search blocks…" [value]="q()" (input)="q.set(val($event))" aria-label="Search blocks" />
        <button class="btn" (click)="lib.sync()" [disabled]="lib.status() === 'syncing'" [title]="syncTitle()" aria-label="Check the online catalogue for new blocks">@if (lib.status() === 'syncing') {<i class="spin"></i>} @else {↻}</button>
      </div>
      <div class="tabs" role="tablist" aria-label="Kind of block">
        @for (k of kinds; track k.id) {
          <button role="tab" [class.on]="kind() === k.id" [attr.aria-selected]="kind() === k.id" (click)="kind.set(k.id)">{{ k.label }}</button>
        }
      </div>
      @if (lib.status() === 'offline' || lib.status() === 'error') {
        <div class="dim small">{{ lib.status() === 'offline' ? 'Offline: showing the saved catalogue.' : 'The catalogue could not be checked; showing the saved one.' }}</div>
      }
      <div class="scroll">
        @if (updates().length) {
          <div class="upd">
            <b class="small">Updates in this bando</b>
            @for (u of updates(); track u.ref.inst) {
              <div class="urow">
                <span class="nm">{{ nameOf(u.ref.id) }} <span class="dim small">v{{ u.ref.v }} → v{{ u.latest }}</span></span>
                <button class="btn" (click)="update(u.ref.inst, u.ref.id)">Update</button>
                <button class="btn" (click)="detach(u.ref.inst)" title="Keep it as it is and forget the block">Detach</button>
              </div>
            }
          </div>
        }
        @for (b of shown(); track b.id) {
          <div class="item" [class.sel]="b.id === selId()">
            <button class="row" (click)="pick(b)" [attr.aria-expanded]="b.id === selId()" [attr.data-tour]="'block-' + b.id">
              <span class="th">
                @if (iconOf(b); as ic) {
                  <app-tool-icon [name]="ic" />
                } @else if (b.thumbnail) {
                  <img [src]="b.thumbnail" alt="" width="28" height="28" />
                }
              </span>
              <span class="nm">{{ b.name }}</span>
              <span class="dim small">{{ b.id.startsWith('local/') ? 'mine' : 'v' + b.version }}</span>
            </button>
            @if (b.id === selId()) {
              <div class="det">
                @if (b.description) {
                  <div class="dim small">{{ b.description }}</div>
                }
                <div class="dim small">{{ kindLabel(b.kind) }} · {{ b.author }} · {{ b.licence }}</div>
                @for (p of b.params; track p.key) {
                  <label class="fld">
                    {{ p.label }}
                    @if (p.type === 'bool') {
                      <input type="checkbox" [checked]="!!values()[p.key]" (change)="setValue(p.key, checked($event))" />
                    } @else if (p.type === 'choice') {
                      <select (change)="setValue(p.key, val($event))">
                        @for (o of p.options ?? []; track o) {
                          <option [value]="o" [selected]="values()[p.key] === o">{{ o }}</option>
                        }
                      </select>
                    } @else {
                      <input type="number" [min]="p.min ?? null" [max]="p.max ?? null" [step]="p.step ?? (p.type === 'int' ? 1 : 0.5)" [value]="values()[p.key]" (change)="setValue(p.key, num($event))" />
                    }
                  </label>
                }
                <div class="acts">
                  @if (b.kind === 'pattern') {
                    <button class="btn primary" [disabled]="!building()" (click)="apply.emit({ block: b, params: values(), rot: 0 })" [title]="building() ? 'Apply to the selected building, this floor' : 'Select a building first'">Apply to floor</button>
                  } @else {
                    <label class="lay">turn <input class="mini" type="number" step="15" [value]="rot()" (change)="rot.set(num($event))" />°</label>
                    <button class="btn primary" (click)="arm.emit({ block: b, params: values(), rot: rot() })" data-tour="block-place" title="Then click the map where it goes (Esc stops)">Place</button>
                  }
                  @if (b.id.startsWith('local/')) {
                    <button class="btn" (click)="exportOne(b)">Export</button>
                    <button class="btn danger" (click)="lib.removeOwn(b.id)">Delete</button>
                  } @else {
                    <button class="btn" (click)="fork(b)" title="An editable copy among your own blocks">Copy to mine</button>
                  }
                </div>
              </div>
            }
          </div>
          } @empty {
            <div class="dim small">{{ lib.all().length ? 'Nothing matches.' : 'No blocks yet: check the catalogue (↻) or import a file.' }}</div>
          }
        </div>
      <div class="foot">
        <button class="btn" [disabled]="!building() && !structure()" (click)="saveSelection()" title="The selected building or structure becomes one of your blocks">Save selection as block</button>
        <label class="btn file">Import…<input type="file" accept=".json,application/json" (change)="importFile($event)" /></label>
      </div>
      <details class="ai">
        <summary>Describe a new object to the AI</summary>
        <textarea rows="2" placeholder="a rusty fuel pump with a hose" [value]="desc()" (input)="desc.set(val($event))" aria-label="Describe the object"></textarea>
        <div class="acts">
          <button class="btn" [disabled]="ai.busy() || !desc().trim()" (click)="describe()">@if (ai.busy()) {<i class="spin"></i> } Make it</button>
          <span class="dim small">{{ ai.status() === 'ready' ? '' : 'Connect a model in the assistant (💬) first.' }}</span>
        </div>
        @if (aiNote()) {
          <div class="small" [class.bad]="aiError()">{{ aiNote() }}</div>
        }
      </details>
    </app-float-box>
  `,
  styles: `
    .top { display: flex; gap: 4px; }
    .q { flex: 1; min-width: 0; }
    .tabs { display: flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
    .tabs button { flex: 1; background: none; border: 0; padding: 3px 4px; cursor: pointer; color: var(--dim); font-size: 11px; }
    .tabs button.on { background: var(--accent); color: var(--accent-ink); font-weight: 700; }
    .scroll { overflow: auto; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 2px; }
    .row { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: none; border: 1px solid transparent; border-radius: 6px; padding: 3px 4px; cursor: pointer; color: inherit; }
    .row:hover { background: rgba(255, 255, 255, 0.06); }
    .item.sel > .row { border-color: var(--accent); }
    .th { width: 30px; height: 30px; flex: none; display: grid; place-items: center; background: rgba(0, 0, 0, 0.25); border-radius: 5px; }
    .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .det { display: flex; flex-direction: column; gap: 4px; padding: 4px 6px 8px 42px; }
    .fld { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 11px; color: var(--dim); }
    .fld input[type='number'] { width: 70px; }
    .acts { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    .foot { display: flex; gap: 4px; flex-wrap: wrap; }
    .file { position: relative; overflow: hidden; }
    .file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
    .upd { border: 1px solid var(--warn); border-radius: 6px; padding: 4px 6px; display: flex; flex-direction: column; gap: 3px; }
    .urow { display: flex; gap: 4px; align-items: center; }
    .ai summary { cursor: pointer; font-size: 11px; color: var(--dim); }
    .ai textarea { width: 100%; box-sizing: border-box; resize: vertical; background: #121a15; border: 1px solid var(--line); border-radius: 6px; color: var(--text); padding: 3px 6px; }
    .bad { color: var(--warn); }
  `,
})
export class BlocksBox {
  /** The selected building / structure of the editor (for patterns and "save selection"). */
  readonly building = input<BuildingSpec | null>(null);
  readonly structure = input<StructureSpec | null>(null);
  readonly arm = output<BlockArm>();
  readonly apply = output<BlockArm>();

  protected readonly lib = inject(BlockLibraryService);
  protected readonly ai = inject(AiService);
  private readonly site = inject(SiteService);
  private readonly toast = inject(ToastService);
  private readonly downloads = inject(DownloadService);

  protected readonly kinds: readonly { id: BlockKind | ''; label: string }[] = [
    { id: '', label: 'All' },
    { id: 'structure', label: 'Objects' },
    { id: 'building', label: 'Buildings' },
    { id: 'group', label: 'Groups' },
    { id: 'pattern', label: 'Patterns' },
  ];
  protected readonly q = signal('');
  protected readonly kind = signal<BlockKind | ''>('');
  protected readonly selId = signal<string | null>(null);
  protected readonly given = signal<Record<string, ParamValue>>({});
  protected readonly rot = signal(0);
  protected readonly desc = signal('');
  protected readonly aiNote = signal('');
  protected readonly aiError = signal(false);

  protected readonly shown = computed(() => searchBlocks(this.lib.all(), this.q(), this.kind()));
  protected readonly selected = computed(() => this.lib.all().find((b) => b.id === this.selId()) ?? null);
  protected readonly values = computed(() => {
    const b = this.selected();
    return b ? paramValues(b, this.given()) : {};
  });
  /** Placed blocks in this bando that have a newer version in the catalogue. */
  protected readonly updates = computed(() => outdated(this.site.editor.draft(), this.lib.latest()));
  protected readonly syncTitle = computed(() => {
    const s = this.lib.lastSync();
    return s ? `Check the online catalogue · last change: ${s.added} new, ${s.updated} updated` : 'Check the online catalogue for new blocks';
  });

  constructor() {
    void this.lib.sync();
  }

  protected val = (e: Event): string => (e.target as HTMLInputElement).value;
  protected num = (e: Event): number => Number((e.target as HTMLInputElement).value) || 0;
  protected checked = (e: Event): boolean => (e.target as HTMLInputElement).checked;
  protected iconOf = (b: BlockSpec): string | null => (b.thumbnail?.startsWith('icon:') ? b.thumbnail.slice(5) : b.thumbnail ? null : b.kind === 'pattern' ? 'wall' : b.kind === 'building' ? 'building' : 'blocks');
  protected kindLabel = (k: BlockKind): string => ({ structure: 'Object', building: 'Building', group: 'Group', pattern: 'Pattern (applies to a floor)' })[k];
  protected nameOf = (id: string): string => this.lib.get(id)?.name ?? id;

  protected pick(b: BlockSpec): void {
    if (this.selId() === b.id) {
      this.selId.set(null);
      return;
    }
    this.selId.set(b.id);
    this.given.set({});
    this.rot.set(0);
  }

  protected setValue(k: string, v: ParamValue): void {
    this.given.update((g) => ({ ...g, [k]: v }));
  }

  protected fork(b: BlockSpec): void {
    const f = this.lib.fork(b.id, 'me');
    if (f) {
      this.selId.set(f.id);
      this.toast.show(`“${f.name}” copied to your blocks (${f.id}).`);
    }
  }

  protected exportOne(b: BlockSpec): void {
    const text = this.lib.exportJson(b.id);
    if (text) this.downloads.save(`${b.id.split('/')[1]}.json`, text, 'application/json');
  }

  protected async importFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    const r = this.lib.importJson(await f.text());
    this.toast.show(r.saved.length ? `${r.saved.length} block${r.saved.length > 1 ? 's' : ''} imported${r.rejected ? `, ${r.rejected} refused` : ''}.` : 'Nothing usable in that file.');
    if (r.saved[0]) this.selId.set(r.saved[0].id);
  }

  protected saveSelection(): void {
    const b = this.building(), s = this.structure();
    const anchor = b ? b.pos : s ? { x: s.x, z: s.z } : null;
    if (!anchor) return;
    const name = prompt(tr('Name of the new block'), b?.name ?? s?.name ?? 'My block');
    if (!name?.trim()) return;
    const made = blockFrom(name.trim(), 'me', { buildings: b ? [b] : [], structures: s ? [s] : [] }, anchor, b?.rotDeg ?? s?.rotDeg ?? 0);
    const saved = made ? this.lib.saveOwn(made) : null;
    this.toast.show(saved ? `Saved as “${saved.name}” (${saved.id}).` : 'That selection cannot be made into a block.');
    if (saved) this.selId.set(saved.id);
  }

  protected update(inst: string, id: string): void {
    const b = this.lib.get(id);
    if (!b) return;
    let ok = false;
    this.site.editor.commitSite((s) => {
      ok = updateInstance(s, inst, b);
    });
    this.site.applyDraft();
    this.toast.show(ok ? `Updated to “${b.name}” v${b.version}.` : 'Could not update it.');
  }

  protected detach(inst: string): void {
    this.site.editor.commitSite((s) => detachInstance(s, inst));
    this.site.applyDraft();
  }

  /** Remove every element of one placement (used by the editor's inspector too). */
  remove(inst: string): void {
    this.site.editor.commitSite((s) => removeInstance(s, inst));
    this.site.applyDraft();
  }

  protected async describe(): Promise<void> {
    this.aiNote.set('');
    const r = await this.ai.generateBlock(this.desc());
    if (!r.block) {
      this.aiError.set(true);
      this.aiNote.set(r.error ?? 'No usable object.');
      return;
    }
    const saved = this.lib.saveOwn(r.block);
    this.aiError.set(!saved);
    if (saved) {
      this.aiNote.set(`Made “${saved.name}”: it is in your blocks. Place it to see it; delete it if it is not right.`);
      this.selId.set(saved.id);
      this.kind.set('');
      this.q.set('');
    } else this.aiNote.set('The answer did not pass the checks.');
  }
}
