import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import type { BuildingSpec, LevelSpec, OpeningSpec } from '../../core/site-spec';
import { SiteService } from '../../services/site.service';
import { ViewStore } from '../../state/view.store';
import { checkedFrom, numberFrom, selectedFrom, textFrom } from '../dom';
import { Panel } from '../panel/panel';

type Side = 'n' | 's' | 'e' | 'w';
type Tool = 'select' | 'building' | 'tree' | 'door' | 'window' | 'wall';
type Pick =
  | { t: 'building' }
  | { t: 'tree'; i: number }
  | { t: 'opening'; side: Side; i: number }
  | { t: 'wall'; i: number }
  | null;
type Drag =
  | { t: 'pan'; sx: number; sy: number; cx: number; cz: number }
  | { t: 'move'; ox: number; oz: number; px: number; pz: number }
  | { t: 'resize'; sx: number; sz: number; ax: number; az: number }
  | { t: 'rotate' }
  | { t: 'tree'; i: number; dx: number; dz: number }
  | { t: 'open'; side: Side; i: number }
  | { t: 'openEnd'; side: Side; i: number; end: 0 | 1 }
  | { t: 'draw'; x0: number; z0: number; x1: number; z1: number }
  | { t: 'wallDraw'; a: { x: number; z: number }; b: { x: number; z: number } };

const SIDES: readonly Side[] = ['n', 's', 'e', 'w'];
const snap = (v: number, step: number): number => Math.round(v / step) * step;

/**
 * The plan editor: a top-down 2D view of the whole bando where everything is drawn and edited with the mouse.
 * Buildings (move, resize from the corners, rotate from the top handle), trees (drag, add), and — through "Edit
 * indoors", which also takes the roof off in 3D — interior walls, doors and windows (click a wall to add one, drag it
 * along the wall, drag its ends to resize). Pan with the background, zoom with the wheel. Every change updates the
 * 3D model when the mouse is released; one drag is one undo step.
 */
