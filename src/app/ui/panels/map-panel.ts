import { AfterContentChecked, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import * as THREE from 'three';
import type { BuildingSpec, LevelSpec } from '../../core/site-spec';
import { pointInBuilding } from '../../core/site-spec';
import { createMeasureState, drawMeasure, measureClear, measureClick, measureMetres, type MeasureState } from '../../core/drawing/measure';
import { GeoService } from '../../services/geo.service';
import { DownloadService } from '../../services/download.service';
import { FrameLoopService, FrameOrder } from '../../services/frame-loop.service';
import { FlightService } from '../../services/flight.service';
import { SceneService } from '../../services/scene.service';
import { SiteLibraryService } from '../../services/site-library.service';
import { SiteService } from '../../services/site.service';
import { ToastService } from '../../services/toast.service';
import { CalibrationStore } from '../../state/calibration.store';
import { LayoutStore } from '../../state/layout.store';
import { MapStore, type MapBackground } from '../../state/map.store';
import { fitResolution } from '../../three/scene-host';
import { toGeo, toLocal } from '../../core/geo';
import { checkedFrom, numberFrom, selectedFrom, textFrom } from '../dom';
import { Panel } from '../panel/panel';

type Side = 'n' | 's' | 'e' | 'w';
const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];

/** What a click on the live map + model does. */
type MapTool = 'none' | 'align' | 'select' | 'partition' | 'tree' | 'measure';

const NOTES: Record<'live' | 'none', string> = {
  live: 'Live OpenStreetMap of the active site with the 3D model on top. Tick “align” and drag (move), wheel (scale) or Shift+wheel (rotate) until the model lines up with the map — “Point north” bakes the rotation into the model. Click the model to select a building and edit it below. Needs the page served over http(s); some hosts block embedded sites.',
  none: '3D model only (north up). Click a building to select it and edit exterior + interiors below.',
};
const OVERLAY_MAX_PIXELS = 800_000;

/**
 * The Map panel: the merged "Map · OpenStreetMap builder" + "Sites · 3D map builder". The live OSM / satellite
 * backdrop of the *active* site with the 3D model rendered on top; clicking a building selects it and opens the
 * editor (exterior + interiors) right here. Tools over the model: align (drag/wheel), select, draw partitions,
 * plant trees and measure (point A → point B). GPS alignment lives here too (the old standalone Alignment panel was
 * folded in): shift X/Z + rot° and ↺90 / ↻90 / 180 nudge the calibration logged flights are projected through, and
 * "Calibrate corners" solves everything at once from two landmarks picked directly on the map.
 */
