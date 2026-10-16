import { AfterContentChecked, ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as THREE from 'three';
import type { BuildingSpec, LevelSpec, SiteSpec } from '../../core/site-spec';
import { pointInBuilding } from '../../core/site-spec';
import { CalibrationStore } from '../../state/calibration.store';
import { MapStore } from '../../state/map.store';
import { DownloadService } from '../../services/download.service';
import { GeoService } from '../../services/geo.service';
import { SceneService } from '../../services/scene.service';
import { SiteLibraryService, type SiteEntry } from '../../services/site-library.service';
import { SiteService } from '../../services/site.service';
import { ToastService } from '../../services/toast.service';
import { checkedFrom, numberFrom, selectedFrom, textFrom } from '../dom';
import { Panel } from '../panel/panel';

type Side = 'n' | 's' | 'e' | 'w';
const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];

/**
 * The Sites panel: the front end of the 3D map builder. One JSON document (SiteSpec) is the single source of truth —
 * this panel sets the map location and generates a site from it (address search or Alt+click on the 3D scene), edits
 * every building (size, position, rotation, walls, openings, roof, levels, guessed interiors + partition tool) with
 * undo/redo, and manages the browser library (save / open / delete / JSON import & export). Changes preview live in
 * the 3D scene through {@link SiteService.applyDraft}.
 */