@Component({
  selector: 'app-plan-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Panel],
  template: `
    <app-panel id="plan">
      <div class="bar">
        @for (t of tools; track t.id) {
          <button class="btn" [class.on]="tool() === t.id" (click)="setTool(t.id)" [title]="t.hint">{{ t.label }}</button>
        }
        <span class="sp"></span>
        <button class="btn" [class.on]="indoor()" [disabled]="!b()" (click)="toggleIndoor()" title="Take the roof off and edit walls, doors and windows inside the selected building">{{ indoor() ? '✓ Indoors' : 'Edit indoors' }}</button>
        <button class="btn" [disabled]="!ed.canUndo()" (click)="undo()" title="Undo">↶</button>
        <button class="btn" [disabled]="!ed.canRedo()" (click)="redo()" title="Redo">↷</button>
        <button class="btn" (click)="fit()" title="Fit everything in view">⤢</button>
        <button class="btn primary" (click)="site.saveDraft()" title="Save this bando to the library">Save</button>
      </div>
      <div class="hint dim small">{{ hint() }}</div>

      <div class="view keep" #view>
        <svg
          #svg
          [attr.viewBox]="vb()"
          preserveAspectRatio="none"
          tabindex="0"
          (pointerdown)="bgDown($event)"
          (pointermove)="move($event)"
          (pointerup)="up($event)"
          (pointercancel)="up($event)"
          (wheel)="wheel($event)"
          (keydown)="key($event)"
        >
          <rect [attr.x]="-ext()" [attr.y]="-ext()" [attr.width]="ext() * 2" [attr.height]="ext() * 2" [attr.fill]="ed.draft().groundColor" opacity="0.55" />
          @for (p of ed.draft().pads; track $index) {
            <rect [attr.x]="p.x - p.w / 2" [attr.y]="p.z - p.d / 2" [attr.width]="p.w" [attr.height]="p.d" [attr.fill]="p.color ?? '#888'" opacity="0.8" pointer-events="none" />
          }
          @for (t of ed.draft().trees; track $index) {
            <circle [attr.cx]="t.x" [attr.cy]="t.z" [attr.r]="t.r" [attr.fill]="t.kind === 'c' ? '#2f6b3c' : '#4f9a4a'" [attr.stroke]="pick()?.t === 'tree' && treeI() === $index ? '#ffd166' : '#1d3d22'" stroke-width="1.5" vector-effect="non-scaling-stroke" (pointerdown)="treeDown($event, $index)" />
          }
          @for (bd of ed.draft().buildings; track bd.id) {
            <g [attr.transform]="tf(bd)" [attr.opacity]="indoor() && bd.id !== ed.selectedId() ? 0.35 : 1">
              <rect [attr.x]="-bd.length / 2" [attr.y]="-bd.width / 2" [attr.width]="bd.length" [attr.height]="bd.width" [attr.fill]="bd.color ?? '#d7d0bd'" [attr.fill-opacity]="indoor() && bd.id === ed.selectedId() ? 0.25 : 1" [attr.stroke]="bd.id === ed.selectedId() ? '#b7ed83' : '#3a4a41'" [attr.stroke-width]="bd.id === ed.selectedId() ? 3 : 1.5" vector-effect="non-scaling-stroke" (pointerdown)="bldDown($event, bd)" />
              @if (!indoor() || bd.id !== ed.selectedId()) {
                <text [attr.x]="0" [attr.y]="0" text-anchor="middle" dominant-baseline="middle" [attr.font-size]="Math.min(3, bd.width / 4)" fill="#222" pointer-events="none">{{ bd.name }}</text>
              }
            </g>
          }
          @if (b(); as bd) {
            <g [attr.transform]="tf(bd)">
              @if (indoor()) {
                @for (pt of lvl()?.partitions ?? []; track $index) {
                  <line [attr.x1]="pt[0].x - bd.length / 2" [attr.y1]="pt[0].z - bd.width / 2" [attr.x2]="pt[1].x - bd.length / 2" [attr.y2]="pt[1].z - bd.width / 2" [attr.stroke]="pick()?.t === 'wall' && wallI() === $index ? '#ffd166' : '#e8efe9'" stroke-width="5" stroke-linecap="round" vector-effect="non-scaling-stroke" (pointerdown)="wallDown($event, $index)" />
                }
                @if (drag()?.t === 'wallDraw') {
                  <line [attr.x1]="wd().a.x - bd.length / 2" [attr.y1]="wd().a.z - bd.width / 2" [attr.x2]="wd().b.x - bd.length / 2" [attr.y2]="wd().b.z - bd.width / 2" stroke="#ffd166" stroke-width="4" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" pointer-events="none" />
                }
              }
              @for (o of openingsOf(bd); track o.key) {
                <line [attr.x1]="o.x1" [attr.y1]="o.y1" [attr.x2]="o.x2" [attr.y2]="o.y2" [attr.stroke]="o.kind === 'door' ? '#ff9a2e' : '#4fc3f7'" [attr.stroke-width]="isOpen(o.side, o.i) ? 10 : 7" stroke-linecap="butt" vector-effect="non-scaling-stroke" (pointerdown)="openDown($event, o.side, o.i)" />
                @if (isOpen(o.side, o.i)) {
                  <circle [attr.cx]="o.x1" [attr.cy]="o.y1" [attr.r]="hr()" fill="#fff" stroke="#12200b" vector-effect="non-scaling-stroke" (pointerdown)="openEndDown($event, o.side, o.i, 0)" />
                  <circle [attr.cx]="o.x2" [attr.cy]="o.y2" [attr.r]="hr()" fill="#fff" stroke="#12200b" vector-effect="non-scaling-stroke" (pointerdown)="openEndDown($event, o.side, o.i, 1)" />
                }
              }
              @if (tool() === 'select' && !indoor()) {
                @for (c of corners; track $index) {
                  <rect [attr.x]="c[0] * bd.length / 2 - hr()" [attr.y]="c[1] * bd.width / 2 - hr()" [attr.width]="hr() * 2" [attr.height]="hr() * 2" fill="#b7ed83" stroke="#12200b" vector-effect="non-scaling-stroke" (pointerdown)="cornerDown($event, c[0], c[1])" />
                }
                <line [attr.x1]="0" [attr.y1]="-bd.width / 2" [attr.x2]="0" [attr.y2]="-bd.width / 2 - 28 / ppm()" stroke="#b7ed83" vector-effect="non-scaling-stroke" pointer-events="none" />
                <circle [attr.cx]="0" [attr.cy]="-bd.width / 2 - 28 / ppm()" [attr.r]="hr()" fill="#ffd166" stroke="#12200b" vector-effect="non-scaling-stroke" (pointerdown)="rotDown($event)" />
              }
            </g>
          }
          @if (drag()?.t === 'draw') {
            <rect [attr.x]="dr().x" [attr.y]="dr().z" [attr.width]="dr().w" [attr.height]="dr().d" fill="#b7ed83" fill-opacity="0.25" stroke="#b7ed83" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" pointer-events="none" />
          }
          <circle [attr.cx]="ed.draft().droneStart.x" [attr.cy]="ed.draft().droneStart.z" [attr.r]="2" fill="#ff6b6b" pointer-events="none" />
        </svg>
        <div class="scale mono">{{ scaleLabel() }}</div>
      </div>

      <div class="insp">
        @switch (pick()?.t) {
          @case ('opening') {
            @if (op(); as o) {
              <label>type <select (change)="setOpening({ kind: kindOf($event) })"><option value="door" [selected]="o.kind === 'door'">door</option><option value="window" [selected]="o.kind === 'window'">window</option></select></label>
              <label>width <input type="number" min="0.4" step="0.1" [value]="o.w.toFixed(2)" (change)="setOpening({ w: num($event) })" /></label>
              <label>top height <input type="number" min="0.4" step="0.1" [value]="o.h.toFixed(2)" (change)="setOpening({ h: num($event) })" /></label>
              <label>position <input type="number" step="0.1" [value]="o.c.toFixed(2)" (change)="setOpening({ c: num($event) })" /></label>
              <button class="btn danger" (click)="deleteSel()">Delete</button>
            }
          }
          @case ('tree') {
            @if (tree(); as t) {
              <label>height <input type="number" min="1" step="0.5" [value]="t.h" (change)="setTree({ h: num($event) })" /></label>
              <label>radius <input type="number" min="0.5" step="0.25" [value]="t.r" (change)="setTree({ r: num($event) })" /></label>
              <label>kind <select (change)="setTree({ kind: treeKind($event) })"><option value="d" [selected]="t.kind === 'd'">broadleaf</option><option value="c" [selected]="t.kind === 'c'">conifer</option></select></label>
              <button class="btn danger" (click)="deleteSel()">Delete</button>
            }
          }
          @case ('wall') {
            <span class="dim">Interior wall</span>
            <button class="btn danger" (click)="deleteSel()">Delete wall</button>
          }
          @default {
            @if (b(); as bd) {
              <label>name <input type="text" [value]="bd.name" (change)="patchB({ name: text($event) })" /></label>
              <label>length <input type="number" min="2" step="0.5" [value]="bd.length.toFixed(1)" (change)="patchB({ length: Math.max(2, num($event)) })" /></label>
              <label>width <input type="number" min="2" step="0.5" [value]="bd.width.toFixed(1)" (change)="patchB({ width: Math.max(2, num($event)) })" /></label>
              <label>rot° <input type="number" step="5" [value]="bd.rotDeg.toFixed(0)" (change)="patchB({ rotDeg: num($event) })" /></label>
              @if (!bd.frame) {
                <span class="levels">
                  @for (l of bd.levels; track $index) {
                    <button class="btn" [class.on]="$index === level()" (click)="level.set($index)">L{{ $index + 1 }}</button>
                  }
                  <button class="btn" (click)="addLevel()" title="Add a floor">＋</button>
                </span>
                @if (lvl(); as l) {
                  <label>wall height <input type="number" min="1" step="0.5" [value]="l.height" (change)="editLevel(setHeight, num($event))" /></label>
                  <label>roof <select (change)="editLevel(setRoof, roofOf($event))"><option value="gable" [selected]="l.roof === 'gable'">gable</option><option value="vault" [selected]="l.roof === 'vault'">vault</option><option value="flat" [selected]="l.roof === 'flat'">flat</option></select></label>
                }
              }
              <button class="btn" (click)="ed.duplicateSelected(); applyNow()" title="Duplicate">⧉</button>
              <button class="btn danger" (click)="deleteSel()">Delete</button>
            } @else {
              <span class="dim">Select a building, or choose a tool above and click the plan.</span>
            }
          }
        }
      </div>
    </app-panel>
  `,
  styles: `
    .bar {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      align-items: center;
    }
    .sp {
      flex: 1;
    }
    .hint {
      margin: 3px 0;
      min-height: 15px;
    }
    .view {
      position: relative;
      flex: 1 1 auto;
      min-height: 160px;
      background: #0a0f0c;
      border-radius: 6px;
      overflow: hidden;
    }
    svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      touch-action: none;
      outline: none;
      cursor: default;
    }
    .scale {
      position: absolute;
      left: 8px;
      bottom: 6px;
      font-size: 10px;
      background: rgba(10, 16, 12, 0.8);
      padding: 1px 6px;
      border-radius: 6px;
      pointer-events: none;
    }
    .insp {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 10px;
      align-items: center;
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid var(--line);
    }
    .insp label {
      display: inline-flex;
      gap: 4px;
      align-items: center;
    }
    .insp input[type='number'] {
      width: 62px;
    }
    .levels {
      display: inline-flex;
      gap: 3px;
    }
  `,
})
export class PlanPanel {
  protected readonly site = inject(SiteService);
  protected readonly view = inject(ViewStore);
  protected readonly ed = this.site.editor;
  private readonly destroyRef = inject(DestroyRef);
  private readonly viewEl = viewChild.required<ElementRef<HTMLElement>>('view');
  private readonly svgEl = viewChild.required<ElementRef<SVGSVGElement>>('svg');
  protected readonly Math = Math;
  protected readonly num = numberFrom;
  protected readonly text = textFrom;
  protected readonly checked = checkedFrom;
  protected readonly tools: readonly { id: Tool; label: string; hint: string }[] = [
    { id: 'select', label: '↖ Select', hint: 'Select, move, resize and rotate' },
    { id: 'building', label: '＋ Building', hint: 'Drag a rectangle on the plan to add a building' },
    { id: 'tree', label: '＋ Tree', hint: 'Click the plan to plant a tree' },
    { id: 'door', label: '＋ Door', hint: 'Click a wall of the selected building' },
    { id: 'window', label: '＋ Window', hint: 'Click a wall of the selected building' },
    { id: 'wall', label: '＋ Wall', hint: 'Drag inside the selected building (indoors)' },
  ];
  protected readonly corners: readonly [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

  protected readonly tool = signal<Tool>('select');
  protected readonly indoor = signal(false);
  protected readonly level = signal(0);
  protected readonly pick = signal<Pick>(null);
  protected readonly drag = signal<Drag | null>(null);
  // view: centre (site metres) and pixels per metre
  protected readonly cx = signal(0);
  protected readonly cz = signal(0);
  protected readonly ppm = signal(2);
  private readonly size = signal({ w: 600, h: 360 });
  private gestureStarted = false;
  private roofBefore = false;

  protected readonly b = this.ed.building;
  protected readonly ext = computed(() => Math.max(60, this.ed.draft().extent));
  protected readonly hr = computed(() => 6 / this.ppm());
  protected readonly lvl = computed<LevelSpec | null>(() => {
    const bd = this.b();
    return bd ? (bd.levels[Math.min(this.level(), bd.levels.length - 1)] ?? null) : null;
  });
  protected readonly vb = computed(() => {
    const { w, h } = this.size();
    const k = this.ppm();
    return `${this.cx() - w / (2 * k)} ${this.cz() - h / (2 * k)} ${w / k} ${h / k}`;
  });
  protected readonly scaleLabel = computed(() => `${Math.round(100 / this.ppm())} m ▭ 100 px`);
  protected readonly treeI = computed(() => {
    const p = this.pick();
    return p?.t === 'tree' ? p.i : -1;
  });
  protected readonly wallI = computed(() => {
    const p = this.pick();
    return p?.t === 'wall' ? p.i : -1;
  });
  protected readonly tree = computed(() => {
    const p = this.pick();
    return p?.t === 'tree' ? (this.ed.draft().trees[p.i] ?? null) : null;
  });
  protected readonly op = computed<OpeningSpec | null>(() => {
    const p = this.pick();
    return p?.t === 'opening' ? (this.lvl()?.doors[p.side]?.[p.i] ?? null) : null;
  });
  protected readonly dr = computed(() => {
    const d = this.drag();
    if (d?.t !== 'draw') return { x: 0, z: 0, w: 0, d: 0 };
    return { x: Math.min(d.x0, d.x1), z: Math.min(d.z0, d.z1), w: Math.abs(d.x1 - d.x0), d: Math.abs(d.z1 - d.z0) };
  });
  protected readonly wd = computed(() => {
    const d = this.drag();
    return d?.t === 'wallDraw' ? d : { a: { x: 0, z: 0 }, b: { x: 0, z: 0 } };
  });
  protected readonly hint = computed(() => {
    const t = this.tool();
    if (t === 'building') return 'Drag a rectangle on the plan to add a building.';
    if (t === 'tree') return 'Click the plan to plant trees. Switch to Select to move or delete them.';
    if ((t === 'door' || t === 'window') && !this.b()) return 'Select a building first, then click one of its walls.';
    if (t === 'door' || t === 'window') return `Click a wall of “${this.b()!.name}” to add a ${t}. Drag it along the wall; drag its white ends to resize.`;
    if (t === 'wall') return this.b() ? 'Drag inside the building to draw an interior wall (snaps to 0.5 m).' : 'Select a building first.';
    if (this.indoor()) return 'Indoors: roof is off in 3D. Drag walls, doors and windows; Delete removes the selection.';
    return 'Drag a building to move it, its corners to resize, the yellow knob to rotate. Wheel zooms, drag the background to pan.';
  });

  constructor() {
    afterNextRender(() => {
      const el = this.viewEl().nativeElement;
      const ro = new ResizeObserver(() => {
        if (el.clientWidth > 20 && el.clientHeight > 20) this.size.set({ w: el.clientWidth, h: el.clientHeight });
      });
      ro.observe(el);
      this.fit();
      this.destroyRef.onDestroy(() => ro.disconnect());
    });
  }

  // ---- geometry helpers ----

  protected tf(bd: BuildingSpec): string {
    return `translate(${bd.pos.x} ${bd.pos.z}) rotate(${bd.rotDeg})`;
  }

  private toWorld(e: PointerEvent | WheelEvent): { x: number; z: number } {
    const r = this.svgEl().nativeElement.getBoundingClientRect();
    const k = this.ppm();
    return { x: this.cx() + (e.clientX - r.left - r.width / 2) / k, z: this.cz() + (e.clientY - r.top - r.height / 2) / k };
  }

  private toLocal(bd: BuildingSpec, p: { x: number; z: number }): { x: number; z: number } {
    const a = (bd.rotDeg * Math.PI) / 180;
    const dx = p.x - bd.pos.x, dz = p.z - bd.pos.z;
    return { x: dx * Math.cos(a) + dz * Math.sin(a), z: -dx * Math.sin(a) + dz * Math.cos(a) };
  }

  /** Every opening of the selected building's current level as a drawable segment in building-local metres. */
  protected openingsOf(bd: BuildingSpec): { key: string; side: Side; i: number; kind: 'door' | 'window'; x1: number; y1: number; x2: number; y2: number }[] {
    const l = this.lvl();
    if (!l) return [];
    const out: { key: string; side: Side; i: number; kind: 'door' | 'window'; x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const side of SIDES) {
      (l.doors[side] ?? []).forEach((o, i) => {
        const a = o.c - o.w / 2, z = o.c + o.w / 2;
        const seg =
          side === 'n' ? [-bd.length / 2 + a, -bd.width / 2, -bd.length / 2 + z, -bd.width / 2]
          : side === 's' ? [-bd.length / 2 + a, bd.width / 2, -bd.length / 2 + z, bd.width / 2]
          : side === 'w' ? [-bd.length / 2, -bd.width / 2 + a, -bd.length / 2, -bd.width / 2 + z]
          : [bd.length / 2, -bd.width / 2 + a, bd.length / 2, -bd.width / 2 + z];
        out.push({ key: `${side}${i}`, side, i, kind: o.kind, x1: seg[0]!, y1: seg[1]!, x2: seg[2]!, y2: seg[3]! });
      });
    }
    return out;
  }

  protected isOpen(side: Side, i: number): boolean {
    const p = this.pick();
    return p?.t === 'opening' && p.side === side && p.i === i;
  }

  // ---- view ----

  protected fit(): void {
    const d = this.ed.draft();
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const add = (x: number, z: number, r: number): void => {
      x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); z0 = Math.min(z0, z - r); z1 = Math.max(z1, z + r);
    };
    for (const bd of d.buildings) add(bd.pos.x, bd.pos.z, Math.hypot(bd.length, bd.width) / 2);
    for (const t of d.trees) add(t.x, t.z, t.r);
    if (!isFinite(x0)) { x0 = -60; x1 = 60; z0 = -40; z1 = 40; }
    const { w, h } = this.size();
    this.cx.set((x0 + x1) / 2);
    this.cz.set((z0 + z1) / 2);
    this.ppm.set(Math.max(0.2, Math.min(40, 0.9 * Math.min(w / Math.max(10, x1 - x0), h / Math.max(10, z1 - z0)))));
  }