@Component({
  selector: 'app-map-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Panel, FormsModule],
  template: `
    <app-panel id="map">
      <div class="row wrap">
        <select (change)="setBackground(bg($event))">
          <option value="osm" [selected]="map.background() === 'osm'">OpenStreetMap</option>
          <option value="sat" [selected]="map.background() === 'sat'">Satellite (aerial)</option>
          <option value="none" [selected]="map.background() === 'none'">3D only</option>
        </select>
        <label class="sl tight">opacity
          <input type="range" class="mini" min="0" max="100" [value]="map.overlayOpacity() * 100" (input)="map.setOverlayOpacity(num($event) / 100)" />
        </label>
        <label class="check"><input type="checkbox" [checked]="tool() === 'align'" (change)="setTool(tool() === 'align' ? 'none' : 'align')" /> align</label>
        <span class="dim small mono" title="The live map follows the active site's location">{{ originLabel() }}</span>
      </div>

      <div class="row"><span class="dim small">Create, open or regenerate bandos in the <b>Bandos</b> panel. This panel edits the open model.</span></div>

      <!-- Model ↔ map alignment: three sliders per row -->
      <h4>Model ↔ map</h4>
      <div class="grid">
        <label class="sl">scale m/px
          <input type="range" min="0.05" max="2" step="0.01" [value]="scale()" (input)="map.setScale(num($event))" />
          <input class="tiny" type="number" step="0.005" min="0.01" [value]="scale()" (change)="map.setScale(num($event))" />
        </label>
        <label class="sl">rot°
          <input type="range" min="-180" max="180" step="0.5" [value]="map.rotation()" (input)="map.setRotation(num($event))" />
          <input class="tiny" type="number" step="0.5" [value]="map.rotation()" (change)="map.setRotation(num($event))" />
        </label>
        <label class="sl">shift X
          <input type="range" min="-300" max="300" step="1" [value]="map.dx()" (input)="map.setOffset(num($event), map.dz())" />
          <input class="tiny" type="number" step="1" [value]="map.dx().toFixed(1)" (change)="map.setOffset(num($event), map.dz())" />
        </label>
        <label class="sl">shift Z
          <input type="range" min="-300" max="300" step="1" [value]="map.dz()" (input)="map.setOffset(map.dx(), num($event))" />
          <input class="tiny" type="number" step="1" [value]="map.dz().toFixed(1)" (change)="map.setOffset(map.dx(), num($event))" />
        </label>
        <label class="sl">model ×
          <input type="range" min="0.3" max="3" step="0.05" [value]="cal.modelScale()" (input)="cal.setModelScale(num($event))" />
          <input class="tiny" type="number" step="0.05" [value]="cal.modelScale().toFixed(2)" (change)="cal.setModelScale(num($event))" />
        </label>
      </div>
      <div class="row">
        <button class="btn" (click)="map.resetAlignment()">Reset</button>
        <button class="btn" (click)="pointNorth()" title="Rotate the model so its front faces north on the map">Point north</button>
      </div>

      <!-- Tools over the live model -->
      <h4>Tools · click on the map</h4>
      <div class="row wrap">
        <button class="btn" [class.on]="tool() === 'select'" (click)="setTool(tool() === 'select' ? 'none' : 'select')" title="Click a building to select it and open the editor below">Select</button>
        <button class="btn" [class.on]="tool() === 'partition'" (click)="setTool(tool() === 'partition' ? 'none' : 'partition')" title="Click twice inside the selected building: wall start → wall end">Draw partition</button>
        <button class="btn" [class.on]="tool() === 'tree'" (click)="setTool(tool() === 'tree' ? 'none' : 'tree')" title="Click the ground to plant a tree">Tree</button>
        <button class="btn" [class.on]="tool() === 'measure'" (click)="setTool(tool() === 'measure' ? 'none' : 'measure')" title="Click point A, then point B: shows the real-world distance">Measure</button>
        <button class="btn" (click)="clearMeasure()" title="Erase the measuring line">⌫</button>
      </div>
      <div class="row wrap">
        <button class="btn" [class.on]="pinStart()" (click)="armPin('s')" [disabled]="!hasPath()" title="Needs a loaded flight path: click the ground where the flight started">Pin start</button>
        <button class="btn" [class.on]="pinEnd()" (click)="armPin('e')" [disabled]="!hasPath()" title="Needs a loaded flight path: click the ground where the flight ended">Pin end</button>
        <span class="dim small">{{ hasPath() ? 'then click the model / ground in the map above' : 'load a flight log to enable pinning' }}</span>
      </div>
      @if (tool() === 'measure') {
        <div class="dim small mono">{{ measureCaption() }}</div>
      }

      <!-- Live map + model -->
      <div class="keep stage" #stage>
        @if (live()) {
          <iframe title="Live map" referrerpolicy="no-referrer" allowfullscreen [src]="frameUrl()"></iframe>
        }
        <canvas
          #overlay
          [style.opacity]="map.background() === 'none' ? 1 : map.overlayOpacity()"
          [style.pointerEvents]="interactive() ? 'auto' : 'none'"
          [style.cursor]="cursor()"
          (pointerdown)="onDown($event)"
          (pointermove)="onMove($event)"
          (pointerup)="onUp($event)"
          (pointercancel)="onUp($event)"
          (wheel)="onWheel($event)"
        ></canvas>
      </div>
      <div class="dim small note">{{ note() }}</div>

      <!-- GPS alignment (from the old Alignment panel): the calibration the logged flights are projected through -->
      <h4>GPS alignment</h4>
      <div class="grid">
        <label class="sl">shift X
          <input type="range" min="-500" max="500" step="1" [value]="cal.dx()" (input)="setRotPivot(num($event), cal.dz(), cal.rot())" />
          <input class="tiny" type="number" step="1" [value]="cal.dx().toFixed(1)" (change)="setRotPivot(num($event), cal.dz(), cal.rot())" />
        </label>
        <label class="sl">shift Z
          <input type="range" min="-500" max="500" step="1" [value]="cal.dz()" (input)="setRotPivot(cal.dx(), num($event), cal.rot())" />
          <input class="tiny" type="number" step="1" [value]="cal.dz().toFixed(1)" (change)="setRotPivot(cal.dx(), num($event), cal.rot())" />
        </label>
        <label class="sl">rot°
          <input type="range" min="-180" max="180" step="0.5" [value]="cal.rot()" (input)="setRotation(num($event))" />
          <input class="tiny" type="number" step="0.5" [value]="cal.rot().toFixed(1)" (change)="setRotation(num($event))" />
        </label>
      </div>
      <div class="row wrap">
        <button class="btn" (click)="rotateBy(-90)">↺ 90°</button>
        <button class="btn" (click)="rotateBy(90)">↻ 90°</button>
        <button class="btn" (click)="rotateBy(180)">180°</button>
        <button class="btn" [class.on]="cornerPick() !== null" (click)="toggleCornerPick()" title="Click two real landmarks on the map — opposite corners of the model: solves rotation + shift in one shot">Calibrate corners</button>
      </div>
      @if (cornerPick() !== null) {
        <div class="dim small mono">{{ cornerCaption() }}</div>
      }
      <div class="dim small">
        “Calibrate corners”: pick A and B directly on the map above — they must be the same two opposite corners of the model. Solves rotation + shift in one
        shot. “Shift model size by ratio” then scales the buildings so the model matches the real distance between A and B.
      </div>
      <div class="row">
        <button class="btn" (click)="applyRatio()" [disabled]="!lastRatio">Shift model size by ratio</button>
        <span class="dim small mono">{{ ratioHint() }}</span>
      </div>

      <!-- Site & library (merged from the old Sites · 3D map builder panel) -->
      <h4>Site · library</h4>
      <div class="row">
        <input type="text" class="grow" [value]="ed.draft().name" (change)="rename(text($event))" />
        <button class="btn" [disabled]="!ed.canUndo()" (click)="ed.undo()" title="Undo">↶</button>
        <button class="btn" [disabled]="!ed.canRedo()" (click)="ed.redo()" title="Redo">↷</button>
      </div>
      <div class="row wrap">
        <button class="btn" (click)="save()">Save</button>
        <button class="btn" (click)="exportJson()">Export JSON</button>
        <label class="btn">Import<input type="file" accept=".json,application/json" hidden (change)="importFile($event)" /></label>
        <button class="btn" (click)="site.newBlank()" title="Start a blank model at the current map location">New blank</button>
        <label>ground <input type="color" [value]="ed.draft().groundColor" (change)="setGround(color($event))" /></label>
      </div>
      <div class="row wrap">
        <button class="btn" [disabled]="!site.active().trees.length" (click)="popTree()">− Last tree</button>
        <span class="dim small mono">{{ site.active().trees.length }} trees · Source: {{ geo.attribution }}</span>
      </div>

      <!-- Building editor: exterior + interiors of the selected building -->
      <h4>Building · exterior & interiors</h4>
      <div class="row wrap">
        @for (b of ed.draft().buildings; track b.id) {
          <button class="btn" [class.on]="ed.selectedId() === b.id" (click)="ed.select(b.id)">{{ b.name }}</button>
        }
        <button class="btn" (click)="addBuilding()">＋ Add</button>
      </div>
      @if (sel(); as b) {
        <div class="row">
          <label class="grow">name <input type="text" class="grow" [value]="b.name" (change)="patch({ name: text($event) })" /></label>
          <button class="btn" (click)="ed.duplicateSelected()" title="Duplicate">⧉</button>
          <button class="btn danger" (click)="ed.removeBuilding(b.id)">Delete</button>
        </div>
        <div class="row wrap">
          <label>x <input type="number" step="1" [value]="b.pos.x.toFixed(1)" (change)="patch({ pos: { x: num($event), z: b.pos.z } })" /></label>
          <label>z <input type="number" step="1" [value]="b.pos.z.toFixed(1)" (change)="patch({ pos: { x: b.pos.x, z: num($event) } })" /></label>
          <label>rot° <input type="number" step="5" [value]="b.rotDeg" (change)="patch({ rotDeg: num($event) })" /></label>
        </div>
        <div class="row wrap">
          <label>length <input type="number" min="2" step="0.5" [value]="b.length" (change)="patch({ length: num($event) })" /></label>
          <label>width <input type="number" min="2" step="0.5" [value]="b.width" (change)="patch({ width: num($event) })" /></label>
          @if (!b.frame) {
            <label>height <input type="number" min="1" step="0.5" [value]="lvl()?.height ?? 0" (change)="setHeight(num($event))" /></label>
          }
        </div>

        @if (!b.frame) {
          <!-- levels -->
          <div class="row wrap">
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
            <div class="row wrap">
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
            <div class="row wrap">
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
                  <div class="row wrap">
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
            <div class="row wrap">
              <button class="btn" (click)="ed.guessInterior()" title="Split into four rooms as a starting point">Guess interior</button>
              <button class="btn" [class.on]="tool() === 'partition'" (click)="setTool(tool() === 'partition' ? 'none' : 'partition')" title="Click twice on the plan or the map: wall start → wall end">Draw partition</button>
              <span class="dim small mono">{{ rooms().length }} rooms · {{ l.partitions.length }} walls</span>
            </div>

            <!-- 2D plan: footprint, partitions, click to draw -->
            <canvas
              #plan
              class="plan keep"
              [title]="tool() === 'partition' ? 'Click: first endpoint, then second' : 'Footprint of ' + b.name"
              (click)="onPlanClick($event)"
            ></canvas>
          }
        } @else {
          <div class="dim small">Greenhouse frame — walls and roof are fixed.</div>
        }
      } @else {
        <div class="dim small">Select a building above, click one on the map, or add one.</div>
      }
    </app-panel>
  `,
  styles: `
    .stage {
      position: relative;
      flex: none;
      width: 100%;
      aspect-ratio: 4 / 3;
      max-height: 62vh;
      overflow: hidden;
      background: #0a0f0c;
      border-radius: 6px;
      touch-action: none;
    }
    .stage > * {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
    iframe {
      border: 0;
    }
    h4 {
      margin: 8px 0 2px;
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--dim);
    }
    .note {
      margin-top: 4px;
    }
    .grid {
      display: grid;
      /* three sliders per row */
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 4px 10px;
      margin: 4px 0;
    }
    .sl {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--dim);
      white-space: nowrap;
      min-width: 0;
    }
    .sl input[type='range'] {
      flex: 1;
      min-width: 40px;
    }
    .sl.mini input[type='range'],
    .sl input[type='range'].mini {
      flex: none;
      width: 70px;
    }
    .tiny {
      width: 52px;
      flex: none;
      min-width: 0;
    }
    .lib {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin: 4px 0;
    }
    .entry {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 4px;
      border: 1px solid var(--line, #333);
      background: transparent;
      color: inherit;
      cursor: pointer;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .entry.active {
      outline: 1px solid var(--accent, #7c9);
    }
    .wrap {
      flex-wrap: wrap;
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
    .plan {
      width: 100%;
      height: 150px;
      background: #0a0f0c;
      border: 1px solid var(--line);
      border-radius: 6px;
      touch-action: none;
      cursor: crosshair;
    }
  `,
})
export class MapPanel implements AfterContentChecked {
  protected readonly map = inject(MapStore);
  protected readonly cal = inject(CalibrationStore);
  protected readonly scene = inject(SceneService);
  private readonly flights = inject(FlightService);
  protected readonly site = inject(SiteService);
  /** The editor draft behind the merged Sites section (buildings, levels, openings, partitions). */
  protected readonly ed = this.site.editor;
  private readonly lib = inject(SiteLibraryService);
  private readonly layout = inject(LayoutStore);
  private readonly toast = inject(ToastService);
  private readonly loop = inject(FrameLoopService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly geo = inject(GeoService);
  private readonly download = inject(DownloadService);

  private readonly overlay = viewChild.required<ElementRef<HTMLCanvasElement>>('overlay');
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly planEl = viewChild<ElementRef<HTMLCanvasElement>>('plan');
  protected readonly live = computed(() => this.map.background() !== 'none');
  protected readonly frameUrl = computed<SafeResourceUrl>(() => this.sanitizer.bypassSecurityTrustResourceUrl(this.map.osmUrl()));
  protected readonly note = signal(NOTES.live);
  // ---- location · generate (moved here from the Sites panel: search -> preview on map -> build the model from OSM) ----
  protected readonly activeId = computed(() => this.site.active().id);

  // ---- editor state (merged from the old Sites · 3D map builder panel) ----
  protected readonly level = signal(0);
  protected readonly openSide = signal<Side>('n');
  protected readonly sides = SIDES;
  /** The armed click-tool over the live map + model. */
  protected readonly tool = signal<MapTool>('none');
  /** Corner calibration picking: null = off, 'a'/'b' = waiting for that landmark click on the map. */
  protected readonly cornerPick = signal<'a' | 'b' | null>(null);
  /** The measuring instrument's two ends (CSS pixels inside the overlay canvas). */
  private readonly measure: MeasureState = createMeasureState();
  /** The last solved model/real distance ratio, applied by "Shift model size by ratio". */
  protected lastRatio: number | null = null;
  /** Two real landmarks picked on the map, matched to the model's calibration corners. */
  private pickA: { lat: number; lon: number } | null = null;
  private pickB: { lat: number; lon: number } | null = null;

  /** A flight path is loaded: the pin start / end buttons are enabled. */
  protected readonly hasPath = computed(() => !!this.flights.active);
  protected readonly pinStart = computed(() => this.scene.pin() === 's');
  protected readonly pinEnd = computed(() => this.scene.pin() === 'e');
  /** The selected building (the editor below edits its exterior + interiors). */
  protected readonly sel = computed(() => this.ed.building());
  protected readonly lvl = computed(() => this.sel()?.levels[this.clampedLevel()] ?? null);
  protected readonly openings = computed(() => this.lvl()?.doors[this.openSide()] ?? []);
  protected readonly rooms = computed(() => this.ed.rooms());

  /** The live OSM backdrop follows the *active* site, so show where it points. */
  protected readonly originLabel = computed(() => {
    const o = this.map.location();
    return `${o.lat.toFixed(5)}, ${o.lon.toFixed(5)}`;
  });
  protected readonly bg = (e: Event): MapBackground => selectedFrom(e) as MapBackground;
  protected readonly num = numberFrom;
  protected readonly checked = checkedFrom;
  protected readonly text = (e: Event): string => textFrom(e);
  protected readonly color = (e: Event): string => (e.target as HTMLInputElement).value;
  protected readonly selected = selectedFrom;
  protected readonly selectedKind = (e: Event): 'door' | 'window' => selectedFrom(e) as 'door' | 'window';
  protected readonly selectedRoof = (e: Event): LevelSpec['roof'] => selectedFrom(e) as LevelSpec['roof'];

  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 800);
  /** Last render parameters: metres per CSS pixel and the angle of screen-up, for the align drag. */
  private metresPerPixel = 0.1;
  private up = 0;
  private dirty = true;
  private frame = 0;
  /** The last click position (client coords) — used to place pins with the main camera when no overlay hit exists. */
  private lastClick: { x: number; y: number } | null = null;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private pendingWheel = false;