@Component({
  selector: 'app-sites-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Panel, FormsModule],
  template: `
    <app-panel id="sites">
      <!-- location & generation -->
      <h4>Location</h4>
      <div class="row">
        <input type="text" class="grow" placeholder="Address or place name (or lat, lon)" [(ngModel)]="query" (keyup.enter)="generate()" />
        <button class="btn primary" [disabled]="site.generating()" (click)="generate()">{{ site.generating() ? 'Working…' : 'Generate' }}</button>
      </div>
      <div class="row">
        <label>scale × <input type="number" min="0.2" max="5" step="0.1" [(ngModel)]="genScale" /></label>
        <span class="dim small mono">{{ originLabel() }}</span>
      </div>
      <div class="row">
        <label>bearing ° <input type="number" step="1" [value]="ed.draft().bearingDeg" (change)="setBearing(num($event))" /></label>
        <button class="btn" title="Set the model’s north from the map alignment rotation" (click)="pointNorth()">Point north</button>
        <span class="dim small">Tip: open the Map panel and align the satellite image first.</span>
      </div>

      <!-- active site & library -->
      <h4>Site</h4>
      <div class="row">
        <input type="text" class="grow" [value]="ed.draft().name" (change)="rename(text($event))" />
        <button class="btn" [disabled]="!ed.canUndo()" (click)="ed.undo()" title="Undo">↶</button>
        <button class="btn" [disabled]="!ed.canRedo()" (click)="ed.redo()" title="Redo">↷</button>
      </div>
      <div class="row">
        <button class="btn" (click)="save()">Save</button>
        <button class="btn" (click)="exportJson()">Export JSON</button>
        <label class="btn">Import<input type="file" accept=".json,application/json" hidden (change)="importFile($event)" /></label>
        <button class="btn" (click)="site.useBuiltin()">A Bando</button>
      </div>
      @if (library().length) {
        <div class="row col lib">
          @for (e of library(); track e.id) {
            <div class="row entry" [class.active]="e.id === site.active().id">
              <button class="link" (click)="site.useStored(e.id)">{{ e.name }}</button>
              <span class="dim small mono grow">{{ coords(e) }} · {{ e.buildings }} bldg</span>
              <button class="gb danger" title="Delete from library" (click)="remove(e)">✕</button>
            </div>
          }
        </div>
      } @else {
        <div class="dim small">No saved sites yet — generate one from an address, or Alt+click the scene.</div>
      }

      <!-- buildings -->
      <h4>Buildings</h4>
      <div class="row wrap">
        @for (b of ed.draft().buildings; track b.id) {
          <button class="btn" [class.on]="ed.selectedId() === b.id" (click)="ed.select(b.id)">{{ b.name }}</button>
        }
        <button class="btn" (click)="ed.addBuilding()">＋ Add</button>
      </div>
      @if (sel(); as b) {
        <div class="row">
          <label class="grow">name <input type="text" class="grow" [value]="b.name" (change)="patch({ name: text($event) })" /></label>
          <button class="btn" (click)="ed.duplicateSelected()" title="Duplicate">⧉</button>
          <button class="btn danger" (click)="ed.removeBuilding(b.id)">Delete</button>
        </div>
        <div class="row">
          <label>x <input type="number" step="1" [value]="b.pos.x.toFixed(1)" (change)="patch({ pos: { x: num($event), z: b.pos.z } })" /></label>
          <label>z <input type="number" step="1" [value]="b.pos.z.toFixed(1)" (change)="patch({ pos: { x: b.pos.x, z: num($event) } })" /></label>
          <label>rot° <input type="number" step="5" [value]="b.rotDeg" (change)="patch({ rotDeg: num($event) })" /></label>
        </div>
        <div class="row">
          <label>length <input type="number" min="2" step="0.5" [value]="b.length" (change)="patch({ length: num($event) })" /></label>
          <label>width <input type="number" min="2" step="0.5" [value]="b.width" (change)="patch({ width: num($event) })" /></label>
          @if (!b.frame) {
            <label>height <input type="number" min="1" step="0.5" [value]="lvl()?.height ?? 0" (change)="setHeight(num($event))" /></label>
          }
        </div>

        @if (!b.frame) {
          <!-- levels -->
          <div class="row">
            @for (l of b.levels; track $index) {
              <button class="btn" [class.on]="$index === level()" (click)="level.set($index)">L{{ $index + 1 }}</button>
            }
            <button class="btn" (click)="ed.addLevel()" title="Add level">＋ floor</button>
            @if (b.levels.length > 1) {
              <button class="btn danger" (click)="ed.removeLevel(level())">− floor</button>
            }
          </div>

          @if (lvl(); as l) {
            <!-- walls & roof -->
            <div class="row">
              @for (s of sides; track s) {
                <label class="check"><input type="checkbox" [checked]="l.sides[s]" (change)="setWall(s, checked($event))" /> {{ s }}</label>
              }
              <select [value]="l.roof" (change)="setRoof(selectedRoof($event))">
                <option value="gable">gable</option>
                <option value="vault">vault</option>
                <option value="flat">flat</option>
              </select>
              <label>rise <input type="number" min="0.2" step="0.5" [value]="l.roofRise" (change)="setRoofRise(num($event))" /></label>
            </div>

            <!-- openings -->
            <div class="row">
              <select [value]="openSide()" (change)="setOpenSide(selected($event))">
                @for (s of sides; track s) {
                  <option [value]="s">{{ sideName(s) }}</option>
                }
              </select>
              <button class="btn" (click)="addOpening('door')">＋ door</button>
              <button class="btn" (click)="addOpening('window')">＋ window</button>
            </div>
            @if (openings().length) {
              <div class="row col">
                @for (o of openings(); track $index) {
                  <div class="row">
                    <select [value]="o.kind" (change)="patchOpening($index, { kind: selectedKind($event) })">
                      <option value="door">door</option>
                      <option value="window">window</option>
                    </select>
                    <label>c <input type="number" step="0.5" [value]="o.c.toFixed(1)" (change)="patchOpening($index, { c: num($event) })" /></label>
                    <label>w <input type="number" step="0.1" [value]="o.w" (change)="patchOpening($index, { w: num($event) })" /></label>
                    <label>h <input type="number" step="0.1" [value]="o.h" (change)="patchOpening($index, { h: num($event) })" /></label>
                    <button class="gb danger" (click)="removeOpening($index)">✕</button>
                  </div>
                }
              </div>
            }

            <!-- interior -->
            <div class="row">
              <button class="btn" (click)="ed.guessInterior()" title="Split into four rooms as a starting point">Guess interior</button>
              <button class="btn" [class.on]="partitionMode()" (click)="togglePartition()" title="Click twice in the plan: wall start → wall end">Draw partition</button>
              <span class="dim small mono">{{ rooms().length }} rooms · {{ l.partitions.length }} walls</span>
            </div>
          }
        } @else {
          <div class="dim small">Greenhouse frame — walls and roof are fixed.</div>
        }

        <!-- 2D plan: footprint, partitions, click to draw -->
        <canvas
          #plan
          class="plan keep"
          [title]="partitionMode() ? 'Click: first endpoint, then second' : 'Footprint of ' + b.name"
          (click)="onPlanClick($event)"
        ></canvas>
      } @else {
        <div class="dim small">Select a building above, or add one.</div>
      }

      <!-- surroundings -->
      <h4>Surroundings</h4>
      <div class="row">
        <button class="btn" [class.on]="treeMode()" (click)="toggleTree()">＋ Tree</button>
        <button class="btn" [disabled]="!site.active().trees.length" (click)="popTree()">− Last tree</button>
        <span class="dim small mono">{{ site.active().trees.length }} trees</span>
      </div>
      <div class="row">
        <label>ground <input type="color" [value]="ed.draft().groundColor" (change)="setGround(selectedColor($event))" /></label>
        <span class="dim small">Source: {{ geo.attribution }}</span>
      </div>
    </app-panel>
  `,
  styles: `
    h4 {
      margin: 8px 0 2px;
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--dim);
    }
    .lib {
      max-height: 150px;
      overflow: auto;
    }
    .entry.active .link {
      color: var(--accent);
    }
    .link {
      background: none;
      border: 0;
      color: var(--text);
      cursor: pointer;
      padding: 0;
      text-align: left;
      &:hover {
        text-decoration: underline;
      }
    }
    .gb {
      background: none;
      border: 0;
      cursor: pointer;
      color: var(--dim);
      &.danger:hover {
        color: var(--danger);
      }
    }
    .wrap {
      flex-wrap: wrap;
    }
    .plan {
      width: 100%;
      height: 170px;
      background: #0a0f0c;
      border: 1px solid var(--line);
      border-radius: 6px;
      touch-action: none;
      cursor: crosshair;
    }
  `,
})
export class SitesPanel implements AfterContentChecked {
  /** True while a pick mode (partition / tree) is armed: the stage hands its clicks to {@link stageClick}. */
  readonly picking = computed(() => this.partitionMode() || this.treeMode());
  private readonly site = inject(SiteService);
  protected readonly ed = this.site.editor;
  protected readonly libraryService = inject(SiteLibraryService);
  protected readonly geo = inject(GeoService);
  private readonly scene = inject(SceneService);
  protected readonly map = inject(MapStore);
  private readonly cal = inject(CalibrationStore);
  private readonly download = inject(DownloadService);
  protected readonly toast = inject(ToastService);