  protected wheel(e: WheelEvent): void {
    e.preventDefault();
    const before = this.toWorld(e);
    const k = Math.max(0.2, Math.min(60, this.ppm() * Math.exp(-e.deltaY * 0.0015)));
    this.ppm.set(k);
    const after = this.toWorld(e);
    this.cx.update((v) => v + before.x - after.x);
    this.cz.update((v) => v + before.z - after.z);
  }

  // ---- tools & modes ----

  protected setTool(t: Tool): void {
    this.tool.set(t);
    if (t === 'wall' && this.b()) this.enterIndoor();
  }

  protected toggleIndoor(): void {
    if (this.indoor()) this.exitIndoor();
    else this.enterIndoor();
  }

  private enterIndoor(): void {
    const bd = this.b();
    if (!bd) return;
    if (!this.indoor()) this.roofBefore = this.view.roofHidden();
    this.indoor.set(true);
    this.view.setRoofHidden(true);
    // zoom to the building
    const { w, h } = this.size();
    this.cx.set(bd.pos.x);
    this.cz.set(bd.pos.z);
    this.ppm.set(Math.max(0.5, Math.min(60, 0.8 * Math.min(w / bd.length, h / bd.width))));
  }

  private exitIndoor(): void {
    this.indoor.set(false);
    this.view.setRoofHidden(this.roofBefore);
    if (this.tool() === 'wall') this.tool.set('select');
  }