  constructor() {
    // reset the one-shot calibration picks whenever the active site changes
    effect(() => {
      this.site.active();
      this.pickA = null;
      this.pickB = null;
      this.cornerPick.set(null);
      this.lastRatio = null;
    });
    effect(() => {
      this.map.background();
      this.map.scale();
      this.map.rotation();
      this.map.dx();
      this.map.dz();
      this.cal.rot();
      this.cal.modelScale();
      this.site.active();
      this.ed.draft();
      this.tool();
      this.dirty = true;
    });
    effect(() => {
      this.note.set(this.map.background() === 'none' ? NOTES.none : NOTES.live);
    });
    // while a map tool or a ground pin is armed, this panel's surface owns the picking: clicks never edit through
    // the full-page scene behind it (see Stage / SceneService.pickSurface)
    effect(() => {
      const t = this.tool();
      const pin = this.scene.pin();
      const cp = this.cornerPick();
      const mine = t !== 'none' || pin !== null || cp !== null;
      this.scene.pickSurface.set(mine ? { id: 'map', onClick: (x, y) => this.onStagePickFromPage(x, y) } : null);
    });
    const stop = this.loop.add(FrameOrder.render + 1, () => this.render());
    this.destroyRef.onDestroy(stop);
    const onViolation = (e: SecurityPolicyViolationEvent): void => {
      if (/frame-src/.test(e.violatedDirective) && this.live()) this.note.set(`This host blocks embedded sites (${e.violatedDirective}). Serve the app over http(s) for the live map.`);
    };
    document.addEventListener('securitypolicyviolation', onViolation);
    this.destroyRef.onDestroy(() => document.removeEventListener('securitypolicyviolation', onViolation));
    afterNextRender(() => this.bindKeys());
  }