  /** The stage calls this with site-metre ground coordinates when a pick mode is armed (wired in SceneService). */
  readonly onStageClick = (x: number, z: number): void => this.stageClick(x, z);

  protected readonly query = signal('');
  protected readonly genScale = signal(1);
  protected readonly level = signal(0);
  protected readonly openSide = signal<Side>('n');
  protected readonly partitionMode = signal(false);
  protected readonly treeMode = signal(false);
  protected readonly sides = SIDES;
  protected readonly num = numberFrom;
  protected readonly text = (e: Event): string => textFrom(e);
  protected readonly checked = checkedFrom;
  protected readonly selected = selectedFrom;
  protected readonly selectedKind = (e: Event): 'door' | 'window' => selectedFrom(e) as 'door' | 'window';
  protected readonly selectedRoof = (e: Event): 'gable' | 'vault' | 'flat' => selectedFrom(e) as 'gable' | 'vault' | 'flat';
  protected readonly selectedColor = (e: Event): string => (e.target as HTMLInputElement).value;

  private readonly planEl = viewChild<ElementRef<HTMLCanvasElement>>('plan');
  readonly library = signal<SiteEntry[]>(this.libraryService.list());

  readonly sel = computed(() => this.ed.building());
  readonly lvl = computed(() => this.sel()?.levels[this.clampedLevel()] ?? null);
  readonly openings = computed(() => this.lvl()?.doors[this.openSide()] ?? []);
  readonly rooms = computed(() => this.ed.rooms());
  readonly originLabel = computed(() => {
    const o = this.ed.draft().origin;
    return `${o.lat.toFixed(5)}, ${o.lon.toFixed(5)}`;
  });