  protected undo(): void {
    this.ed.undo();
    this.applyNow();
  }

  protected redo(): void {
    this.ed.redo();
    this.applyNow();
  }

  protected applyNow(): void {
    this.site.applyDraft();
  }

  // ---- pointer: starting gestures ----

  protected bgDown(e: PointerEvent): void {
    this.svgEl().nativeElement.focus();
    const p = this.toWorld(e);
    this.capture(e);
    const t = this.tool();
    if (t === 'building') {
      this.drag.set({ t: 'draw', x0: snap(p.x, 1), z0: snap(p.z, 1), x1: snap(p.x, 1), z1: snap(p.z, 1) });
    } else if (t === 'tree') {
      this.ed.addTree(snap(p.x, 0.5), snap(p.z, 0.5));
      this.applyNow();
    } else {
      this.pick.set(null);
      this.drag.set({ t: 'pan', sx: e.clientX, sy: e.clientY, cx: this.cx(), cz: this.cz() });
    }
  }

  protected bldDown(e: PointerEvent, bd: BuildingSpec): void {
    const t = this.tool();
    if (t === 'building' || t === 'tree') return; // those tools draw on top of anything: let the background handle it
    e.stopPropagation();
    this.svgEl().nativeElement.focus();
    const p = this.toWorld(e);
    this.capture(e);
    const isSel = this.ed.selectedId() === bd.id;
    if (!isSel) {
      this.ed.select(bd.id);
      this.level.set(0);
      this.pick.set({ t: 'building' });
      if (this.indoor()) this.enterIndoor();
    }
    if ((t === 'door' || t === 'window') && isSel) return this.addOpeningAt(bd, p, t);
    if (t === 'wall' && isSel) return this.startWall(bd, p);
    if (this.indoor() && isSel) {
      this.pick.set({ t: 'building' });
      this.drag.set({ t: 'pan', sx: e.clientX, sy: e.clientY, cx: this.cx(), cz: this.cz() });
      return;
    }
    this.pick.set({ t: 'building' });
    this.drag.set({ t: 'move', ox: bd.pos.x, oz: bd.pos.z, px: p.x, pz: p.z });
  }