  /** Esc disarms the armed map tool / pin / corner pick (the overlay's own pointer events are bound in the template). */
  private bindKeys(): void {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (this.tool() === 'none' && this.scene.pin() === null && this.cornerPick() === null) return;
      this.tool.set('none');
      this.cornerPick.set(null);
      this.scene.pin.set(null);
      this.ed.partitionFrom.set(null);
      this.clearMeasure();
    };
    window.addEventListener('keydown', onKey);
    this.destroyRef.onDestroy(() => window.removeEventListener('keydown', onKey));
  }

  ngAfterContentChecked(): void {
    this.drawPlan();
  }

  protected scale(): number {
    return this.map.scale()[this.map.background()];
  }

  protected setBackground(b: MapBackground): void {
    this.map.setBackground(b);
  }

  // ---- tools over the live map + model ----

  /** Arm (or disarm) a click tool. Only one tool at a time; arming one drops the pin / corner picks. */
  protected setTool(t: MapTool): void {
    this.tool.set(this.tool() === t ? 'none' : t);
    if (this.tool() !== 'measure') this.clearMeasure();
    if (this.tool() !== 'partition') this.ed.partitionFrom.set(null);
    if (this.tool() !== 'align') this.cornerPick.set(null);
    if (this.tool() !== 'none') {
      this.scene.pin.set(null);
      this.toast.show(`Map tool: ${t}. Click on the map above (Esc disarms).`);
    }
  }

  /** True while the overlay should receive pointer events (a tool is armed or a pin is waiting). */
  protected interactive(): boolean {
    return this.tool() !== 'none' || this.scene.pin() !== null || this.cornerPick() !== null;
  }

  protected cursor(): string {
    const t = this.tool();
    if (t === 'align') return 'move';
    if (t === 'none') return this.scene.pin() || this.cornerPick() ? 'crosshair' : 'default';
    return 'crosshair';
  }

  protected measureCaption(): string {
    if (!this.measure.a) return 'Measure: click point A on the map';
    if (!this.measure.b) return 'Measure: click point B';
    return `Measure: A → B = ${measureMetres(this.measure, this.metresPerPixel).toFixed(1)} m`;
  }

  protected clearMeasure(): void {
    measureClear(this.measure);
    this.dirty = true;
  }

  /** Pin start / end: needs a loaded flight path; the next click on the map moves the flight there. */
  protected armPin(which: 's' | 'e'): void {
    if (!this.hasPath()) {
      this.toast.show('Load a flight log first.');
      return;
    }
    this.tool.set('none');
    this.scene.armPin(which);
  }

  protected toggleCornerPick(): void {
    const on = this.cornerPick() !== null;
    this.cornerPick.set(on ? null : 'a');
    if (!on) {
      this.pickA = null;
      this.pickB = null;
      this.lastRatio = null;
      this.tool.set('align'); // the overlay must receive the clicks
    } else {
      this.tool.set('none');
    }
  }

  protected cornerCaption(): string {
    if (this.cornerPick() === 'a') return 'Calibrate: click landmark A on the map (corner p1 of the model)';
    if (this.cornerPick() === 'b') return 'Calibrate: now click landmark B (the opposite corner p2)';
    return '';
  }

  /**
   * A finished click somewhere in the 3D world (from the page Stage, or from the overlay via {@link onDown}):
   * client coordinates -> site-metre ground point -> run the armed tool.
   */
  private onStagePick(clientX: number, clientY: number): void {
    const p = this.groundAt(clientX, clientY);
    if (!p) return;
    this.handlePick(p.x, p.z, clientX, clientY);
  }

  /** Screen point -> site-metre ground coordinates: the overlay's orthographic ray first, else the main camera. */
  private groundAt(clientX: number, clientY: number): { x: number; z: number } | null {
    const cv = this.overlay().nativeElement;
    const r = cv.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom && r.width > 40 && r.height > 40) {
      const nx = ((clientX - r.left) / r.width) * 2 - 1;
      const ny = -(((clientY - r.top) / r.height) * 2 - 1);
      const hit = new THREE.Vector3();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
      if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) {
        const k = this.cal.modelScale() || 1;
        return { x: hit.x / k, z: hit.z / k };
      }
    }
    const host = this.scene.host;
    if (!host) return null;
    const rect = host.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, host.mainCamera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null;
    const k = this.cal.modelScale() || 1;
    return { x: hit.x / k, z: hit.z / k };
  }

  /** Run the armed tool on a site-metre ground point. */
  private handlePick(x: number, z: number, clientX: number, clientY: number): void {
    const t = this.tool();
    if (this.cornerPick() !== null) {
      const k = this.cal.modelScale() || 1;
      const [lat, lon] = toGeo(x * k, z * k, this.cal.calibration());
      if (this.cornerPick() === 'a') {
        this.pickA = { lat, lon };
        this.cornerPick.set('b');
      } else {
        this.pickB = { lat, lon };
        this.cornerPick.set(null);
        this.tool.set('none');
        if (this.pickA) this.calibrateFromCorners(this.pickA, this.pickB);
      }
      this.dirty = true;
      return;
    }
    switch (t) {
      case 'select': {
        const b = this.site.active().buildings.find((bb) => pointInBuilding(bb, x, z));
        if (b) {
          this.ed.select(b.id);
          this.level.set(0);
          this.applyDraft();
          this.toast.show(`Selected “${b.name}” — edit it below.`);
        } else this.toast.show('Click on a building to select it.');
        break;
      }
      case 'partition': {
        const b = this.sel();
        const loc = b && pointInBuilding(b, x, z);
        if (!loc) {
          this.toast.show('Click inside the selected building’s footprint to draw a partition.');
          break;
        }
        if (!this.ed.partitionFrom()) this.ed.startPartition(loc.lx, loc.lz);
        else {
          this.ed.finishPartition(loc.lx, loc.lz);
          this.applyDraft();
        }
        this.dirty = true;
        break;
      }
      case 'tree':
        this.ed.addTree(x, z);
        this.applyDraft();
        break;
      case 'measure': {
        const cv = this.overlay().nativeElement;
        const r = cv.getBoundingClientRect();
        measureClick(this.measure, clientX - r.left, clientY - r.top);
        this.dirty = true;
        break;
      }
      default:
        break;
    }
  }

  // ---- GPS alignment (integrated from the old Alignment panel) ----

  /** Set the rotation, pivoting the active flight about its own midpoint so it does not swing away. */
  protected setRotation(deg: number): void {
    const rot = (((deg + 540) % 360) + 360) % 360 - 180;
    const mid = this.flights.active?.pts[(this.flights.active.pts.length / 2) | 0];
    const before = mid ? toLocal(mid.lat, mid.lon, this.cal.calibration()) : null;
    this.cal.setRot(rot);
    if (mid && before) {
      const after = toLocal(mid.lat, mid.lon, this.cal.calibration());
      this.cal.shift(before[0] - after[0], before[1] - after[1]);
    }
  }

  protected setRotPivot(dx: number, dz: number, rot: number): void {
    this.cal.setDx(dx);
    this.cal.setDz(dz);
    if (rot !== this.cal.rot()) this.setRotation(rot);
  }

  protected rotateBy(deg: number): void {
    this.setRotation(this.cal.rot() + deg);
  }

  /** Solve rotation + shift from two real corners matched to the active spec's model corners. */
  protected calibrateFromCorners(a: { lat: number; lon: number }, b: { lat: number; lon: number }): void {
    if (!this.site.calibrateFromCorners(a, b)) return;
    const r = this.site.lastCalibrationRatio();
    this.lastRatio = r;
    this.toast.show(`Calibrated: rotation ${this.cal.rot().toFixed(2)}°, shift ${this.cal.dx().toFixed(1)} / ${this.cal.dz().toFixed(1)} m${r ? ` · model/real distance ${r.toFixed(3)} — press “Shift model size by ratio” to resize the model` : ''}`);
  }

  /** Resize the model so it matches the real distance between the calibrated corners. */
  protected applyRatio(): void {
    if (!this.lastRatio || !isFinite(this.lastRatio) || Math.abs(this.lastRatio - 1) < 0.002) {
      this.toast.show('Calibrate from two corners first');
      return;
    }
    this.cal.setModelScale(this.cal.modelScale() / this.lastRatio);
    this.toast.show(`Model scaled × ${(1 / this.lastRatio).toFixed(3)}.`);
  }

  protected ratioHint(): string {
    return this.lastRatio ? `ratio ${this.lastRatio.toFixed(3)}` : '—';
  }

  // ---- location · generate ----

  /** Adopt the map alignment rotation as the model's north bearing, then re-solve the GPS calibration. */
  protected pointNorth(): void {
    const rot = this.map.rotation();
    this.site.editor.commitSite((sp) => {
      sp.bearingDeg = ((rot % 360) + 360) % 360;
    });
    this.site.applyDraft();
    this.site.recalibrate();
    this.toast.show(`North set from the map alignment (${rot.toFixed(1)}°).`);
  }

  /** Aim the orthographic camera at the model so it lines up with whatever is behind it, then render into the overlay. */
  private render(): void {
    const p = this.layout.panels()['map'];
    if (!p.visible || p.minimized || !this.scene.host) return;
    const st = this.stage().nativeElement;
    const w = st.clientWidth, h = st.clientHeight;
    if (w < 40 || h < 40) return;
    if (!this.dirty && this.frame++ % 3 !== 0) return;
    this.dirty = false;
    const A = (this.cal.rot() * Math.PI) / 180;
    const bg = this.map.background();
    const mpp = this.map.scale()[bg];
    const cx = this.map.dx();
    const cz = this.map.dz();
    const up = A + (this.map.rotation() * Math.PI) / 180;
    this.metresPerPixel = mpp;
    this.up = up;
    const cam = this.camera;
    cam.left = (-w * mpp) / 2;
    cam.right = (w * mpp) / 2;
    cam.top = (h * mpp) / 2;
    cam.bottom = (-h * mpp) / 2;
    cam.updateProjectionMatrix();
    cam.up.set(Math.sin(up), 0, -Math.cos(up));
    cam.position.set(cx, 300, cz);
    cam.lookAt(cx, 0, cz);
    this.scene.renderOverlay(cam, this.overlay().nativeElement, w, h, OVERLAY_MAX_PIXELS);
    // the measuring instrument paints over the freshly rendered overlay
    if (this.measure.a || this.measure.b) drawMeasure(this.overlay().nativeElement, this.measure, w, h, mpp);
  }

  // ---- overlay pointer handling: align drag / wheel, tool clicks, pins ----

  protected onDown(e: PointerEvent): void {
    this.lastClick = { x: e.clientX, y: e.clientY };
    if (this.tool() === 'align') {
      this.drag = { x: e.clientX, y: e.clientY, moved: false };
      this.overlay().nativeElement.setPointerCapture(e.pointerId);
    }
  }

  protected onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
    if (!d.moved) return;
    d.x = e.clientX;
    d.y = e.clientY;
    const u = this.up, m = this.metresPerPixel;
    const right = [Math.cos(u), Math.sin(u)] as const;
    const upv = [Math.sin(u), -Math.cos(u)] as const;
    this.map.nudge(-dx * m * right[0] + dy * m * upv[0], -dx * m * right[1] + dy * m * upv[1]);
  }

  protected onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    // a click (no drag) runs the armed tool; corner picking works even without moving first
    if (this.tool() === 'align' && d && d.moved) return;
    this.handlePickClient(e.clientX, e.clientY);
  }

  protected onWheel(e: WheelEvent): void {
    if (this.tool() !== 'align') return;
    e.preventDefault();
    // throttle to one step per frame — trackpads fire dozens of tiny deltas
    if (this.pendingWheel) return;
    this.pendingWheel = true;
    requestAnimationFrame(() => {
      this.pendingWheel = false;
      if (e.shiftKey) this.map.setRotation(this.map.rotation() + (e.deltaY > 0 ? 1 : -1));
      else this.map.scaleBy(1 + e.deltaY * 0.001);
    });
  }

  /** A finished click inside the overlay canvas: pin placement or the armed tool. */
  private handlePickClient(clientX: number, clientY: number): void {
    const pin = this.scene.pin();
    if (pin) {
      const host = this.scene.host;
      if (host) {
        const rect = host.canvas.getBoundingClientRect();
        this.scene.placePin(clientX, clientY, host.mainCamera, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      }
      return;
    }
    if (this.tool() === 'none') return;
    this.onStagePick(clientX, clientY);
  }

  /** The page Stage routes its clicks here while a map tool / pin is armed (see SceneService.pickSurface). */
  private onStagePickFromPage(clientX: number, clientY: number): void {
    const pin = this.scene.pin();
    if (pin) {
      const host = this.scene.host;
      if (host) {
        const rect = host.canvas.getBoundingClientRect();
        this.scene.placePin(clientX, clientY, host.mainCamera, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      }
      return;
    }
    this.onStagePick(clientX, clientY);
  }

  // ---- editor plumbing (merged from the old Sites · 3D map builder panel) ----

  /** Push the draft into the scene (live preview) without touching the camera. */
  private applyDraft(): void {
    this.site.applyDraft();
  }

  private clampedLevel(): number {
    const n = this.sel()?.levels.length ?? 0;
    return Math.min(this.level(), Math.max(0, n - 1));
  }

  protected rename(name: string): void {
    this.ed.setName(name);
    this.applyDraft();
  }

  protected setGround(color: string): void {
    this.ed.commitSite((s) => {
      s.groundColor = color;
    });
    this.applyDraft();
  }

  protected addBuilding(): void {
    this.ed.addBuilding();
    this.level.set(0);
    this.applyDraft();
  }

  protected patch(patch: Partial<Pick<BuildingSpec, 'name' | 'rotDeg' | 'length' | 'width'>> & { pos?: BuildingSpec['pos'] }): void {
    this.ed.patchBuilding(patch);
    this.applyDraft();
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
    this.applyDraft();
  }

  // ---- openings ----

  protected setOpenSide(side: string): void {
    this.openSide.set(side as Side);
  }

  protected addOpening(kind: 'door' | 'window'): void {
    this.ed.addOpeningAt(this.openSide(), kind, this.clampedLevel());
    this.applyDraft();
  }

  protected patchOpening(index: number, patch: Partial<{ kind: 'door' | 'window'; c: number; w: number; h: number }>): void {
    this.ed.patchOpeningAt(this.openSide(), this.clampedLevel(), index, patch);
    this.applyDraft();
  }

  protected removeOpening(index: number): void {
    this.ed.removeOpeningAt(this.openSide(), this.clampedLevel(), index);
    this.applyDraft();
  }

  protected sideName(s: Side): string {
    return { n: 'North', e: 'East', s: 'South', w: 'West' }[s];
  }

  // ---- trees & library ----

  protected popTree(): void {
    const n = this.ed.draft().trees.length;
    if (n) this.ed.removeTree(n - 1);
    this.applyDraft();
  }

  protected save(): void {
    this.site.saveDraft();
  }

  protected exportJson(): void {
    const spec = this.ed.snapshot();
    this.download.save(`${spec.name.replace(/[^\w-]+/g, '_') || 'site'}.json`, this.lib.exportJson(spec), 'application/json');
  }

  protected importFile(e: Event): void {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    void file.text().then((text) => this.site.importJson(text));
  }

  // ---- 2D plan preview (footprint + partitions, click to draw) ----

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
    const w = cv.clientWidth || 300, h = cv.clientHeight || 150;
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

  /** Plan clicks also run the partition tool (building-local coordinates directly). */
  protected onPlanClick(e: MouseEvent): void {
    if (this.tool() !== 'partition') return;
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
      this.applyDraft();
    }
    this.dirty = true;
  }
}