  ngAfterContentChecked(): void {
    this.drawPlan();
  }

  // ---- location & generation ----

  protected async generate(): Promise<void> {
    const q = this.query().trim();
    if (!q) {
      this.toast.show('Type an address, or Alt+click the 3D scene at the spot.');
      return;
    }
    await this.site.generateFromAddress(q, this.genScale());
    this.library.set(this.libraryService.list());
  }

  protected setBearing(deg: number): void {
    this.ed.setBearing(deg);
    this.apply();
  }

  /** Adopt the Map panel's alignment rotation as the model's north bearing, then re-solve the GPS calibration. */
  protected pointNorth(): void {
    const rot = this.map.rotation();
    this.ed.commitSite((s) => {
      s.bearingDeg = ((rot % 360) + 360) % 360;
    });
    this.site.applyDraft();
    this.site.recalibrate();
    this.toast.show(`North set from the map alignment (${rot.toFixed(1)}°).`);
  }

  // ---- site-level draft edits ----

  protected rename(name: string): void {
    this.ed.setName(name);
    this.apply();
  }

  protected setGround(color: string): void {
    this.ed.commitSite((s) => {
      s.groundColor = color;
    });
    this.apply();
  }

  protected patch(patch: Partial<Pick<BuildingSpec, 'name' | 'rotDeg' | 'length' | 'width'>> & { pos?: BuildingSpec['pos'] }): void {
    this.ed.patchBuilding(patch);
    this.apply();
  }

  protected setHeight(h: number): void {
    this.editLevel((l) => {
      l.height = Math.max(1, h);
    });
  }

  protected setRoofRise(r: number): void {
    this.editLevel((l) => {
      l.roofRise = Math.max(0.2, r);
    });
  }

  protected setWall(side: Side, on: boolean): void {
    this.editLevel((l) => {
      l.sides[side] = on;
    });
  }

  protected setRoof(roof: LevelSpec['roof']): void {
    this.editLevel((l) => {
      l.roof = roof;
    });
  }

  private editLevel(fn: (l: LevelSpec) => void): void {
    this.ed.editSelectedLevel(fn, this.clampedLevel());
    this.apply();
  }

  // ---- openings ----

  protected setOpenSide(side: string): void {
    this.openSide.set(side as Side);
  }

  protected addOpening(kind: 'door' | 'window'): void {
    this.ed.addOpeningAt(this.openSide(), kind, this.clampedLevel());
    this.apply();
  }

  protected patchOpening(index: number, patch: Partial<{ kind: 'door' | 'window'; c: number; w: number; h: number }>): void {
    this.ed.patchOpeningAt(this.openSide(), this.clampedLevel(), index, patch);
    this.apply();
  }

  protected removeOpening(index: number): void {
    this.ed.removeOpeningAt(this.openSide(), this.clampedLevel(), index);
    this.apply();
  }

  protected sideName(s: Side): string {
    return { n: 'North', e: 'East', s: 'South', w: 'West' }[s];
  }

  // ---- partitions & trees ----

  protected togglePartition(): void {
    this.partitionMode.set(!this.partitionMode());
    this.treeMode.set(false);
  }

  protected toggleTree(): void {
    this.treeMode.set(!this.treeMode());
    this.partitionMode.set(false);
  }

  /**
   * A finished click on the 3D scene (sent by the Stage through SceneService when {@link picking} is on):
   * site-metre ground position -> drop a tree or run the two-click partition tool inside the selected building.
   */
  stageClick(x: number, z: number): void {
    if (this.treeMode()) {
      this.ed.addTree(x, z);
      this.apply();
      return;
    }
    if (!this.partitionMode()) return;
    const b = this.sel();
    const loc = b && pointInBuilding(b, x, z);
    if (!loc) {
      this.toast.show('Click inside the selected building’s footprint to draw a partition.');
      return;
    }
    if (!this.ed.partitionFrom()) this.ed.startPartition(loc.lx, loc.lz);
    else {
      this.ed.finishPartition(loc.lx, loc.lz);
      this.apply();
    }
  }