  protected cornerDown(e: PointerEvent, sx: number, sz: number): void {
    const bd = this.b();
    if (!bd) return;
    e.stopPropagation();
    this.capture(e);
    const a = (bd.rotDeg * Math.PI) / 180;
    const lx = -sx * bd.length / 2, lz = -sz * bd.width / 2; // the opposite corner stays put
    this.drag.set({ t: 'resize', sx, sz, ax: bd.pos.x + lx * Math.cos(a) - lz * Math.sin(a), az: bd.pos.z + lx * Math.sin(a) + lz * Math.cos(a) });
  }

  protected rotDown(e: PointerEvent): void {
    e.stopPropagation();
    this.capture(e);
    this.drag.set({ t: 'rotate' });
  }

  protected treeDown(e: PointerEvent, i: number): void {
    if (this.tool() === 'building') return;
    e.stopPropagation();
    this.svgEl().nativeElement.focus();
    this.capture(e);
    const t = this.ed.draft().trees[i];
    if (!t) return;
    const p = this.toWorld(e);
    this.pick.set({ t: 'tree', i });
    this.drag.set({ t: 'tree', i, dx: t.x - p.x, dz: t.z - p.z });
  }

  protected openDown(e: PointerEvent, side: Side, i: number): void {
    e.stopPropagation();
    this.svgEl().nativeElement.focus();
    this.capture(e);
    this.pick.set({ t: 'opening', side, i });
    this.drag.set({ t: 'open', side, i });
  }

  protected openEndDown(e: PointerEvent, side: Side, i: number, end: 0 | 1): void {
    e.stopPropagation();
    this.capture(e);
    this.drag.set({ t: 'openEnd', side, i, end });
  }

  protected wallDown(e: PointerEvent, i: number): void {
    e.stopPropagation();
    this.svgEl().nativeElement.focus();
    this.pick.set({ t: 'wall', i });
  }

  private capture(e: PointerEvent): void {
    this.svgEl().nativeElement.setPointerCapture(e.pointerId);
    this.gestureStarted = false;
  }

  /** Add a door / window where a wall was clicked: the nearest side of the building, centred on the click. */
  private addOpeningAt(bd: BuildingSpec, world: { x: number; z: number }, kind: 'door' | 'window'): void {
    const l = this.toLocal(bd, world);
    const dist: Record<Side, number> = { n: Math.abs(l.z + bd.width / 2), s: Math.abs(l.z - bd.width / 2), w: Math.abs(l.x + bd.length / 2), e: Math.abs(l.x - bd.length / 2) };
    const side = SIDES.reduce((m, s) => (dist[s] < dist[m] ? s : m), 's' as Side);
    if (dist[side] > Math.max(3, 14 / this.ppm())) return; // clicked the middle of the building: not on a wall
    const run = side === 'n' || side === 's' ? bd.length : bd.width;
    const along = side === 'n' || side === 's' ? l.x + bd.length / 2 : l.z + bd.width / 2;
    const w = kind === 'door' ? 2.2 : 1.2;
    const li = Math.min(this.level(), bd.levels.length - 1);
    const lh = bd.levels[li]!.height;
    const c = Math.min(run - w / 2, Math.max(w / 2, snap(along, 0.1)));
    let idx = 0;
    this.ed.commitSite((s) => {
      const b = s.buildings.find((x) => x.id === bd.id);
      const lev = b?.levels[li];
      if (!lev) return;
      const arr = (lev.doors[side] ??= []);
      arr.push({ kind, c, w, h: kind === 'door' ? Math.min(2.6, lh * 0.8) : 1 + Math.min(1.2, lh * 0.3) });
      idx = arr.length - 1;
    });
    this.pick.set({ t: 'opening', side, i: idx });
    this.tool.set('select');
    this.applyNow();
  }