  protected popTree(): void {
    const n = this.ed.draft().trees.length;
    if (n) this.ed.removeTree(n - 1);
    this.apply();
  }

  // ---- library ----

  protected save(): void {
    this.site.saveDraft();
    this.library.set(this.libraryService.list());
  }

  protected remove(e: SiteEntry): void {
    this.libraryService.remove(e.id);
    this.library.set(this.libraryService.list());
  }

  protected exportJson(): void {
    const spec = this.ed.snapshot();
    this.download.save(`${spec.name.replace(/[^\w-]+/g, '_') || 'site'}.json`, this.libraryService.exportJson(spec), 'application/json');
  }

  protected importFile(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    void file.text().then((text) => {
      if (this.site.importJson(text)) this.library.set(this.libraryService.list());
    });
  }

  protected coords(e: SiteEntry): string {
    return `${e.origin.lat.toFixed(4)}, ${e.origin.lon.toFixed(4)}`;
  }

  // ---- plumbing ----

  /** Push the draft into the scene (live preview) without touching the camera. */
  private apply(): void {
    this.site.applyDraft();
  }

  private clampedLevel(): number {
    const n = this.sel()?.levels.length ?? 0;
    return Math.min(this.level(), Math.max(0, n - 1));
  }

  /** World→site: intersect the main camera ray with y=0, undo the model scale. Used by the stage click handler. */
  private groundPoint(e: PointerEvent): { x: number; z: number } | null {
    const host = this.scene.host;
    if (!host) return null;
    const rect = host.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, host.mainCamera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null;
    const k = this.cal.modelScale() || 1;
    return { x: hit.x / k, z: hit.z / k };
  }

  // ---- 2D plan preview ----

  private lastPlanKey = '';

  private drawPlan(): void {
    const el = this.planEl();
    const b = this.sel();
    if (!el || !b) return;
    const cv = el.nativeElement;
    const key = `${b.id}|${JSON.stringify([b.length, b.width, this.clampedLevel(), this.rooms(), this.ed.partitionFrom()])}`;
    if (key === this.lastPlanKey && cv.clientWidth > 0) return;
    this.lastPlanKey = key;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || 300, h = cv.clientHeight || 170;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const m = 14;
    const s = Math.min((w - 2 * m) / b.length, (h - 2 * m) / b.width);
    const ox = (w - b.length * s) / 2, oz = (h - b.width * s) / 2;
    const px = (lx: number): number => ox + lx * s;
    const pz = (lz: number): number => oz + lz * s;
    ctx.strokeStyle = '#7d9c86';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px(0), pz(0), b.length * s, b.width * s);
    const l = b.levels[this.clampedLevel()];
    if (l) {
      ctx.strokeStyle = '#e8e4d8';
      for (const [a, c] of l.partitions) {
        ctx.beginPath();
        ctx.moveTo(px(a.x), pz(a.z));
        ctx.lineTo(px(c.x), pz(c.z));
        ctx.stroke();
      }
      const pending = this.ed.partitionFrom();
      if (pending) {
        ctx.strokeStyle = '#ffd166';
        ctx.beginPath();
        ctx.arc(px(pending.x), pz(pending.z), 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#aab9af';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(`${b.length.toFixed(1)} × ${b.width.toFixed(1)} m`, px(0), pz(0) - 4);
  }

  /** Plan clicks also work for the partition tool (building-local coordinates directly). */
  protected onPlanClick(e: MouseEvent): void {
    if (!this.partitionMode()) return;
    const cv = this.planEl()?.nativeElement;
    const b = this.sel();
    if (!cv || !b) return;
    const r = cv.getBoundingClientRect();
    const m = 14;
    const s = Math.min((r.width - 2 * m) / b.length, (r.height - 2 * m) / b.width);
    const ox = (r.width - b.length * s) / 2, oz = (r.height - b.width * s) / 2;
    const lx = (e.clientX - r.left - ox) / s, lz = (e.clientY - r.top - oz) / s;
    if (!this.ed.partitionFrom()) this.ed.startPartition(lx, lz);
    else {
      this.ed.finishPartition(lx, lz);
      this.apply();
    }
  }
}