  private startWall(bd: BuildingSpec, world: { x: number; z: number }): void {
    const l = this.toLocal(bd, world);
    const a = { x: Math.min(bd.length, Math.max(0, snap(l.x + bd.length / 2, 0.5))), z: Math.min(bd.width, Math.max(0, snap(l.z + bd.width / 2, 0.5))) };
    this.drag.set({ t: 'wallDraw', a, b: { ...a } });
  }

  // ---- pointer: continuing / ending ----

  protected move(e: PointerEvent): void {
    const d = this.drag();
    if (!d) return;
    const p = this.toWorld(e);
    const bd = this.b();
    switch (d.t) {
      case 'pan': {
        const k = this.ppm();
        this.cx.set(d.cx - (e.clientX - d.sx) / k);
        this.cz.set(d.cz - (e.clientY - d.sy) / k);
        break;
      }
      case 'move':
        if (!bd) break;
        this.gesture((s) => {
          const x = s.buildings.find((q) => q.id === bd.id);
          if (x) x.pos = { x: snap(d.ox + p.x - d.px, 0.5), z: snap(d.oz + p.z - d.pz, 0.5) };
        });
        break;
      case 'resize': {
        if (!bd) break;
        const a = (bd.rotDeg * Math.PI) / 180;
        const ex = { x: Math.cos(a), z: Math.sin(a) }, ez = { x: -Math.sin(a), z: Math.cos(a) };
        const rx = p.x - d.ax, rz = p.z - d.az;
        const L = Math.max(2, snap(d.sx * (rx * ex.x + rz * ex.z), 0.5));
        const W = Math.max(2, snap(d.sz * (rx * ez.x + rz * ez.z), 0.5));
        this.gesture((s) => {
          const x = s.buildings.find((q) => q.id === bd.id);
          if (!x) return;
          x.length = L;
          x.width = W;
          x.pos = { x: d.ax + ex.x * d.sx * L / 2 + ez.x * d.sz * W / 2, z: d.az + ex.z * d.sx * L / 2 + ez.z * d.sz * W / 2 };
        });
        break;
      }
      case 'rotate': {
        if (!bd) break;
        const ang = (Math.atan2(p.z - bd.pos.z, p.x - bd.pos.x) * 180) / Math.PI + 90;
        const rot = ((snap(ang, e.shiftKey ? 15 : 1) % 360) + 360) % 360;
        this.gesture((s) => {
          const x = s.buildings.find((q) => q.id === bd.id);
          if (x) x.rotDeg = rot;
        });
        break;
      }
      case 'tree':
        this.gesture((s) => {
          const t = s.trees[d.i];
          if (t) { t.x = p.x + d.dx; t.z = p.z + d.dz; }
        });
        break;
      case 'open':
      case 'openEnd': {
        if (!bd) break;
        const l = this.toLocal(bd, p);
        const horizontal = d.side === 'n' || d.side === 's';
        const run = horizontal ? bd.length : bd.width;
        const along = Math.min(run, Math.max(0, snap((horizontal ? l.x + bd.length / 2 : l.z + bd.width / 2), 0.1)));
        const li = Math.min(this.level(), bd.levels.length - 1);
        const cur = bd.levels[li]?.doors[d.side]?.[d.i];
        if (!cur) break;
        this.gesture((s) => {
          const o = s.buildings.find((q) => q.id === bd.id)?.levels[li]?.doors[d.side]?.[d.i];
          if (!o) return;
          if (d.t === 'open') o.c = Math.min(run - o.w / 2, Math.max(o.w / 2, along));
          else {
            const lo = d.end === 0 ? along : cur.c - cur.w / 2, hi = d.end === 1 ? along : cur.c + cur.w / 2;
            if (hi - lo >= 0.4) { o.c = (lo + hi) / 2; o.w = hi - lo; }
          }
        });
        break;
      }
      case 'draw':
        this.drag.set({ ...d, x1: snap(p.x, 1), z1: snap(p.z, 1) });
        break;
      case 'wallDraw': {
        if (!bd) break;
        const l = this.toLocal(bd, p);
        this.drag.set({ ...d, b: { x: Math.min(bd.length, Math.max(0, snap(l.x + bd.length / 2, 0.5))), z: Math.min(bd.width, Math.max(0, snap(l.z + bd.width / 2, 0.5))) } });
        break;
      }
    }
  }

  /** First movement of a gesture opens one undo step; every move edits the draft live (3D follows on release). */
  private gesture(fn: (s: import('../../core/site-spec').SiteSpec) => void): void {
    if (!this.gestureStarted) {
      this.ed.beginGesture();
      this.gestureStarted = true;
    }
    this.ed.live(fn);
  }

  protected up(e: PointerEvent): void {
    const d = this.drag();
    this.drag.set(null);
    this.svgEl().nativeElement.releasePointerCapture?.(e.pointerId);
    if (!d) return;
    if (d.t === 'draw') {
      const r = { w: Math.abs(d.x1 - d.x0), d: Math.abs(d.z1 - d.z0) };
      if (r.w >= 3 && r.d >= 3) {
        this.ed.addBuilding({ pos: { x: (d.x0 + d.x1) / 2, z: (d.z0 + d.z1) / 2 }, length: r.w, width: r.d, rotDeg: 0 });
        this.pick.set({ t: 'building' });
        this.tool.set('select');
        this.applyNow();
      }
    } else if (d.t === 'wallDraw') {
      const bd = this.b();
      if (bd && Math.hypot(d.b.x - d.a.x, d.b.z - d.a.z) >= 0.5) {
        const li = Math.min(this.level(), bd.levels.length - 1);
        this.ed.commitSite((s) => {
          s.buildings.find((q) => q.id === bd.id)?.levels[li]?.partitions.push([d.a, d.b]);
        });
        this.applyNow();
      }
    } else if (d.t !== 'pan' && this.gestureStarted) {
      this.applyNow();
    }
    this.gestureStarted = false;
  }

  protected key(e: KeyboardEvent): void {
    if ((e.key === 'Delete' || e.key === 'Backspace') && (e.target as HTMLElement).tagName !== 'INPUT') {
      e.preventDefault();
      this.deleteSel();
    } else if (e.key === 'Escape') {
      this.tool.set('select');
      this.drag.set(null);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    }
  }

  // ---- inspector edits ----

  protected deleteSel(): void {
    const p = this.pick();
    const bd = this.b();
    if (p?.t === 'tree') this.ed.removeTree(p.i);
    else if (p?.t === 'opening' && bd) this.ed.removeOpeningAt(p.side, this.level(), p.i);
    else if (p?.t === 'wall' && bd) this.ed.removePartition(Math.min(this.level(), bd.levels.length - 1), p.i);
    else if (bd) {
      if (this.indoor()) this.exitIndoor();
      this.ed.removeBuilding(bd.id);
    }
    this.pick.set(null);
    this.applyNow();
  }

  protected patchB(patch: Parameters<typeof this.ed.patchBuilding>[0]): void {
    this.ed.patchBuilding(patch);
    this.applyNow();
  }

  protected setOpening(patch: Partial<OpeningSpec>): void {
    const p = this.pick();
    if (p?.t !== 'opening') return;
    this.ed.patchOpeningAt(p.side, this.level(), p.i, patch);
    this.applyNow();
  }

  protected setTree(patch: Partial<{ h: number; r: number; kind: 'd' | 'c' }>): void {
    const i = this.treeI();
    if (i < 0) return;
    this.ed.commitSite((s) => {
      const t = s.trees[i];
      if (t) Object.assign(t, patch);
    });
    this.applyNow();
  }

  protected addLevel(): void {
    this.ed.addLevel();
    this.level.set((this.b()?.levels.length ?? 1) - 1);
    this.applyNow();
  }

  protected readonly setHeight = (l: LevelSpec, v: number): void => { l.height = Math.max(1, v); };
  protected readonly setRoof = (l: LevelSpec, v: LevelSpec['roof']): void => { l.roof = v; };

  protected editLevel<T>(fn: (l: LevelSpec, v: T) => void, v: T): void {
    const li = this.level();
    this.ed.editSelectedLevel((l) => fn(l, v), li);
    this.applyNow();
  }

  protected kindOf = (e: Event): 'door' | 'window' => (selectedFrom(e) === 'window' ? 'window' : 'door');
  protected treeKind = (e: Event): 'd' | 'c' => (selectedFrom(e) === 'c' ? 'c' : 'd');
  protected roofOf = (e: Event): LevelSpec['roof'] => selectedFrom(e) as LevelSpec['roof'];
}
