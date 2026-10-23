import { Component, DestroyRef, ElementRef, afterNextRender, afterRenderEffect, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { tr } from '../../services/i18n.service';
import { latLonText, parseLatLon, siteFromLatLon } from '../../core/geo';
import { uiResets } from '../../state/layout.store';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { contains, edgesOf, type Pt, type Rect } from '../../core/footprint';
import { buildingsOverlap, stairsFor, columnGrid, columnRow, convertBuilding, duplicateColumn, duplicateColumns, fillModule, mergeBuildings, overlapsOthers, repeatOpening } from '../../core/building-ops';
import { addOpening, insideBuilding, listOpenings, moveOpening, outlineOf, previewOpening, patchOpening, removeOpening, reshapeBuilding, resetToRect, resizeOpening, type OpenSeg } from '../../core/openings';
import { cloneSpec, uid, type BuildingSpec, type LevelSpec, type LocationInfo, type SiteSpec, type StructureKind, type StructureSpec } from '../../core/site-spec';
import { autoAlign, magnetAngle } from '../../core/align';
import { columnsInLine, pointsInside, treeZones } from '../../core/elements';
import { FENCES, fenceDef, newFence, setFenceMaterial, type FenceMaterial } from '../../core/fences';
import { areaCorners } from '../../core/areas';
import { roadDef, surfaceDef } from '../../core/layers';
import type { TerrainOp } from '../../core/terrain';
import { siteGround } from '../../core/site-ground';
import { PickMenu, type PickOption } from './pick-menu';
import { BlocksBox } from './blocks-box';
import { paramValues, type BlockSpec, type ParamValue } from '../../core/blocks';
import { BlockLibraryService } from '../../services/block-library.service';
import { areaOf, nearBuilding, scatterTrees, type ScatterMode } from '../../core/scatter';
import { placeColumn, type Placement } from '../../core/placement';
import { RECT_KINDS, STRUCTURE_DEFAULTS } from '../../three/structures';
import { AiService } from '../../services/ai.service';
import { FlightService } from '../../services/flight.service';
import { FlightStore } from '../../state/flight.store';
import { GeoService } from '../../services/geo.service';
import { SceneService } from '../../services/scene.service';
import { MAX_HALF_EXTENT, SiteService } from '../../services/site.service';
import { StudioService } from '../../services/studio.service';
import { ToastService } from '../../services/toast.service';
import { ViewStore } from '../../state/view.store';
import { speedHsl } from '../../core/math';
import { checkedFrom, numberFrom, selectedFrom, textFrom } from '../dom';
import { FloatBox } from '../float-box';
import { AssistantBox } from './assistant-box';
import { ElementsBox, type ElementGo } from './elements-box';
import { ElementPreview } from './element-preview';
import { ToolIcon } from './tool-icon';
import type { SitePick } from '../../three/site-view';
import { SiteView } from './site-view';
import { TourService } from '../../services/tour.service';
import type { PreviewTarget } from '../../three/element-preview';
import { polyPts, type Drag, type EditorHost, type Handle, type Pick, type Tool } from './editor/editor-host';
import { LayerTool } from './editor/layer-tool';
import { MeasureTool } from './editor/measure-tool';
import { BlockTool } from './editor/block-tool';
import { ToolbarDock } from './editor/toolbar-dock';
import { TerrainTool, TERRAIN_OPS } from './editor/terrain-tool';
import { UndergroundTool } from './editor/underground-tool';

type Entry = { key: string; tool: Tool; mode?: ScatterMode; op?: TerrainOp; icon: string; name: string; color: string; hint: string; group: string; sep?: boolean };
type CtxItem = { label: string; act?: () => void; danger?: boolean; sep?: boolean; head?: boolean };

/** Tools that place something on the selected building: while one is active, a click puts the thing where the ghost is. */
const PLACE: readonly Tool[] = ['door', 'window', 'wall', 'void', 'column', 'stairs', 'cut', 'wing'];
const MIN_HALF = 20;
const M_LAT = 111132;
const snap = (v: number, step: number): number => Math.round(v / step) * step;

const clampHalf = (v: number): number => Math.min(MAX_HALF_EXTENT, Math.max(MIN_HALF, v));
const STREET = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

/** The picture of each structure kind and fence material in the pickers (keys of TOOL_ICONS). */
const STRUCT_ICON: Record<StructureKind, string> = {
  chimney: 'chimney', silo: 'silo', tank: 'tank', water_tower: 'waterTower', lattice_tower: 'lattice', tower_crane: 'crane',
  bridge: 'bridge', stairs: 'stairs', ramp: 'ramp', container: 'container', car: 'car', truck: 'truck', excavator: 'excavator', shapes: 'blocks',
};
const FENCE_ICON: Record<FenceMaterial, string> = { masonry: 'wall', concrete: 'concrete', brick: 'brick', wood: 'fence', metal: 'metalSheet', chainlink: 'chainlink' };

/**
 * The bando editor. One map (street / satellite / hidden, with adjustable opacity) carries everything:
 *  1 · Area — search a place, pan the map under the dashed frame, drag the frame's edges to set the area in metres,
 *      then Generate builds the 3D model from OpenStreetMap.
 *  2 · Model — the generated model drawn straight over the map, in true position: move, resize, rotate or reshape
 *      buildings (cut notches, add wings), plant trees, and — with "Edit indoors", which also removes the roof in
 *      3D — draw walls and place doors and windows. Pin / measure live here too.
 * The inspector is a floating box you can move and resize inside the window.
 */
@Component({
  selector: 'app-bando-editor',
  imports: [FormsModule, FloatBox, AssistantBox, ElementsBox, ElementPreview, SiteView, ToolIcon, PickMenu, BlocksBox],
  host: { class: 'be' },
  templateUrl: './bando-editor.html',
  styleUrl: './bando-editor.scss',
})
export class BandoEditor {
  protected readonly studio = inject(StudioService);
  protected readonly ai = inject(AiService);
  protected readonly site = inject(SiteService);
  private readonly scene = inject(SceneService);
  protected readonly flights = inject(FlightService);
  private readonly flightStore = inject(FlightStore);
  private readonly toast = inject(ToastService);
  protected readonly view = inject(ViewStore);
  private readonly blockLib = inject(BlockLibraryService);
  protected readonly ed = this.site.editor;
  private readonly destroyRef = inject(DestroyRef);
  private readonly mapEl = viewChild.required<ElementRef<HTMLElement>>('el');
  private readonly wrapEl = viewChild.required<ElementRef<HTMLElement>>('wrap');
  private readonly svgEl = viewChild<ElementRef<SVGSVGElement>>('svg');

  protected readonly num = numberFrom;
  protected readonly checked = checkedFrom;
  protected readonly text = textFrom;
  protected readonly round = Math.round;
  protected readonly Math = Math;
  protected readonly edgesOf = edgesOf;
  protected readonly handles: readonly Handle[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
  protected readonly corners: readonly [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  /** `where`: shown outdoors ('out'), only while editing a floor ('in'), or always. Tools that need a building hide without one. */
  protected readonly tools: readonly { id: Tool; icon: string; name: string; color: string; hint: string; where: 'out' | 'in' | 'both'; group: string; needsBuilding?: boolean; sep?: boolean }[] = [
    { id: 'select', icon: 'select', group: 'select', name: 'Select', color: '#e6eee9', hint: 'Click selects · drag moves / resizes / rotates · indoors, drag on the floor to box-select columns, outside the building to pan', where: 'both' },
    { id: 'measure', icon: 'measure', group: 'measure', name: 'Measure', color: '#38d6ff', hint: 'Click points to chain measures (magnet to elements) · click a line to select / move it · Delete removes it', where: 'both' },
    { id: 'building', icon: 'building', group: 'build', name: 'Building', color: '#b7ed83', hint: 'Drag a rectangle on the map; it snaps flush to close neighbours unless auto-align is off', where: 'out', sep: true },
    { id: 'merge', icon: 'merge', group: 'build', name: 'Merge', color: '#a29bfe', hint: 'Then click a touching (or almost touching) building to join it into the selected one', where: 'out', needsBuilding: true },
    { id: 'cut', icon: 'cut', group: 'build', name: 'Cut', color: '#ff6b6b', hint: 'Cut a notch out of the selected building (U, H, L shapes)', where: 'out', needsBuilding: true },
    { id: 'wing', icon: 'wing', group: 'build', name: 'Wing', color: '#74b9ff', hint: 'Add a wing to the selected building', where: 'out', needsBuilding: true },
    { id: 'structure', icon: 'structure', group: 'struct', name: 'Structure', color: '#f78fb3', hint: 'Tower, bridge, container, vehicle ... (choose the kind in the options)', where: 'out' },
    { id: 'tree', icon: 'tree', group: 'trees', name: 'Tree', color: '#4cd964', hint: 'Click the map to plant a tree', where: 'out' },
    { id: 'scatter', icon: 'brush', group: 'trees', name: 'Tree brush', color: '#00cec9', hint: 'Paint trees with a pen, or fill a square, circle or hand-drawn area with random trees', where: 'out' },
    { id: 'fence', icon: 'fence', group: 'fence', name: 'Fence', color: '#ff9f43', hint: 'Drag to draw a free-standing wall or fence', where: 'out' },
    { id: 'road', icon: 'road', group: 'layers', name: 'Road', color: '#b0b8c9', hint: 'Drag along the way: a road, track, path or railway laid on the ground', where: 'out' },
    { id: 'surface', icon: 'surface', group: 'layers', name: 'Surface', color: '#e8d48b', hint: 'Draw an outline: the ground inside becomes asphalt, gravel, sand ...', where: 'out' },
    { id: 'water', icon: 'water', group: 'layers', name: 'Water', color: '#5d8cff', hint: 'Draw an outline: a pond or basin, dug into the ground', where: 'out' },
    { id: 'terrain', icon: 'terrainRaise', group: 'terrain', name: 'Terrain', color: '#c49a6c', hint: 'Shape the ground: raise, lower, smooth, flatten, or stamp a hill, crater or ramp', where: 'out' },
    { id: 'tunnel', icon: 'tunnel', group: 'terrain', name: 'Tunnel', color: '#9b5de5', hint: 'Drag a tunnel (or a room) under the ground; it opens where the ground is cut', where: 'out' },
    { id: 'wall', icon: 'wall', group: 'room', name: 'Wall', color: '#e1b12c', hint: 'Draw an interior wall on this floor', where: 'in', sep: true },
    { id: 'void', icon: 'void', group: 'room', name: 'Void', color: '#0984e3', hint: 'Drag a hole in this floor (water on the ground floor)', where: 'in' },
    { id: 'stairs', icon: 'stairs', group: 'room', name: 'Stairs', color: '#badc58', hint: 'Click to place stairs (or a ramp) on this floor', where: 'in' },
    { id: 'door', icon: 'door', group: 'open', name: 'Door', color: '#55efc4', hint: 'Click a wall of this floor', where: 'in' },
    { id: 'window', icon: 'window', group: 'open', name: 'Window', color: '#e056fd', hint: 'Click a wall of this floor', where: 'in' },
    { id: 'column', icon: 'column', group: 'col', name: 'Column', color: '#fab1a0', hint: 'Click to place a column: it snaps to the other columns and shows the distances', where: 'in' },
  ];
  /** The tree brush has four shapes; each is its own entry in the Trees group. */
  private static readonly SCATTER: readonly { mode: ScatterMode; icon: string; name: string }[] = [
    { mode: 'pen', icon: 'brush', name: 'Tree brush · pen' },
    { mode: 'rect', icon: 'areaRect', name: 'Tree area · square' },
    { mode: 'circle', icon: 'areaCircle', name: 'Tree area · circle' },
    { mode: 'lasso', icon: 'lasso', name: 'Tree area · lasso' },
  ];
  /** Every tool on offer right now, with the brush expanded to its shapes. */
  protected readonly entries = computed<Entry[]>(() =>
    this.visibleTools().flatMap((t): Entry[] =>
      t.id === 'scatter'
        ? BandoEditor.SCATTER.map((m) => ({ key: `scatter:${m.mode}`, tool: t.id, mode: m.mode, icon: m.icon, name: m.name, color: t.color, hint: t.hint, group: t.group }))
        : t.id === 'terrain'
          ? TERRAIN_OPS.map((m) => ({ key: `terrain:${m.op}`, tool: t.id, op: m.op, icon: m.icon, name: m.name, color: t.color, hint: t.hint, group: t.group }))
          : [{ key: t.id, tool: t.id, icon: t.icon, name: t.name, color: t.color, hint: t.hint, group: t.group, sep: t.sep }],
    ),
  );
  private entryOn(e: Entry): boolean {
    return this.tool() === e.tool && (!e.mode || this.scatterMode() === e.mode) && (!e.op || this.terrain.op() === e.op);
  }
  /** The palette: one button per group (like a paint program), showing the active tool of the group or the last one used. The rest sit in a flyout. */
  protected readonly groups = computed(() => {
    const by = new Map<string, Entry[]>();
    for (const e of this.entries()) by.set(e.group, [...(by.get(e.group) ?? []), e]);
    return [...by.entries()].map(([id, items]) => {
      const active = items.find((i) => this.entryOn(i));
      const shown = active ?? items.find((i) => i.key === this.groupCur()[id]) ?? items[0]!;
      return { id, items, shown, on: !!active, sep: !!items[0]!.sep };
    });
  });
  protected readonly groupCur = signal<Record<string, string>>({});
  /** `data-tour` marks of a palette button: every tool of its group (the guided tour and the hover tips find them). */
  protected toolMarks = (items: readonly Entry[]): string => [...new Set(items.map((i) => `tool-${i.tool}`))].join(' ');

  /** The group whose flyout is open. */
  protected readonly fly = signal<string | null>(null);
  private pressT: ReturnType<typeof setTimeout> | undefined;
  private longPressed = false;

  protected pickEntry(e: Entry): void {
    const def = this.tools.find((t) => t.id === e.tool);
    if (def?.needsBuilding && (!this.b() || this.b()!.frame)) this.toast.show(this.b()?.frame ? `${e.name} does not work on a greenhouse.` : `${e.name}: select a building first, then use it.`);
    this.groupCur.update((g) => ({ ...g, [e.group]: e.key }));
    if (e.mode) this.scatterMode.set(e.mode);
    if (e.op) this.terrain.op.set(e.op);
    this.setTool(e.tool);
    this.fly.set(null);
  }
  protected entryActive = (e: Entry): boolean => this.entryOn(e);
  /** Holding a button (or its corner, or a right click) opens the flyout of its group. */
  protected pbDown(id: string, n: number): void {
    this.longPressed = false;
    clearTimeout(this.pressT);
    if (n > 1) this.pressT = setTimeout(() => {
      this.longPressed = true;
      this.fly.set(id);
    }, 380);
  }
  protected pbUp(): void {
    clearTimeout(this.pressT);
  }
  protected pbClick(e: Entry): void {
    if (this.longPressed) {
      this.longPressed = false;
      return;
    }
    this.pickEntry(e);
  }
  protected toggleFly(id: string, ev: Event): void {
    ev.stopPropagation();
    ev.preventDefault();
    this.fly.update((f) => (f === id ? null : id));
  }
  protected readonly toolDef = computed(() => this.tools.find((t) => t.id === this.tool()));
  protected readonly toolName = computed(() => this.toolDef()?.name ?? '');
  protected readonly toolColor = computed(() => this.toolDef()?.color ?? '#fff');
  /** The colour of one tool, so what it draws while you drag matches its palette button. */
  protected tc = (id: Tool): string => this.tools.find((t) => t.id === id)?.color ?? '#fff';

  protected readonly mode = signal<'area' | 'model'>('area');
  /** 2D edits the plan on the map; 3D shows the whole bando in an orbit view. */
  protected readonly view3d = signal(false);
  /** Roofs in the 3D view (its own switch: it does not follow the Hide roof button of the main view). */
  protected readonly roofs3d = signal(true);
  /** While a 3D pointer event is replayed through the 2D tool code: the ground point it hit. */
  private world3d: Pt | null = null;
  protected readonly repN = signal(4);
  protected readonly repS = signal(3);
  protected readonly colN = signal(4);
  protected readonly colS = signal(4);
  protected readonly colAxis = signal<'x' | 'z'>('x');
  protected readonly tool = signal<Tool>('select');
  /** What the Structure tool places, and what the Building tool draws. */
  protected readonly structKind = signal<StructureKind>('chimney');
  protected readonly buildKind = signal<'building' | 'greenhouse'>('building');
  /** What the Column tool places, what the Stairs tool places, and whether stairs open a hole in the floor above. */
  protected readonly colShape = signal<'square' | 'round'>('square');
  protected readonly colSize = signal(0.6);
  protected readonly stairsKind = signal<'stairs' | 'ramp'>('stairs');
  protected readonly stairwell = signal(true);
  /** The pointer on the map while a placing tool is active (for the ghost and its guides). */
  protected readonly hover = signal<Pt | null>(null);
  /** Guides while a column is being dragged. */
  protected readonly dragPlacement = signal<Placement | null>(null);
  protected readonly structKinds: readonly { id: StructureKind; label: string }[] = [
    { id: 'chimney', label: 'Chimney' }, { id: 'silo', label: 'Silo' }, { id: 'tank', label: 'Storage tank' },
    { id: 'water_tower', label: 'Water tower' }, { id: 'lattice_tower', label: 'Lattice tower / pylon' }, { id: 'tower_crane', label: 'Tower crane' },
    { id: 'bridge', label: 'Bridge (drag)' }, { id: 'stairs', label: 'Stairs' }, { id: 'ramp', label: 'Ramp' },
    { id: 'container', label: 'Container' }, { id: 'car', label: 'Car' }, { id: 'truck', label: 'Truck' }, { id: 'excavator', label: 'Excavator' },
  ];
  protected readonly structOptions: readonly PickOption[] = this.structKinds.map((k) => ({ id: k.id, label: k.label, icon: STRUCT_ICON[k.id] }));
  protected readonly indoor = signal(false);
  protected readonly level = signal(0);
  protected readonly pick = signal<Pick>(null);
  protected levelName = (i: number): string => (i === 0 ? 'G' : `L${i}`);
  protected readonly drag = signal<Drag | null>(null);
  protected readonly autoAlign = signal(true);
  /** Magnet while moving / rotating a building: flush to neighbours, angles to theirs and to the map axes. Alt = off for one drag. */
  protected readonly magnet = signal(true);
  /** The magnet holds the dragged building right now (the outline turns cyan). */
  protected readonly magnetHit = signal(false);
  /** How far the magnet reaches: about 16 screen pixels, between 1 and 5 metres. */
  private readonly magnetReach = computed(() => Math.min(5, Math.max(1, 16 / this.ppm())));
  protected readonly elementsOpen = signal(false);
  /** A click in the elements list: select it and bring it into view. */
  /** Tree zones: every zone outlined while "show zones" is on; the one under the pointer in the list (or the last one clicked) is highlighted. */
  protected readonly zonesOn = signal(false);
  protected readonly zoneHover = signal<{ x: number; z: number }[] | null>(null);
  private readonly zoneSel = signal<{ x: number; z: number }[] | null>(null);
  private static poly = (h: readonly { x: number; z: number }[]): string => h.map((q) => `${q.x},${q.z}`).join(' ');
  protected readonly zonePolys = computed(() => (this.zonesOn() && !this.indoor() ? treeZones(this.ed.draft().trees).map((z) => BandoEditor.poly(z.hull)) : []));
  protected readonly zoneHi = computed(() => {
    const h = this.zoneHover() ?? this.zoneSel();
    return h && !this.indoor() ? BandoEditor.poly(h) : '';
  });

  protected goTo(g: ElementGo): void {
    this.zoneSel.set(null);
    if (g.id && (g.kind === 'floor' || g.kind === 'columns' || g.kind === 'wall' || g.kind === 'void' || g.kind === 'opening')) {
      // something on a floor: select its building, open that floor and select the thing
      this.view3d.set(false);
      this.ed.select(g.id);
      this.level.set(g.level ?? 0);
      this.colSet.set([]);
      this.enterIndoor();
      if (g.kind === 'columns' && g.indices?.length) {
        this.colSet.set(g.indices);
        this.pick.set({ t: 'column', i: g.indices[g.indices.length - 1]! });
      } else if (g.kind === 'wall' && g.index !== undefined) this.pick.set({ t: 'wall', i: g.index });
      else if (g.kind === 'void' && g.index !== undefined) this.pick.set({ t: 'void', i: g.index });
      else if (g.kind === 'opening' && g.opening) this.pick.set({ t: 'opening', id: g.opening });
      else this.pick.set({ t: 'building' });
      return;
    }
    if (g.kind === 'building' && g.id) {
      this.ed.select(g.id);
      this.pick.set({ t: 'building' });
    } else if (g.kind === 'structure' && g.index !== undefined) this.pick.set({ t: 'structure', i: g.index });
    else if ((g.kind === 'water' || g.kind === 'road' || g.kind === 'surface') && g.index !== undefined) {
      if (this.indoor()) this.exitIndoor();
      this.pick.set({ t: g.kind, i: g.index });
    }
    else if (g.kind === 'fence' && g.index !== undefined) this.pick.set({ t: 'fence', i: g.index });
    else {
      this.pick.set(null);
      if (g.kind === 'trees' && g.zone) this.zoneSel.set(g.zone);
    }
    this.flyTo(g.x, g.z, g.size);
  }
  /** Extra selected columns (indices on the current floor); the primary pick is always included. */
  protected readonly colSet = signal<number[]>([]);
  protected isColSel = (i: number): boolean => this.colI() === i || this.colSet().includes(i);
  protected readonly colIdxs = computed(() => [...new Set([...(this.colI() >= 0 ? [this.colI()] : []), ...this.colSet()])]);
  /** How a drag on empty ground selects with the Select tool: a box, or a hand-drawn lasso. */
  protected readonly selShape = signal<'box' | 'lasso'>('box');
  /** Shift is held: outdoors the plan takes the pointer so Shift + drag selects instead of panning the map. */
  protected readonly shiftHeld = signal(false);
  /** Extra selected trees (indices); the primary pick is always included. */
  protected readonly treeSet = signal<number[]>([]);
  protected isTreeSel = (i: number): boolean => this.treeI() === i || this.treeSet().includes(i);
  protected readonly treeIdxs = computed(() => [...new Set([...(this.treeI() >= 0 ? [this.treeI()] : []), ...this.treeSet()])]);
  /** The selection area being dragged, in site metres (a box's four corners or the lasso path). */
  private readonly selArea = computed<Pt[] | null>(() => {
    const d = this.drag();
    if (d?.t !== 'selArea' || d.pts.length < 2) return null;
    return this.selShape() === 'lasso' ? d.pts : this.selAreaOf(d.pts);
  });
  protected readonly selOutline = computed(() => this.selArea()?.map((q) => `${q.x},${q.z}`).join(' ') ?? '');
  /** Columns of the edited floor, in site metres (for box / lasso hits). */
  private columnsWorld(bd: BuildingSpec): Pt[] {
    return (this.lvl()?.columns ?? []).map((c) => this.fromLocal(bd, { x: c.x - bd.length / 2, z: c.z - bd.width / 2 }));
  }
  /** Select the row (`x`, east–west), the line (`z`, north–south) or the whole module (`grid`) of the selected column. */
  protected selectColumns(along: 'x' | 'z' | 'grid'): void {
    const i = this.colI();
    const cols = this.lvl()?.columns ?? [];
    if (i < 0) return;
    const set = columnsInLine(cols, i, along);
    this.colSet.set(set);
    this.toast.show(`${set.length} columns selected (${along === 'x' ? 'row' : along === 'z' ? 'line' : 'all alike'}).`);
  }
  /** A bando shared without its place: no map under it (it would show the sea at 0°, 0°), no area to regenerate. */
  protected readonly placeHidden = computed(() => this.ed.draft().privacy === 'hidden');

  // ---- tool controllers: a tool's own options, previews and edits (editor/) ----
  /** The ground the editor shows (contours, the height under the pointer): the draft's terrain, same cache as the 3D model. */
  private readonly ground = computed(() => siteGround(this.ed.draft()));
  protected readonly polyPts = polyPts;

  protected readonly scatterMode = signal<ScatterMode>('pen');
  protected readonly scatterSpacing = signal(5);
  protected readonly scatterWidth = signal(10);
  protected asScatter = (v: string): ScatterMode => (['pen', 'rect', 'circle', 'lasso'].includes(v) ? (v as ScatterMode) : 'pen');
  /** Species of new trees (tree tool and brush): broadleaf, conifer, or a natural mix. More species will come from the shared library. */
  protected readonly treeMix = signal<'d' | 'c' | 'mix'>('mix');
  protected asMix = (v: string): 'd' | 'c' | 'mix' => (v === 'd' || v === 'c' ? v : 'mix');
  /** Material of new fences. */
  protected readonly fenceMat = signal<FenceMaterial>('masonry');
  protected asFence = (v: string): FenceMaterial => fenceDef(v as FenceMaterial).id;
  protected fenceLabel = (m: FenceMaterial | undefined): string => fenceDef(m).label;
  protected fenceColor = (m: FenceMaterial | undefined): string => (m ? fenceDef(m).color : '#d9c9a0');
  protected readonly fenceOptions: readonly PickOption[] = FENCES.map((f) => ({ id: f.id, label: f.label, hint: f.hint, icon: FENCE_ICON[f.id] }));
  protected readonly treeKindOptions: readonly PickOption[] = [
    { id: 'd', label: 'Broadleaf', icon: 'tree', hint: 'Round crown (oak, plane, poplar)' },
    { id: 'c', label: 'Conifer', icon: 'conifer', hint: 'Cone (pine, spruce, cypress)' },
  ];
  protected readonly treeMixOptions: readonly PickOption[] = [...this.treeKindOptions, { id: 'mix', label: 'Mixed', icon: 'mixedTrees', hint: 'Both, at random (about 4 in 10 conifers)' }];
  protected readonly scatterOptions: readonly PickOption[] = [
    { id: 'pen', label: 'Pen', icon: 'brush', hint: 'Plant along a stroke' },
    { id: 'rect', label: 'Square', icon: 'areaRect', hint: 'Fill a dragged square' },
    { id: 'circle', label: 'Circle', icon: 'areaCircle', hint: 'Fill a circle from its centre' },
    { id: 'lasso', label: 'Lasso', icon: 'lasso', hint: 'Fill a loop drawn by hand' },
  ];
  protected readonly buildOptions: readonly PickOption[] = [
    { id: 'building', label: 'Building', icon: 'building', hint: 'Walls, floors, roof' },
    { id: 'greenhouse', label: 'Greenhouse', icon: 'greenhouse', hint: 'Arched steel frame' },
  ];
  protected readonly colOptions: readonly PickOption[] = [
    { id: 'square', label: 'Square', icon: 'colSquare' },
    { id: 'round', label: 'Round', icon: 'column' },
  ];
  protected readonly stairsOptions: readonly PickOption[] = [
    { id: 'stairs', label: 'Stairs', icon: 'stairs' },
    { id: 'ramp', label: 'Ramp', icon: 'ramp' },
  ];
  /** The area the brush is about to fill, as an SVG polygon `points` string. */
  protected readonly scatterPreview = computed(() => {
    const d = this.drag();
    if (d?.t !== 'scatter') return '';
    const poly = areaOf(this.scatterMode(), d.pts, this.scatterWidth());
    return poly.map((q) => `${q.x},${q.z}`).join(' ');
  });
  protected readonly pinMode = this.scene.pin;
  protected query = '';
  protected readonly hits = signal<LocationInfo[]>([]);
  protected readonly searching = signal(false);

  // map view (Leaflet) as signals: centre, zoom, pixel size
  private readonly center = signal({ lat: this.studio.start().lat, lon: this.studio.start().lon });
  private readonly zoom = signal(this.studio.start().zoom);
  private readonly size = signal({ w: 600, h: 400 });
  /** The area to build, in metres either side of the map centre: independent of the window size and the zoom. */
  protected readonly half = signal<{ e: number; n: number }>({ e: 120, n: 80 });
  /** The frame's centre relative to the map centre, in the frame's own axes (metres, u = its east, v = its south): resizing one edge moves only that edge. */
  protected readonly off = signal<{ u: number; v: number }>({ u: 0, v: 0 });
  /** The frame is turned this many degrees clockwise. */
  protected readonly rot = signal(0);

  private map: L.Map | null = null;
  /** The pinned areas ("Add area") drawn on the map while framing. */
  private readonly areaLayer = L.layerGroup();
  private readonly areaRenderer = L.svg({ padding: 0.3 });
  private readonly mapOn = signal(false);
  private tiles: L.TileLayer | null = null;
  private gestureStarted = false;
  private warned = false;
  private roofBefore = false;

  protected readonly b = this.ed.building;
  protected readonly hasModel = computed(() => !this.studio.isNew() && this.ed.draft().buildings.length + this.ed.draft().trees.length > 0);
  protected readonly overlayOn = computed(() => this.mode() === 'model' && this.hasModel() && this.ed.draft().bearingDeg === 0);
  protected readonly captures = computed(() => this.tool() !== 'select' || this.pinMode() !== null || this.indoor() || this.shiftHeld() || !!this.blocks.armed());
  protected readonly hasPath = computed(() => !!this.flights.active);
  protected readonly atMax = computed(() => this.half().e >= MAX_HALF_EXTENT || this.half().n >= MAX_HALF_EXTENT);

  /** Metres per screen pixel at the map centre (Web Mercator). */
  private readonly mpp = computed(() => (156543.03392 * Math.cos((this.center().lat * Math.PI) / 180)) / Math.pow(2, this.zoom()));
  protected readonly ppm = computed(() => 1 / this.mpp());
  protected readonly hr = computed(() => 6 / this.ppm());
  /** Site metres of the map centre: the model is anchored on the spec's origin (lat / lon), x east, z south. */
  private readonly siteC = computed(() => {
    const o = this.ed.draft().origin;
    const mLon = 111320 * Math.cos((o.lat * Math.PI) / 180);
    return { x: (this.center().lon - o.lon) * mLon, z: -(this.center().lat - o.lat) * M_LAT };
  });
  protected readonly vb = computed(() => {
    const { w, h } = this.size();
    const k = this.ppm(), c = this.siteC();
    return `${c.x - w / (2 * k)} ${c.z - h / (2 * k)} ${w / k} ${h / k}`;
  });
  protected readonly zoneRect = computed(() => {
    const z = this.ed.draft().zone;
    const o = this.ed.draft().origin;
    if (!z) return null;
    const mLon = 111320 * Math.cos((o.lat * Math.PI) / 180);
    const cx = (z.lon - o.lon) * mLon, cz = -(z.lat - o.lat) * M_LAT;
    return { x: cx - z.halfE, z: cz - z.halfN, w: z.halfE * 2, d: z.halfN * 2, rot: z.rotDeg ?? 0 };
  });
  protected readonly fb = computed(() => {
    const { w, h } = this.size();
    const k = this.ppm();
    const fw = Math.min(this.half().e * 2 * k, w - 8), fh = Math.min(this.half().n * 2 * k, h - 8);
    const r = (this.rot() * Math.PI) / 180, o = this.off();
    const cx = w / 2 + (o.u * Math.cos(r) - o.v * Math.sin(r)) * k, cy = h / 2 + (o.u * Math.sin(r) + o.v * Math.cos(r)) * k;
    return { l: cx - fw / 2, t: cy - fh / 2, w: fw, h: fh };
  });
  protected readonly lvl = computed<LevelSpec | null>(() => {
    const bd = this.b();
    return bd ? (bd.levels[Math.min(this.level(), bd.levels.length - 1)] ?? null) : null;
  });
  protected readonly openings = computed<OpenSeg[]>(() => {
    const bd = this.b();
    return bd && this.indoor() ? listOpenings(bd, Math.min(this.level(), bd.levels.length - 1)) : [];
  });
  protected readonly openId = computed(() => {
    const p = this.pick();
    return p?.t === 'opening' ? p.id : '';
  });
  protected readonly op = computed(() => this.openings().find((o) => o.id === this.openId()) ?? null);
  protected readonly treeI = computed(() => {
    const p = this.pick();
    return p?.t === 'tree' ? p.i : -1;
  });
  protected readonly wallI = computed(() => {
    const p = this.pick();
    return p?.t === 'wall' ? p.i : -1;
  });
  protected readonly tree = computed(() => this.ed.draft().trees[this.treeI()] ?? null);
  protected readonly fenceI = computed(() => {
    const p = this.pick();
    return p?.t === 'fence' ? p.i : -1;
  });
  protected readonly voidI = computed(() => {
    const p = this.pick();
    return p?.t === 'void' ? p.i : -1;
  });
  protected readonly colI = computed(() => {
    const p = this.pick();
    return p?.t === 'column' ? p.i : -1;
  });
  protected readonly structI = computed(() => {
    const p = this.pick();
    return p?.t === 'structure' ? p.i : -1;
  });
  protected readonly structSel = computed(() => this.ed.draft().structures?.[this.structI()] ?? null);
  protected readonly bdw = computed(() => {
    const d = this.drag();
    return d?.t === 'bridgeDraw' ? d : { a: { x: 0, z: 0 }, b: { x: 0, z: 0 } };
  });
  protected readonly fence = computed(() => this.ed.draft().walls?.[this.fenceI()] ?? null);
  protected readonly voidSel = computed(() => this.lvl()?.voids?.[this.voidI()] ?? null);
  protected readonly colSel = computed(() => this.lvl()?.columns?.[this.colI()] ?? null);
  /** What the inspector's 3D view shows: the selected thing alone, or a part of a building in place with the rest ghosted. */
  protected readonly previewTarget = computed<PreviewTarget | null>(() => {
    const p = this.pick();
    const bd = this.b();
    const li = Math.min(this.level(), (bd?.levels.length ?? 1) - 1);
    if (p?.t === 'tree') {
      const t = this.tree();
      return t ? { kind: 'tree', t } : null;
    }
    if (p?.t === 'structure') {
      const st = this.structSel();
      return st ? { kind: 'structure', s: st } : null;
    }
    if (p?.t === 'fence') {
      const w = this.fence();
      return w ? { kind: 'fence', w } : null;
    }
    if (!bd) return null;
    if (p?.t === 'opening') {
      const o = this.op();
      return o ? { kind: 'part', b: bd, li, part: { t: 'opening', seg: o } } : null;
    }
    if (p?.t === 'wall') {
      const pt = this.lvl()?.partitions[p.i];
      return pt ? { kind: 'part', b: bd, li, part: { t: 'wall', a: pt[0], c: pt[1] } } : null;
    }
    if (p?.t === 'void') {
      const v = this.voidSel();
      return v ? { kind: 'part', b: bd, li, part: { t: 'void', v } } : null;
    }
    if (p?.t === 'column') {
      const c = this.colSel();
      return c ? { kind: 'part', b: bd, li, part: { t: 'column', c } } : null;
    }
    // editing a floor: that floor stays solid, the other floors and the roof turn transparent
    return this.indoor() || this.floorFocus() ? { kind: 'floor', b: bd, li } : { kind: 'building', b: bd };
  });
  /** A floor was chosen on purpose: the previews show that floor solid and the rest of the building ghosted. */
  protected readonly floorFocus = signal(false);
  protected readonly focus3d = computed(() => {
    const bd = this.b();
    return this.floorFocus() && bd && bd.levels.length > 1 ? { id: bd.id, li: Math.min(this.level(), bd.levels.length - 1) } : null;
  });
  protected pickLevel(i: number): void {
    if (this.level() === i && this.floorFocus()) this.floorFocus.set(false);
    else {
      this.level.set(i);
      this.floorFocus.set(true);
    }
  }
  protected readonly previewKey = computed(() => {
    const p = this.pick();
    const idx = p && 'i' in p ? p.i : p && 'id' in p ? p.id : '';
    return `${this.ed.selectedId()}|${p?.t ?? 'building'}|${idx}|${this.level()}|${this.floorFocus() || this.indoor() ? 'f' : ''}`;
  });
  protected readonly previewCaption = computed(() => {
    const t = this.previewTarget();
    if (t?.kind === 'part' || t?.kind === 'floor') return `floor ${this.levelName(this.level())} · the rest is ghosted · drag to rotate`;
    return 'drag to rotate · wheel to zoom';
  });
  protected readonly visibleTools = computed(() =>
    this.tools.filter(
      (t) =>
        (t.where === 'both' || (t.where === 'in') === this.indoor()) &&
        // cut / wing / merge stay in the palette: without a selected building they ask for one (their hint says so)

        (!this.view3d() || ['select', 'building', 'structure', 'tree', 'scatter', 'fence', 'terrain', 'tunnel', 'road', 'surface', 'water'].includes(t.id)), // on the ground in 3D: what a click can place or paint
    ),
  );
  protected readonly placing = computed(() => PLACE.includes(this.tool()));

  /** Where the column / stairs tool would put its thing under the pointer, with the guides to draw. */
  protected readonly ghost = computed<(Placement & { kind: 'column' | 'stairs' | 'opening'; w: number; d: number }) | null>(() => {
    const h = this.hover(), bd = this.b();
    if (!h || !bd || !this.indoor()) return null;
    const li = Math.min(this.level(), bd.levels.length - 1);
    const l = this.toLocal(bd, h);
    const raw = { x: l.x + bd.length / 2, z: l.z + bd.width / 2 };
    if (this.tool() === 'column') return { ...placeColumn(bd, li, raw, { tol: 10 / this.ppm() }), kind: 'column', w: this.colSize(), d: this.colSize() };
    if (this.tool() === 'door' || this.tool() === 'window') {
      const kind = this.tool() as 'door' | 'window';
      const pv = previewOpening(bd, li, l, kind, Math.max(3, 14 / this.ppm()));
      if (!pv) return { x: raw.x, z: raw.z, valid: false, guides: [], labels: [], snapped: { x: 'grid', z: 'grid' }, kind: 'opening', w: 0, d: 0 };
      const L2 = bd.length / 2, W2 = bd.width / 2;
      const P = (a: number, c: number): { x: number; z: number } => (pv.axis === 'x' ? { x: a + L2, z: c + W2 } : { x: c + L2, z: a + W2 });
      const s0 = P(pv.c - pv.w / 2, pv.at), s1 = P(pv.c + pv.w / 2, pv.at);
      const eq = pv.gaps.length === 2 && Math.abs(pv.gaps[0]!.d - pv.gaps[1]!.d) < 0.06;
      return {
        x: P(pv.c, pv.at).x, z: P(pv.c, pv.at).z, valid: true, guides: [], snapped: { x: 'grid', z: 'grid' }, kind: 'opening', w: pv.w, d: 0,
        seg: { x0: s0.x, z0: s0.z, x1: s1.x, z1: s1.z, kind },
        labels: pv.gaps.map((g) => {
          const m = P((g.from + g.to) / 2, pv.at + (pv.axis === 'x' ? 0.55 : 0.55));
          return { x: m.x, z: m.z, text: `${Math.round(g.d * 100) / 100} m`, kind: eq ? ('equal' as const) : ('dist' as const) };
        }),
      };
    }
    if (this.tool() === 'stairs') {
      const x = snap(raw.x, 0.5), z = snap(raw.z, 0.5);
      const d = STRUCTURE_DEFAULTS[this.stairsKind()];
      const len = d.length ?? 5, w = d.size;
      return { x, z, valid: insideBuilding(bd, { x: x - bd.length / 2, z: z - bd.width / 2 }), guides: [], labels: [], snapped: { x: 'grid', z: 'grid' }, kind: 'stairs', w: len, d: w };
    }
    return null;
  });
  protected readonly pv = computed<Placement | null>(() => this.dragPlacement() ?? this.ghost());
  /** What is selected, as the 3D view needs it (for the yellow box). */
  protected readonly sel3d = computed<SitePick | null>(() => {
    const p = this.pick();
    if (p?.t === 'tree') return { kind: 'tree', i: p.i };
    if (p?.t === 'fence') return { kind: 'fence', i: p.i };
    if (p?.t === 'structure') {
      const st = this.ed.draft().structures?.[p.i];
      return st ? { kind: 'structure', id: st.id } : null;
    }
    const id = this.ed.selectedId();
    return id ? { kind: 'building', id } : null;
  });

  /** Flight paths for the 2D overlay: coloured by speed, thinned to a few hundred points, with start / end markers. */
  protected readonly flightList = computed(() => {
    this.flightStore.revision(); // bumped whenever the flights are re-projected (a pin, the compass ...)
    return this.flights.all;
  });
  protected readonly pathView = computed(() =>
    this.flightList().map((f) => {
      const step = Math.max(1, Math.floor(f.loc.length / 300));
      const segs: { pts: string; color: string }[] = [];
      for (let i = 0; i + step < f.loc.length + step; i += step * 4) {
        const part = f.loc.slice(i, Math.min(f.loc.length, i + step * 4 + 1)).filter((_, k) => k % step === 0 || i + k === f.loc.length - 1);
        if (part.length < 2) continue;
        const sp = f.spd[Math.min(f.spd.length - 1, i + step * 2)] ?? 0;
        segs.push({ pts: part.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(' '), color: speedHsl(Math.min(1, sp / Math.max(1, this.flights.speedMax))) });
      }
      const a = f.loc[0], z = f.loc[f.loc.length - 1];
      return { id: f.id, segs, start: a ? { x: a.x, z: a.z } : null, end: z ? { x: z.x, z: z.z } : null };
    }),
  );
  protected readonly topLevel = computed<LevelSpec | null>(() => {
    const bd = this.b();
    return bd ? (bd.levels[bd.levels.length - 1] ?? null) : null;
  });
  protected readonly fd = computed(() => {
    const d = this.drag();
    return d?.t === 'fenceDraw' ? d : { a: { x: 0, z: 0 }, b: { x: 0, z: 0 } };
  });
  protected readonly vd = computed(() => {
    const d = this.drag();
    if (d?.t !== 'voidDraw') return { x: 0, z: 0, w: 0, d: 0 };
    return { x: Math.min(d.a.x, d.b.x), z: Math.min(d.a.z, d.b.z), w: Math.abs(d.b.x - d.a.x), d: Math.abs(d.b.z - d.a.z) };
  });
  protected readonly dr = computed(() => {
    const d = this.drag();
    if (d?.t !== 'draw') return { x: 0, z: 0, w: 0, d: 0 };
    return { x: Math.min(d.x0, d.x1), z: Math.min(d.z0, d.z1), w: Math.abs(d.x1 - d.x0), d: Math.abs(d.z1 - d.z0) };
  });
  protected readonly sh = computed(() => {
    const d = this.drag();
    if (d?.t !== 'shape') return { x: 0, z: 0, w: 0, d: 0, op: 'cut' as const };
    return { x: Math.min(d.a.x, d.b.x), z: Math.min(d.a.z, d.b.z), w: Math.abs(d.b.x - d.a.x), d: Math.abs(d.b.z - d.a.z), op: d.op };
  });
  protected readonly wd = computed(() => {
    const d = this.drag();
    return d?.t === 'wallDraw' ? d : { a: { x: 0, z: 0 }, b: { x: 0, z: 0 } };
  });
  protected readonly hint = computed(() => {
    if (this.mode() === 'area') return 'Pan and zoom the map to place the area, drag the frame\'s edges and corners to size it, then Generate.';
    const t = this.tool();
    if (this.pinMode()) return 'Click the map where the flight ' + (this.pinMode() === 's' ? 'started' : 'ended') + '. Esc cancels.';
    const arm = this.blocks.armed();
    if (arm) return `Click the map to place “${arm.block.name}” (again for another one). Esc stops.`;
    if (t === 'structure') return this.structKind() === 'bridge' ? 'Drag from one end of the bridge to the other. Select it to change height, width, style.' : 'Click to place it. Select it to change height and size; drag to move.';
    if (t === 'building') return this.buildKind() === 'greenhouse' ? 'Drag a rectangle: the long side is the tunnel, the short side the arch span.' : 'Drag a rectangle to add a building (it cannot overlap another).';
    if (t === 'merge') return this.b() ? `Click a touching building to merge it into “${this.b()!.name}”.` : 'Click the building to keep, then the one to merge into it.';
    if (t === 'fence') return 'Drag to draw a free-standing wall or fence. Select it to edit height or drag its ends.';
    if (t === 'void') return 'Drag a hole in the selected floor (on the ground floor tick “water” for a basin).';
    if (t === 'column') return 'Click inside the building to place a column on this floor; drag to move.';
    if (t === 'cut' || t === 'wing') return this.b() ? `Drag a rectangle over the selected building to ${t === 'cut' ? 'cut it out' : 'add it as a wing'}.` : 'Select a building first.';
    if (t === 'tree') return 'Click to plant trees; switch to ↖ to move or delete them.';
    if (t === 'tunnel') return (this.under.kind() === 'tunnel' ? 'Drag from one end of the tunnel to the other.' : 'Drag a rectangle: a room under the ground (a bunker, a basement).') + ' It opens where the ground is between its floor and ceiling: lower the ground at its ends with Terrain to make the mouths.';
    if (t === 'road') return 'Drag along the way. Select a road to change its kind, width or surface.';
    if (t === 'water' && this.layers.waterMode() === 'line') return 'Drag along the course of a canal or ditch: the water follows the line at the width above. Select it (click its edge) to change it.';
    if (t === 'surface' || t === 'water') return `Draw the outline by hand. Select it (click its edge, or in ☰ Elements) to change it or delete it.`;
    if (t === 'terrain') return { raise: 'Drag to raise the ground along the stroke.', lower: 'Drag to dig along the stroke.', smooth: 'Drag to soften bumps and steps.', flatten: 'Drag from a point: the ground around the stroke goes to that point\'s height.', hill: 'Click to put a hill there.', crater: 'Click to dig a crater (with a little rim).', ramp: 'Drag from the foot of the ramp to its top.' }[this.terrain.op()] + ' One stroke = one undo step.';
    if (t === 'scatter') return { pen: 'Drag along a path: trees are planted randomly in a strip around it.', rect: 'Drag a square: it is filled with random trees.', circle: 'Drag from the centre: a circle is filled with random trees.', lasso: 'Draw a loop freehand: it is filled with random trees.' }[this.scatterMode()];
    if (t === 'door' || t === 'window') return this.b() ? `Click a wall of “${this.b()!.name}” to add a ${t}.` : 'Select a building first.';
    if (t === 'wall') return this.b() ? 'Drag inside the building to draw an interior wall.' : 'Select a building first.';
    if (t === 'measure') return 'Click points: each one continues the chain (B of one is A of the next); click the same point twice, Esc or right-click to stop. Click a line to select it, drag to move it, Delete removes it.';
    if (this.indoor()) return `Floor ${this.levelName(this.level())}: roof off in 3D. Doors, windows, walls, voids and columns are edited here, per floor. Delete removes the selection.`;
    return 'Drag a building to move it, corners / edge squares to resize or reshape, the yellow knob to rotate. Drag the map to pan.';
  });

  // the tool controllers (editor/), last so that everything they are handed exists
  private readonly host: EditorHost = {
    ed: this.ed,
    site: this.site,
    toast: this.toast,
    pick: this.pick,
    drag: this.drag,
    tool: this.tool,
    ppm: this.ppm,
    ground: this.ground,
    hover: this.hover,
    view3d: this.view3d,
    level: this.level,
    levelName: (i) => this.levelName(i),
    colSet: this.colSet,
    structSel: this.structSel,
    setTool: (t) => this.setTool(t),
    building: this.b,
    tc: (id) => this.tc(id),
    applyNow: () => this.applyNow(),
    capture: (e) => this.capture(e),
    toWorld: (e) => this.toWorld(e),
    bgDown: (e) => this.bgDown(e),
  };
  protected readonly layers = new LayerTool(this.host);
  protected readonly under = new UndergroundTool(this.host);
  protected readonly terrain = new TerrainTool(this.host);
  protected readonly measure = new MeasureTool(this.host);
  protected readonly blocks = new BlockTool(this.host, this.blockLib);
  /** The palette and the options bar: dragged places and stacking. */
  protected readonly dock = new ToolbarDock(this.size, () => this.wrapEl().nativeElement);
  private readonly palEl = viewChild<ElementRef<HTMLElement>>('pal');

  constructor() {
    afterNextRender(() => this.init());
    // the guided tour drives the editor through these (it cannot reach protected state otherwise)
    const tour = inject(TourService);
    tour.editor = {
      tool: (id) => {
        const e = this.entries().find((x) => x.tool === id);
        if (e) this.pickEntry(e);
      },
      select: (name) => {
        const b = this.ed.draft().buildings.find((x) => x.name === name);
        if (b) this.ed.select(b.id);
        return !!b;
      },
      model: () => this.setMode('model'),
      state: () => ({ mode: this.mode(), view3d: this.view3d() }),
      view2d: () => this.view3d.set(false),
      closeBoxes: () => {
        this.blocks.armed.set(null);
        this.blocks.open.set(false);
        this.elementsOpen.set(false);
        this.ai.open.set(false);
      },
    };
    this.destroyRef.onDestroy(() => {
      if (tour.editor) tour.editor = null;
    });
    effect(() => {
      this.tool(); // a new tool's options come on top
      untracked(() => this.dock.raise('opts'));
    });
    effect(() => {
      // pinned areas: dashed yellow outlines on the map, numbered like their chips in the footer
      const areas = this.studio.areas(), on = this.mapOn() && this.mode() === 'area';
      untracked(() => {
        this.areaLayer.clearLayers();
        if (!on) return;
        areas.forEach((a, i) => {
          const mLon = 111320 * Math.cos((a.lat * Math.PI) / 180);
          const ring = areaCorners(a, a).map((p) => L.latLng(a.lat - p.z / M_LAT, a.lon + p.x / mLon));
          L.polygon(ring, { renderer: this.areaRenderer, color: '#ffd166', weight: 2, dashArray: '6 4', fillOpacity: 0.08, interactive: false })
            .bindTooltip(`Area ${i + 1}`, { permanent: true, direction: 'center' })
            .addTo(this.areaLayer);
        });
      });
    });
    afterRenderEffect(() => {
      // line the options bar up with the active tool's button (measured, so separators and the grip count)
      this.groups();
      this.dock.palXY();
      const pal = this.palEl()?.nativeElement;
      untracked(() => this.dock.measure(pal));
    });
    effect(() => {
      if (uiResets() === 0) return;
      untracked(() => this.dock.resetAll());
    });
    effect(() => {
      // a multi-selection of trees only lives while a tree is selected and the trees stay the same list
      const p = this.pick();
      this.ed.draft().trees.length;
      if (p?.t !== 'tree') untracked(() => this.treeSet.set([]));
    });
    effect(() => {
      // while framing the area, the zone the Generate button uses follows the map centre and the frame size
      if (this.mode() !== 'area') return;
      const c = this.center(), h = this.half(), o = this.off(), rd = this.rot();
      const r = (rd * Math.PI) / 180;
      const east = o.u * Math.cos(r) - o.v * Math.sin(r), south = o.u * Math.sin(r) + o.v * Math.cos(r);
      const mLon = 111320 * Math.cos((c.lat * Math.PI) / 180);
      this.studio.zone.set({ lat: c.lat - south / 111132, lon: c.lon + east / mLon, halfE: h.e, halfN: h.n, ...(rd ? { rotDeg: rd } : {}) });
    });
    effect(() => {
      if (this.pick()) untracked(() => this.zoneSel.set(null)); // selecting something else drops the zone highlight
    });
    effect(() => {
      this.ed.selectedId(); // another building: back to the whole building
      untracked(() => this.floorFocus.set(false));
    });
    effect(() => this.applyBase(this.placeHidden() ? 'off' : this.studio.basemap(), this.studio.mapOpacity()));
    effect(() => {
      // a tool that is no longer offered (nothing selected, left the floor ...) falls back to Select
      const t = this.tool(), visible = this.visibleTools();
      if (!visible.some((x) => x.id === t)) untracked(() => this.tool.set('select'));
    });
    effect(() => {
      // after the assistant edited something: show it. Select the building; for interior work take the roof off.
      const f = this.ai.focus();
      if (!f) return;
      untracked(() => {
        if (this.mode() !== 'model') return;
        this.ed.select(f.id);
        this.pick.set({ t: 'building' });
        this.level.set(f.level);
        const fb = this.ed.draft().buildings.find((x) => x.id === f.id);
        if (fb) this.flyTo(fb.pos.x, fb.pos.z, Math.max(fb.length, fb.width));
        if (f.interior && !this.indoor()) this.enterIndoor();
      });
    });
  }

  // ---- map ----

  /** Pan (and zoom in if needed) the map to a point of the model, so a building fills about a third of the view. */
  protected flyTo(x: number, z: number, size = 30): void {
    const map = this.map;
    if (!map) return;
    const o = this.ed.draft().origin;
    const mLon = 111320 * Math.cos((o.lat * Math.PI) / 180);
    const w = Math.max(200, this.size().w);
    const zoom = Math.min(20, Math.max(17, Math.log2((156543.03392 * Math.cos((o.lat * Math.PI) / 180) * w) / (size * 3))));
    map.setView([o.lat - z / 111132, o.lon + x / mLon], Math.floor(zoom * 4) / 4);
  }

  private init(): void {
    const st = this.studio.start();
    const map = L.map(this.mapEl().nativeElement, { zoomControl: false, minZoom: 15, maxZoom: 21, zoomSnap: 0.25, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, attributionControl: true, doubleClickZoom: false, boxZoom: false }).setView([st.lat, st.lon], st.zoom);
    this.map = map;
    // the outlines get their own renderer, created now: one created lazily by the first outline clipped it away
    map.addLayer(this.areaRenderer);
    this.areaLayer.addTo(map);
    this.mapOn.set(true);
    // Shift + drag on the plan selects (box / lasso) instead of panning the map
    const shift = (ev: KeyboardEvent): void => this.shiftHeld.set(ev.shiftKey);
    addEventListener('keydown', shift);
    addEventListener('keyup', shift);
    addEventListener('blur', () => this.shiftHeld.set(false));
    this.destroyRef.onDestroy(() => {
      removeEventListener('keydown', shift);
      removeEventListener('keyup', shift);
    });
    // a right click opens the context menu: it must never start a drag (a press the browser then swallows leaves the drag stuck)
    this.wrapEl().nativeElement.addEventListener('pointerdown', (ev) => {
      if (ev.button === 2 && !this.view3d()) ev.stopPropagation();
    }, true);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    this.applyBase(this.placeHidden() ? 'off' : this.studio.basemap(), this.studio.mapOpacity());
    const sync = (): void => {
      const c = map.getCenter();
      this.center.set({ lat: c.lat, lon: c.lng });
      this.zoom.set(map.getZoom());
      const s = map.getSize();
      if (s.x > 20 && s.y > 20) this.size.set({ w: s.x, h: s.y });
    };
    map.on('move zoom resize', sync);
    map.on('click', () => {
      if (this.mode() === 'model' && this.tool() === 'select') this.pick.set(null);
    });
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      sync();
    });
    ro.observe(this.wrapEl().nativeElement);
    sync();
    // starting state
    const sh = this.studio.startHalf();
    const mpp = this.mpp();
    this.rot.set(sh?.rot ?? 0);
    this.half.set(sh ? { e: clampHalf(sh.e), n: clampHalf(sh.n) } : { e: clampHalf(this.size().w * 0.35 * mpp), n: clampHalf(this.size().h * 0.35 * mpp) });
    this.mode.set((this.studio.initialMode() === 'model' || this.placeHidden()) && this.hasModel() ? 'model' : 'area');
    this.destroyRef.onDestroy(() => {
      ro.disconnect();
      if (this.indoor()) this.view.setRoofHidden(this.roofBefore);
      this.scene.pin.set(null);
      map.remove();
      this.map = null;
    });
  }

  private applyBase(base: 'street' | 'sat' | 'off', opacity: number): void {
    const map = this.map;
    if (!map) return;
    this.tiles?.remove();
    this.tiles = null;
    if (base === 'off') return;
    this.tiles =
      base === 'sat'
        ? L.tileLayer(SAT, { maxZoom: 21, maxNativeZoom: 19, opacity, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' })
        : L.tileLayer(STREET, { maxZoom: 21, maxNativeZoom: 19, opacity, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' });
    this.tiles.addTo(map);
  }

  protected setBase(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.studio.basemap.set(v === 'sat' ? 'sat' : v === 'off' ? 'off' : 'street');
  }

  protected setOpacity(e: Event): void {
    this.studio.mapOpacity.set(Number((e.target as HTMLInputElement).value));
  }

  protected async search(): Promise<void> {
    if (!this.query.trim()) return;
    this.searching.set(true);
    try {
      const hits = await this.site.search(this.query, 6);
      if (hits.length === 1) this.pick2(hits[0]!);
      else this.hits.set(hits);
    } finally {
      this.searching.set(false);
    }
  }

  protected pick2(h: LocationInfo): void {
    this.hits.set([]);
    this.map?.setView([h.lat, h.lon], Math.max(this.map.getZoom(), 17));
    if (this.studio.isNew() && this.studio.name() === 'New bando') this.studio.name.set(h.label.split(',')[0]!.trim() || 'New bando');
  }

  protected setMode(m: 'area' | 'model'): void {
    if (m === 'model' && !this.hasModel()) return;
    this.mode.set(m);
    this.scene.pin.set(null);
    if (m === 'model') {
      const z = this.ed.draft().zone;
      if (z && this.map) this.map.setView([z.lat, z.lon], this.map.getZoom());
    } else if (this.indoor()) this.exitIndoor();
  }

  protected async generate(): Promise<void> {
    await this.studio.generate();
    if (this.hasModel()) {
      this.pick.set(null);
      this.mode.set('model');
    }
  }

  /** Point the generator at your own Overpass endpoint (blank = the public servers). */
  protected setServer(): void {
    const v = prompt(tr('Your Overpass / proxy URL (leave empty to use the public servers):'), GeoService.endpoint);
    if (v === null) return;
    GeoService.endpoint = v;
    this.toast.show(v.trim() ? 'Using your data server first.' : 'Using the public data servers.');
  }

  protected save(): void {
    this.site.saveDraft();
    this.toast.show('Saved.');
  }

  // ---- geometry helpers ----

  protected tf(bd: BuildingSpec): string {
    return `translate(${bd.pos.x} ${bd.pos.z}) rotate(${bd.rotDeg})`;
  }

  protected outline(bd: BuildingSpec): string {
    return outlineOf(bd).map((p) => `${p.x},${p.z}`).join(' ');
  }

  protected labelSize(bd: BuildingSpec): number {
    return Math.max(1.6, Math.min(5, Math.min(bd.length, bd.width) / Math.max(3, bd.name.length * 0.45)));
  }

  protected seg(o: OpenSeg): { x1: number; y1: number; x2: number; y2: number } {
    return o.axis === 'x' ? { x1: o.c - o.w / 2, y1: o.at, x2: o.c + o.w / 2, y2: o.at } : { x1: o.at, y1: o.c - o.w / 2, x2: o.at, y2: o.c + o.w / 2 };
  }

  private toWorld(e: { clientX: number; clientY: number }): Pt {
    if (this.world3d) return this.world3d; // a 3D ground event being replayed through the tool code
    const host = this.wrapEl().nativeElement.getBoundingClientRect();
    const k = this.ppm(), c = this.siteC();
    return { x: c.x + (e.clientX - host.left - host.width / 2) / k, z: c.z + (e.clientY - host.top - host.height / 2) / k };
  }

  /** Building-centred local metres back to site metres (the inverse of {@link toLocal}). */
  private fromLocal(bd: BuildingSpec, l: Pt): Pt {
    const a = (bd.rotDeg * Math.PI) / 180;
    return { x: bd.pos.x + l.x * Math.cos(a) - l.z * Math.sin(a), z: bd.pos.z + l.x * Math.sin(a) + l.z * Math.cos(a) };
  }

  private toLocal(bd: BuildingSpec, p: Pt): Pt {
    const a = (bd.rotDeg * Math.PI) / 180;
    const dx = p.x - bd.pos.x, dz = p.z - bd.pos.z;
    return { x: dx * Math.cos(a) + dz * Math.sin(a), z: -dx * Math.sin(a) + dz * Math.cos(a) };
  }

  private index(s: SiteSpec, id: string): BuildingSpec | undefined {
    return s.buildings.find((x) => x.id === id);
  }

  // ---- tools & modes ----

  protected setTool(t: Tool): void {
    if (!this.visibleTools().some((x) => x.id === t)) return;
    this.scene.pin.set(null);
    this.hover.set(null);
    this.dragPlacement.set(null);
    this.tool.set(t);
    if (t === 'wall' && this.b()) this.enterIndoor();
    if (t !== 'measure') {
      this.measure.chain.update((m) => ({ ...m, a: null, start: null }));
      this.measure.sel.set(null);
    }
    this.measure.hover.set(null);
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
    this.tool.set('select'); // the outdoor tools are not shown while editing a floor
    this.view.setRoofHidden(true);
    // zoom the map to the building
    if (this.map) {
      const o = this.ed.draft().origin;
      const mLon = 111320 * Math.cos((o.lat * Math.PI) / 180);
      const lat = o.lat - bd.pos.z / M_LAT, lon = o.lon + bd.pos.x / mLon;
      const size = this.size();
      const need = Math.max(bd.length, bd.width) * 1.4;
      const mppWanted = need / Math.min(size.w, size.h);
      const z = Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / mppWanted);
      this.map.setView([lat, lon], Math.min(21, Math.max(17, Math.floor(z * 4) / 4)));
    }
  }

  private exitIndoor(): void {
    this.indoor.set(false);
    this.view.setRoofHidden(this.roofBefore);
    if (!this.visibleTools().some((x) => x.id === this.tool())) this.tool.set('select');
    if (['opening', 'wall', 'void', 'column'].includes(this.pick()?.t ?? '')) this.pick.set({ t: 'building' });
  }

  protected armPin(which: 's' | 'e'): void {
    this.tool.set('select');
    this.scene.armPin(which);
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

  private capture(e: PointerEvent): void {
    this.svgEl()?.nativeElement.setPointerCapture(e.pointerId);
    this.wrapEl().nativeElement.focus({ preventScroll: true });
    this.gestureStarted = false;
    this.warned = false;
  }

  protected bgDown(e: PointerEvent): void {
    // only reached while the overlay captures (a drawing tool or a pin is armed)
    const p = this.toWorld(e);
    this.capture(e);
    const armed = this.blocks.armed();
    if (armed && !this.pinMode()) {
      this.blocks.place(armed, p);
      return;
    }
    if (!this.pinMode() && this.tool() === 'select' && this.indoor()) {
      // indoors the plan owns the pointer: drag on the floor = box-select, outside the building = pan the map
      const sel = this.b();
      const l = sel ? this.toLocal(sel, p) : null;
      if (sel && l && Math.abs(l.x) <= sel.length / 2 && Math.abs(l.z) <= sel.width / 2) {
        if (!e.shiftKey) this.colSet.set([]);
        this.drag.set({ t: 'selArea', pts: [p], add: e.shiftKey });
      } else this.drag.set({ t: 'pan', x: e.clientX, y: e.clientY });
      return;
    }
    if (!this.pinMode() && this.tool() === 'select') {
      // outdoors the plan only takes the pointer while Shift is held: Shift + drag selects trees with a box or a lasso
      this.drag.set({ t: 'selArea', pts: [p], add: true });
      return;
    }
    if (!this.pinMode() && PLACE.includes(this.tool())) {
      const sel = this.b();
      if (sel) this.bgDownSelected(sel, p, this.tool());
      return;
    }
    const pin = this.pinMode();
    if (pin) {
      this.scene.placePinAt(p.x, p.z);
      return;
    }
    const t = this.tool();
    const bd = this.b();
    if (t === 'structure') {
      const q = { x: snap(p.x, 0.5), z: snap(p.z, 0.5) };
      if (this.structKind() === 'bridge') this.drag.set({ t: 'bridgeDraw', a: q, b: { ...q } });
      else this.placeStructure(this.structKind(), q);
    } else if (t === 'fence') {
      const q = { x: snap(p.x, 0.5), z: snap(p.z, 0.5) };
      this.drag.set({ t: 'fenceDraw', a: q, b: { ...q } });
    } else if (t === 'building') this.drag.set({ t: 'draw', x0: snap(p.x, 1), z0: snap(p.z, 1), x1: snap(p.x, 1), z1: snap(p.z, 1) });
    else if (t === 'scatter') this.drag.set({ t: 'scatter', pts: [{ x: p.x, z: p.z }] });
    else if (t === 'road' || t === 'surface' || t === 'water') this.drag.set({ t: 'layer', pts: [{ x: p.x, z: p.z }] });
    else if (t === 'tunnel') this.drag.set({ t: 'under', a: { x: snap(p.x, 0.5), z: snap(p.z, 0.5) }, b: { x: snap(p.x, 0.5), z: snap(p.z, 0.5) } });
    else if (t === 'terrain') this.drag.set({ t: 'terrain', pts: [{ x: p.x, z: p.z }], h0: siteGround(this.ed.draft()).at(p.x, p.z) });
    else if (t === 'tree') {
      this.ed.addTree(snap(p.x, 0.5), snap(p.z, 0.5), this.newTreeKind());
      this.applyNow();
    } else if (t === 'measure') this.measure.click(p);
    else if ((t === 'cut' || t === 'wing') && bd) {    } else if ((t === 'cut' || t === 'wing') && bd) {
      const l = this.toLocal(bd, p);
      const a = { x: snap(l.x, 0.5), z: snap(l.z, 0.5) };
      this.drag.set({ t: 'shape', op: t === 'cut' ? 'cut' : 'add', a, b: { ...a } });
    } else if (t === 'wall' && bd) this.startWall(bd, p);
    else if ((t === 'door' || t === 'window') && bd) this.addOpeningAt(bd, p, t);
  }

  protected bldDown(e: PointerEvent, bd: BuildingSpec): void {
    const t = this.tool();
    if (this.pinMode() || t === 'building' || t === 'tree' || t === 'scatter' || t === 'terrain' || t === 'road' || t === 'surface' || t === 'water' || t === 'tunnel' || t === 'measure' || t === 'fence' || t === 'structure' || (PLACE.includes(t) && this.b())) return this.bgDown(e);
    e.stopPropagation();
    const p = this.toWorld(e);
    this.capture(e);
    const isSel = this.ed.selectedId() === bd.id;
    if (t === 'merge') {
      const sel = this.ed.selectedId();
      if (!sel || sel === bd.id) {
        this.ed.select(bd.id);
        this.pick.set({ t: 'building' });
      } else this.mergeInto(sel, bd.id);
      return;
    }
    if (!isSel) {
      this.ed.select(bd.id);
      this.level.set(0);
      this.pick.set({ t: 'building' });
      if (this.indoor()) this.enterIndoor();
    }
    if (t !== 'select' && isSel) return this.bgDownSelected(bd, p, t);
    this.pick.set({ t: 'building' });
    if (this.indoor()) return;
    this.drag.set({ t: 'move', ox: bd.pos.x, oz: bd.pos.z, px: p.x, pz: p.z });
  }

  private bgDownSelected(bd: BuildingSpec, p: Pt, t: Tool): void {
    if (t === 'door' || t === 'window') this.addOpeningAt(bd, p, t);
    else if (t === 'wall') this.startWall(bd, p);
    else if (t === 'void') {
      const l = this.toLocal(bd, p);
      const a = { x: Math.min(bd.length, Math.max(0, snap(l.x + bd.length / 2, 0.5))), z: Math.min(bd.width, Math.max(0, snap(l.z + bd.width / 2, 0.5))) };
      this.drag.set({ t: 'voidDraw', a, b: { ...a } });
    } else if (t === 'column') this.columnClick(bd, p);
    else if (t === 'stairs') this.placeStairsAt(bd);
    else if (t === 'cut' || t === 'wing') {
      const l = this.toLocal(bd, p);
      const a = { x: snap(l.x, 0.5), z: snap(l.z, 0.5) };
      this.drag.set({ t: 'shape', op: t === 'cut' ? 'cut' : 'add', a, b: { ...a } });
    }
  }

  protected cornerDown(e: PointerEvent, sx: number, sz: number): void {
    const bd = this.b();
    if (!bd) return;
    e.stopPropagation();
    this.capture(e);
    const a = (bd.rotDeg * Math.PI) / 180;
    const lx = -sx * bd.length / 2, lz = -sz * bd.width / 2;
    this.drag.set({ t: 'resize', sx, sz, ax: bd.pos.x + lx * Math.cos(a) - lz * Math.sin(a), az: bd.pos.z + lx * Math.sin(a) + lz * Math.cos(a) });
  }

  protected edgeDown(e: PointerEvent, i: number): void {
    const bd = this.b();
    if (!bd?.footprint) return;
    e.stopPropagation();
    this.capture(e);
    const ed = edgesOf(bd.footprint)[i];
    if (!ed) return;
    const mid = ed.axis === 'x' ? { x: (ed.from + ed.to) / 2, z: ed.at } : { x: ed.at, z: (ed.from + ed.to) / 2 };
    const inside = contains(bd.footprint, mid.x + (ed.axis === 'z' ? 0.05 : 0), mid.z + (ed.axis === 'x' ? 0.05 : 0));
    this.drag.set({ t: 'edge', start: cloneSpec({ ...this.ed.draft(), buildings: [bd] }).buildings[0]!, axis: ed.axis, at: ed.at, from: ed.from, to: ed.to, n: inside ? -1 : 1 });
  }

  protected rotDown(e: PointerEvent): void {
    e.stopPropagation();
    this.capture(e);
    this.drag.set({ t: 'rotate' });
  }

  protected treeDown(e: PointerEvent, i: number): void {
    const t = this.tool();
    if (this.pinMode() || t === 'building' || t === 'tree' || t === 'scatter' || t === 'terrain' || t === 'road' || t === 'surface' || t === 'water' || t === 'tunnel' || t === 'measure' || t === 'fence' || t === 'structure') return this.bgDown(e);
    e.stopPropagation();
    this.capture(e);
    const tr = this.ed.draft().trees[i];
    if (!tr) return;
    const p = this.toWorld(e);
    if (e.shiftKey) {
      const cur = this.treeIdxs();
      const next = cur.includes(i) ? cur.filter((k) => k !== i) : [...cur, i];
      this.treeSet.set(next);
      this.pick.set(next.length ? { t: 'tree', i: next[next.length - 1]! } : null);
      return;
    }
    if (!this.treeSet().includes(i)) this.treeSet.set([]);
    this.pick.set({ t: 'tree', i });
    this.drag.set({ t: 'tree', i, dx: tr.x - p.x, dz: tr.z - p.z });
  }

  protected openDown(e: PointerEvent, id: string): void {
    e.stopPropagation();
    this.capture(e);
    this.pick.set({ t: 'opening', id });
    this.drag.set({ t: 'open', id });
  }

  protected openEndDown(e: PointerEvent, id: string, end: 0 | 1): void {
    e.stopPropagation();
    this.capture(e);
    this.drag.set({ t: 'openEnd', id, end });
  }

  protected structDown(e: PointerEvent, i: number): void {
    const t = this.tool();
    if (this.pinMode() || t === 'building' || t === 'tree' || t === 'scatter' || t === 'terrain' || t === 'road' || t === 'surface' || t === 'water' || t === 'tunnel' || t === 'measure' || t === 'fence' || t === 'structure') return this.bgDown(e);
    e.stopPropagation();
    this.capture(e);
    const st = this.ed.draft().structures?.[i];
    if (!st) return;
    const p = this.toWorld(e);
    this.pick.set({ t: 'structure', i });
    this.drag.set({ t: 'structMove', i, dx: st.x - p.x, dz: st.z - p.z });
  }

  protected structRotDown(e: PointerEvent, i: number): void {
    e.stopPropagation();
    this.capture(e);
    this.drag.set({ t: 'structRot', i });
  }

  protected readonly ghostKind = computed<'column' | 'stairs' | 'opening' | null>(() => (this.dragPlacement() ? 'column' : (this.ghost()?.kind ?? null)));
  protected readonly stairsGhost = computed(() => {
    const d = STRUCTURE_DEFAULTS[this.stairsKind()];
    return { w: d.length ?? 5, d: d.size };
  });

  /** Faint grid lines every `step` metres, in the building's own axes (they make its main orientation visible). */
  protected gridPath(bd: BuildingSpec, step: number): string {
    const L = bd.length, W = bd.width;
    let d = '';
    for (let x = step; x < L; x += step) d += `M${x - L / 2} ${-W / 2}V${W / 2}`;
    for (let z = step; z < W; z += step) d += `M${-L / 2} ${z - W / 2}H${L / 2}`;
    return d;
  }

  protected isRect(k: StructureKind): boolean {
    return RECT_KINDS.includes(k);
  }

  protected hasLength(k: StructureKind): boolean {
    return RECT_KINDS.includes(k) || k === 'tower_crane';
  }

  protected rectFill(k: StructureKind): string {
    return k === 'bridge' ? '#8d8d86' : k === 'stairs' || k === 'ramp' ? '#b9b9b1' : k === 'container' ? '#9a5a3e' : k === 'excavator' ? '#e0a100' : '#7e93a8';
  }

  /** The little triangle at the front (+x) of a rectangular structure, so you can tell which way stairs climb / a vehicle faces. */
  protected arrowHead(length: number, width: number): string {
    const x = length * 0.32, h = Math.min(1.4, width * 0.3);
    return `${x + h * 1.6},0 ${x},${-h} ${x},${h}`;
  }

  protected heightLabel(k: StructureKind): string {
    return k === 'bridge' ? 'deck height' : k === 'stairs' || k === 'ramp' ? 'rise' : 'height';
  }

  /** Where the long axis of a building points on the compass rose (SVG units around the centre). */
  protected axisEnd(b: BuildingSpec): [number, number] {
    const a = (b.rotDeg * Math.PI) / 180;
    return [Math.cos(a) * 22, Math.sin(a) * 22];
  }

  protected axisOf = (e: Event): 'x' | 'z' => ((e.target as HTMLSelectElement).value === 'z' ? 'z' : 'x');

  /** A click on the 3D model: select what it hit (or nothing). */
  /** A click on a column / wall inside the inspector's 3D preview selects it in the editor too. */
  protected onPreviewPick(p: { kind: 'column' | 'wall'; i: number }): void {
    this.colSet.set([]);
    this.pick.set(p.kind === 'column' ? { t: 'column', i: p.i } : { t: 'wall', i: p.i });
  }

  protected onPick3d(p: SitePick | null): void {
    if (!p) {
      this.pick.set(null);
      this.ed.select('');
      return;
    }
    if (p.kind === 'building') {
      this.ed.select(p.id);
      this.level.set(0);
      this.pick.set({ t: 'building' });
    } else if (p.kind === 'structure') {
      const i = (this.ed.draft().structures ?? []).findIndex((x) => x.id === p.id);
      if (i >= 0) this.pick.set({ t: 'structure', i });
    } else if (p.kind === 'column' || p.kind === 'wall') {
      // an element of one floor: select its building, show that floor and pick the element (the inspector previews it in place)
      this.ed.select(p.id);
      this.level.set(p.li);
      this.colSet.set([]);
      this.pick.set(p.kind === 'column' ? { t: 'column', i: p.i } : { t: 'wall', i: p.i });
    } else if (p.kind === 'fence') this.pick.set({ t: 'fence', i: p.i });
    else this.pick.set({ t: 'tree', i: p.i });
  }

  /** A drag / click on the ground in 3D with a tool active: the same code path as in 2D, with the ground point as the pointer. */
  protected onGround3d(g: { phase: 'down' | 'move' | 'up' | 'hover'; x: number; z: number }): void {
    if (g.phase === 'hover') {
      this.hover.set({ x: g.x, z: g.z }); // the height readout and the brush ring follow the pointer
      return;
    }
    const fake = { clientX: 0, clientY: 0, pointerId: 1, shiftKey: false, button: 0, currentTarget: null, stopPropagation: () => undefined, preventDefault: () => undefined } as unknown as PointerEvent;
    if (Number.isNaN(g.x) && g.phase === 'up') {
      this.world3d = null;
      this.up(fake);
      return;
    }
    this.world3d = { x: g.x, z: g.z };
    try {
      if (g.phase === 'down') this.bgDown(fake);
      else if (g.phase === 'move') this.move(fake);
      else this.up(fake);
    } finally {
      this.world3d = null;
    }
  }

  protected setView3d(): void {
    this.view3d.set(true);
    this.measure.hover.set(null);
  }


  /** Repeat the selected door / window along its wall. */
  protected repeatSel(): void {
    const id = this.openId();
    if (!id) return;
    let n = 0;
    this.mutate((b) => {
      n = repeatOpening(b, Math.min(this.level(), b.levels.length - 1), id, this.repN(), this.repS());
    }, 0);
    this.toast.show(n ? `${n} copies added.` : 'No room for copies along this wall with that spacing.');
  }

  protected colDup(): void {
    const i = this.colI();
    if (this.colIdxs().length > 1) {
      let made: number[] = [];
      this.mutate((b) => {
        made = duplicateColumns(b, Math.min(this.level(), b.levels.length - 1), this.colIdxs(), this.colAxis() === 'x' ? this.colS() : 0, this.colAxis() === 'z' ? this.colS() : 0);
      }, 0);
      this.colSet.set(made);
      this.pick.set(made.length ? { t: 'column', i: made[made.length - 1]! } : { t: 'building' });
      this.toast.show(made.length ? `${made.length} columns copied as a group.` : 'The copy does not fit there (wall, void or another column).');
      return;
    }
    let idx = -1;
    this.mutate((b) => {
      idx = duplicateColumn(b, Math.min(this.level(), b.levels.length - 1), i, this.colAxis() === 'x' ? this.colS() : 0, this.colAxis() === 'z' ? this.colS() : 0);
    }, 0);
    if (idx < 0) this.toast.show('The copy would fall outside the building, in a void, or on another column.');
    else this.pick.set({ t: 'column', i: idx });
  }

  protected colRowAdd(): void {
    const i = this.colI();
    let n = 0;
    this.mutate((b) => {
      n = columnRow(b, Math.min(this.level(), b.levels.length - 1), i, this.colN(), this.colS(), this.colAxis());
    }, 0);
    this.toast.show(n ? `${n} columns added.` : 'Nothing fits in that direction.');
  }

  protected colFill(): void {
    const i = this.colI();
    let n = 0;
    if (this.colIdxs().length > 1) {
      this.mutate((b) => {
        n = fillModule(b, Math.min(this.level(), b.levels.length - 1), this.colIdxs(), this.colS(), 0.8);
      }, 0);
      this.colSet.set([]);
      this.toast.show(n ? `${n} columns added on the grid of your selection.` : 'The selection\'s grid has no more room.');
      return;
    }
    this.mutate((b) => {
      n = columnGrid(b, Math.min(this.level(), b.levels.length - 1), i, this.colS(), this.colS(), 0.8);
    }, 0);
    this.pick.set(null);
    this.toast.show(n ? `Floor filled with ${n} columns, evenly spread and clear of the walls.` : 'No room for columns with that spacing.');
  }

  protected convertTo(to: 'greenhouse' | 'building'): void {
    if (!confirm(tr(`Convert to a ${to}? Its interior walls, doors, windows, columns, voids and outline are lost (you can still Undo).`))) return;
    if (this.indoor()) this.exitIndoor();
    this.mutate((b) => convertBuilding(b, to), 0);
    this.level.set(0);
  }

  protected duplicateStruct(): void {
    const st = this.structSel();
    if (!st) return;
    this.placeStructure(st.kind, { x: st.x + (st.length ?? st.size * 2) + 2, z: st.z }, { name: st.name, rotDeg: st.rotDeg, height: st.height, size: st.size, length: st.length, style: st.style, y: st.y, color: st.color });
  }

  private placeStructure(kind: StructureKind, at: Pt, extra: Partial<StructureSpec> = {}): void {
    const d = STRUCTURE_DEFAULTS[kind];
    this.ed.commitSite((s) => {
      (s.structures ??= []).push({ id: uid('st'), kind, name: d.name, x: at.x, z: at.z, rotDeg: 0, height: d.height, size: d.size, ...(kind === 'bridge' ? { length: d.length, style: 'beam' as const } : {}), ...extra });
    });
    this.pick.set({ t: 'structure', i: (this.ed.draft().structures?.length ?? 1) - 1 });
    this.tool.set('select');
    this.applyNow();
  }

  protected asStruct = (v: string): StructureKind => (this.structKinds.some((k) => k.id === v) ? (v as StructureKind) : 'chimney');
  protected styleOf = (e: Event): 'beam' | 'arch' => ((e.target as HTMLSelectElement).value === 'arch' ? 'arch' : 'beam');
  protected structLabel(k: StructureKind): string {
    if (k === 'shapes') return 'Object made of shapes';
    return this.structKinds.find((x) => x.id === k)?.label.replace(' (drag)', '') ?? k;
  }
  protected sizeLabel(k: StructureKind): string {
    return RECT_KINDS.includes(k) ? 'width' : k === 'lattice_tower' ? 'base half-width' : k === 'tower_crane' ? 'mast half-width' : k === 'water_tower' ? 'tank radius' : k === 'chimney' ? 'base radius' : 'radius';
  }

  protected setStruct(patch: Partial<StructureSpec>): void {
    const i = this.structI();
    this.ed.commitSite((s) => {
      const st = s.structures?.[i];
      if (st) Object.assign(st, patch);
    });
    this.applyNow();
  }

  protected readonly setArch = (l: LevelSpec, v: number): void => { l.vaultK = Math.min(1.3, Math.max(0.3, v)); };

  /** X positions (building-local) of the arch ribs of a greenhouse, for the plan drawing. */
  protected ribs(bd: BuildingSpec): number[] {
    const n = Math.max(2, Math.round(bd.length / 2.5));
    return Array.from({ length: n + 1 }, (_, i) => -bd.length / 2 + (i * bd.length) / n);
  }

  protected fenceDown(e: PointerEvent, i: number): void {
    const t = this.tool();
    if (this.pinMode() || t === 'building' || t === 'tree' || t === 'scatter' || t === 'terrain' || t === 'road' || t === 'surface' || t === 'water' || t === 'tunnel' || t === 'measure' || t === 'fence' || t === 'structure') return this.bgDown(e);
    e.stopPropagation();
    this.capture(e);
    this.pick.set({ t: 'fence', i });
  }

  protected fenceEndDown(e: PointerEvent, i: number, end: 0 | 1): void {
    e.stopPropagation();
    this.capture(e);
    this.drag.set({ t: 'fenceEnd', i, end });
  }

  protected voidDown(e: PointerEvent, i: number): void {
    e.stopPropagation();
    this.capture(e);
    this.pick.set({ t: 'void', i });
  }

  protected colDown(e: PointerEvent, i: number): void {
    e.stopPropagation();
    this.capture(e);
    const bd = this.b();
    const c = this.lvl()?.columns?.[i];
    if (!bd || !c) return;
    const l = this.toLocal(bd, this.toWorld(e));
    if (e.shiftKey) {
      const cur = this.colIdxs();
      const next = cur.includes(i) ? cur.filter((k) => k !== i) : [...cur, i];
      this.colSet.set(next);
      this.pick.set(next.length ? { t: 'column', i: next[next.length - 1]! } : { t: 'building' });
      return;
    }
    this.colSet.set([]);
    this.pick.set({ t: 'column', i });
    this.drag.set({ t: 'column', i, dx: c.x - bd.length / 2 - l.x, dz: c.z - bd.width / 2 - l.z });
  }

  /**
   * Column tool click: on an existing column it picks it up (drag to move it); elsewhere it places a new one exactly
   * where the ghost shows (snapped to the other columns / the grid), or says why it cannot.
   */
  private columnClick(bd: BuildingSpec, world: Pt): void {
    const li = Math.min(this.level(), bd.levels.length - 1);
    const l = this.toLocal(bd, world);
    const raw = { x: l.x + bd.length / 2, z: l.z + bd.width / 2 };
    const cols = bd.levels[li]?.columns ?? [];
    const near = cols.findIndex((c) => Math.hypot(c.x - raw.x, c.z - raw.z) <= Math.max(0.5, c.size / 2 + 0.2));
    if (near >= 0) {
      const c = cols[near]!;
      this.pick.set({ t: 'column', i: near });
      this.drag.set({ t: 'column', i: near, dx: c.x - bd.length / 2 - l.x, dz: c.z - bd.width / 2 - l.z });
      return;
    }
    const p = placeColumn(bd, li, raw, { tol: 10 / this.ppm() });
    if (!p.valid) {
      this.toast.show(insideBuilding(bd, { x: p.x - bd.length / 2, z: p.z - bd.width / 2 }) ? 'Not there: it is in a void or on another column.' : 'Place the column inside the building.');
      return;
    }
    let idx = 0;
    const shape = this.colShape() === 'round', size = this.colSize();
    this.ed.commitSite((s) => {
      const lev = this.index(s, bd.id)?.levels[li];
      if (!lev) return;
      (lev.columns ??= []).push({ x: p.x, z: p.z, size, ...(shape ? { round: true } : {}) });
      idx = lev.columns.length - 1;
    });
    this.pick.set({ t: 'column', i: idx });
    this.applyNow();
  }

  /** Stairs / ramp on the current floor, aligned with the building's own axes; optionally opens the floor above. */
  private placeStairsAt(bd: BuildingSpec): void {
    const g = this.ghost();
    if (!g || g.kind !== 'stairs') return;
    if (!g.valid) {
      this.toast.show('Place the stairs inside the building.');
      return;
    }
    const li = Math.min(this.level(), bd.levels.length - 1);
    const kind = this.stairsKind();
    const d = STRUCTURE_DEFAULTS[kind];
    const st = stairsFor(bd, li, { x: g.x, z: g.z }, kind, { length: d.length ?? 5, size: d.size, name: d.name });
    const { kind: _k, x, z, ...rest } = st.structure;
    this.placeStructure(kind, { x, z }, rest);
    if (st.voidAbove && this.stairwell()) {
      this.ed.commitSite((s) => {
        (this.index(s, bd.id)?.levels[li + 1]?.voids ?? (this.index(s, bd.id)!.levels[li + 1]!.voids = [])).push(st.voidAbove!);
      });
      this.applyNow();
    }
  }

  /** Join the building `bId` into `aId` (they must touch and point the same way). */
  private mergeInto(aId: string, bId: string): void {
    const probe = cloneSpec(this.ed.draft());
    const err = mergeBuildings(probe, aId, bId);
    if (err) {
      this.toast.show(`Cannot merge: ${err}.`);
      return;
    }
    this.ed.commitSite((s) => {
      mergeBuildings(s, aId, bId);
    });
    this.ed.select(aId);
    this.pick.set({ t: 'building' });
    this.tool.set('select');
    this.applyNow();
    this.toast.show('Buildings merged.');
  }

  protected wallDown(e: PointerEvent, i: number): void {
    e.stopPropagation();
    this.capture(e);
    this.pick.set({ t: 'wall', i });
  }

  protected frameRotDown(e: PointerEvent): void {
    e.stopPropagation();
    this.capture(e);
    this.drag.set({ t: 'frameRot' });
  }

  protected frameDown(e: PointerEvent, h: Handle): void {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.drag.set({ t: 'frame', h });
    e.preventDefault();
    e.stopPropagation();
  }

  private addOpeningAt(bd: BuildingSpec, world: Pt, kind: 'door' | 'window'): void {
    const li = Math.min(this.level(), bd.levels.length - 1);
    const l = this.toLocal(bd, world);
    let id: string | null = null;
    this.ed.commitSite((s) => {
      const x = this.index(s, bd.id);
      if (x) id = addOpening(x, li, l, kind, Math.max(3, 14 / this.ppm()));
    });
    if (!id) {
      this.ed.undo();
      this.toast.show('Click closer to a wall of this floor.');
      return;
    }
    this.pick.set({ t: 'opening', id });
    this.tool.set('select');
    this.applyNow();
  }

  private startWall(bd: BuildingSpec, world: Pt): void {
    const l = this.toLocal(bd, world);
    const a = { x: Math.min(bd.length, Math.max(0, snap(l.x + bd.length / 2, 0.5))), z: Math.min(bd.width, Math.max(0, snap(l.z + bd.width / 2, 0.5))) };
    this.drag.set({ t: 'wallDraw', a, b: { ...a } });
  }

  // ---- pointer: continuing / ending ----

  protected move(e: PointerEvent): void {
    const d = this.drag();
    if (!d) {
      if (this.placing() || this.tool() === 'terrain' || this.blocks.armed()) this.hover.set(this.toWorld(e)); // the ghost (and its guides) follow the pointer
      // measuring: after the first point, a live line follows the pointer
      if (this.tool() === 'measure') this.measure.hover.set(this.measure.point(this.toWorld(e)));
      return;
    }
    // a drag whose button was released elsewhere (a right-click menu, a lost pointer-up) must not keep following the pointer
    if (e.buttons === 0 && e.pointerType === 'mouse' && !this.world3d) {
      this.drag.set(null);
      this.dragPlacement.set(null);
      return;
    }
    const p = this.toWorld(e);
    const bd = this.b();
    const li = bd ? Math.min(this.level(), bd.levels.length - 1) : 0;
    switch (d.t) {
      case 'measMove':
      case 'measEnd':
        this.measure.dragTo(d, p);
        break;
      case 'frame': {
        // only the dragged edge / corner moves: the opposite side stays where it is on the map
        const host = this.wrapEl().nativeElement.getBoundingClientRect();
        const r = (this.rot() * Math.PI) / 180;
        const px = (e.clientX - (host.left + host.width / 2)) * this.mpp(), pz = (e.clientY - (host.top + host.height / 2)) * this.mpp();
        const u = px * Math.cos(r) + pz * Math.sin(r), v = -px * Math.sin(r) + pz * Math.cos(r); // pointer in the frame's axes
        const h0 = this.half(), o0 = this.off();
        let E = o0.u + h0.e, W = o0.u - h0.e, S = o0.v + h0.n, N = o0.v - h0.n;
        if (d.h.includes('e')) E = snap(u, 5);
        if (d.h.includes('w')) W = snap(u, 5);
        if (d.h.includes('s')) S = snap(v, 5);
        if (d.h.includes('n')) N = snap(v, 5);
        const he = clampHalf((E - W) / 2), hn = clampHalf((S - N) / 2);
        // keep the edge that was not dragged fixed even when the size is clamped
        const ou = d.h.includes('e') ? W + he : d.h.includes('w') ? E - he : o0.u;
        const ov = d.h.includes('s') ? N + hn : d.h.includes('n') ? S - hn : o0.v;
        this.half.set({ e: he, n: hn });
        this.off.set({ u: ou, v: ov });
        break;
      }
      case 'frameRot': {
        const f = this.fb();
        const host = this.wrapEl().nativeElement.getBoundingClientRect();
        const cx = host.left + f.l + f.w / 2, cy = host.top + f.t + f.h / 2;
        const ang = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI + 90;
        this.rot.set((((snap(ang, e.shiftKey ? 15 : 1) % 360) + 540) % 360) - 180);
        break;
      }
      case 'move': {
        if (!bd) break;
        // the magnet (Alt turns it off for this drag) pulls the building flush against close neighbours as it moves
        const probe: BuildingSpec = { ...bd, pos: { x: snap(d.ox + p.x - d.px, 0.5), z: snap(d.oz + p.z - d.pz, 0.5) } };
        const stuck = this.magnet() && !e.altKey ? autoAlign(probe, this.ed.draft().buildings, this.magnetReach()) : 0;
        this.magnetHit.set(stuck > 0);
        this.gesture((s) => {
          const x = this.index(s, bd.id);
          if (x) {
            x.pos = probe.pos;
            x.rotDeg = probe.rotDeg;
          }
        }, bd.id);
        break;
      }
      case 'resize': {
        if (!bd) break;
        const a = (bd.rotDeg * Math.PI) / 180;
        const ex = { x: Math.cos(a), z: Math.sin(a) }, ez = { x: -Math.sin(a), z: Math.cos(a) };
        const rx = p.x - d.ax, rz = p.z - d.az;
        const Lm = Math.max(2, snap(d.sx * (rx * ex.x + rz * ex.z), 0.5));
        const Wm = Math.max(2, snap(d.sz * (rx * ez.x + rz * ez.z), 0.5));
        this.gesture((s) => {
          const x = this.index(s, bd.id);
          if (!x) return;
          x.length = Lm;
          x.width = Wm;
          x.pos = { x: d.ax + ex.x * d.sx * Lm / 2 + ez.x * d.sz * Wm / 2, z: d.az + ex.z * d.sx * Lm / 2 + ez.z * d.sz * Wm / 2 };
        }, bd.id);
        break;
      }
      case 'rotate': {
        if (!bd) break;
        const ang = (Math.atan2(p.z - bd.pos.z, p.x - bd.pos.x) * 180) / Math.PI + 90;
        let rot = ((snap(ang, e.shiftKey ? 15 : 1) % 360) + 360) % 360;
        if (this.magnet() && !e.shiftKey && !e.altKey) {
          const near = this.ed.draft().buildings.filter((o) => o.id !== bd.id && Math.hypot(o.pos.x - bd.pos.x, o.pos.z - bd.pos.z) < 80);
          const m = magnetAngle(rot, near);
          this.magnetHit.set(m !== rot || rot % 90 === 0);
          rot = m;
        }
        this.gesture((s) => {
          const x = this.index(s, bd.id);
          if (x) x.rotDeg = rot;
        }, bd.id);
        break;
      }
      case 'edge': {
        const l = this.toLocal(d.start, p);
        const t = snap(d.axis === 'x' ? l.z : l.x, 0.5);
        const delta = t - d.at;
        if (Math.abs(delta) < 0.25) break;
        const outward = delta * d.n > 0;
        const lo = Math.min(d.at, t), hi = Math.max(d.at, t);
        const rect: Rect = d.axis === 'x' ? { x0: d.from, x1: d.to, z0: lo, z1: hi } : { x0: lo, x1: hi, z0: d.from, z1: d.to };
        const next = cloneSpec({ ...this.ed.draft(), buildings: [d.start] }).buildings[0]!;
        if (!reshapeBuilding(next, rect, outward ? 'add' : 'cut')) break;
        this.gesture((s) => {
          const i = s.buildings.findIndex((x) => x.id === d.start.id);
          if (i >= 0) s.buildings[i] = next;
        }, d.start.id);
        break;
      }
      case 'tree':
        this.gesture((s) => {
          const t = s.trees[d.i];
          if (t) {
            t.x = p.x + d.dx;
            t.z = p.z + d.dz;
          }
        });
        break;
      case 'open':
      case 'openEnd': {
        if (!bd) break;
        const l = this.toLocal(bd, p);
        const o = this.openings().find((x) => x.id === d.id);
        if (!o) break;
        const along = o.axis === 'x' ? l.x : l.z;
        this.gesture((s) => {
          const x = this.index(s, bd.id);
          if (!x) return;
          if (d.t === 'open') moveOpening(x, li, d.id, along);
          else resizeOpening(x, li, d.id, d.end, along);
        });
        break;
      }
      case 'bridgeDraw':
        this.drag.set({ ...d, b: { x: snap(p.x, 0.5), z: snap(p.z, 0.5) } });
        break;
      case 'structMove':
        this.gesture((s) => {
          const st = s.structures?.[d.i];
          if (st) {
            st.x = snap(p.x + d.dx, 0.5);
            st.z = snap(p.z + d.dz, 0.5);
          }
        });
        break;
      case 'structRot': {
        const st = this.ed.draft().structures?.[d.i];
        if (!st) break;
        const ang = (Math.atan2(p.z - st.z, p.x - st.x) * 180) / Math.PI + 90;
        const rot = ((snap(ang, e.shiftKey ? 15 : 1) % 360) + 360) % 360;
        this.gesture((s) => {
          const x = s.structures?.[d.i];
          if (x) x.rotDeg = rot;
        });
        break;
      }
      case 'under':
        this.drag.set({ ...d, b: { x: snap(p.x, 0.5), z: snap(p.z, 0.5) } });
        break;
      case 'layer': {
        const last = d.pts[d.pts.length - 1]!;
        if (Math.hypot(p.x - last.x, p.z - last.z) * this.ppm() >= 4) this.drag.set({ ...d, pts: [...d.pts, p] });
        break;
      }
      case 'terrain': {
        const op = this.terrain.op();
        this.hover.set(p);
        if (op === 'hill' || op === 'crater') break;
        const last = d.pts[d.pts.length - 1]!;
        if (op === 'ramp') this.drag.set({ ...d, pts: [d.pts[0]!, p] });
        else if (Math.hypot(p.x - last.x, p.z - last.z) >= Math.max(0.5, this.terrain.radius() / 4)) this.drag.set({ ...d, pts: [...d.pts, p] });
        break;
      }
      case 'scatter': {
        const last = d.pts[d.pts.length - 1]!;
        const mode = this.scatterMode();
        if (mode === 'rect' || mode === 'circle') this.drag.set({ t: 'scatter', pts: [d.pts[0]!, { x: p.x, z: p.z }] });
        else if (Math.hypot(p.x - last.x, p.z - last.z) >= 1) this.drag.set({ t: 'scatter', pts: [...d.pts, { x: p.x, z: p.z }] });
        break;
      }
      case 'fenceDraw':
        this.drag.set({ ...d, b: { x: snap(p.x, 0.5), z: snap(p.z, 0.5) } });
        break;
      case 'layerPt':
        this.gesture((s) => this.layers.movePoint(s, d, p));
        break;
      case 'fenceEnd':
        this.gesture((s) => {
          const w = s.walls?.[d.i];
          if (w) w[d.end === 0 ? 'a' : 'b'] = { x: snap(p.x, 0.5), z: snap(p.z, 0.5) };
        });
        break;
      case 'voidDraw': {
        if (!bd) break;
        const l = this.toLocal(bd, p);
        this.drag.set({ ...d, b: { x: Math.min(bd.length, Math.max(0, snap(l.x + bd.length / 2, 0.5))), z: Math.min(bd.width, Math.max(0, snap(l.z + bd.width / 2, 0.5))) } });
        break;
      }
      case 'pan': {
        this.map?.panBy([d.x - e.clientX, d.y - e.clientY], { animate: false });
        this.drag.set({ t: 'pan', x: e.clientX, y: e.clientY });
        break;
      }
      case 'selArea': {
        const last = d.pts[d.pts.length - 1]!;
        if (this.selShape() === 'box') this.drag.set({ ...d, pts: [d.pts[0]!, p] });
        else if (Math.hypot(p.x - last.x, p.z - last.z) * this.ppm() >= 4) this.drag.set({ ...d, pts: [...d.pts, p] });
        break;
      }
      case 'column': {
        if (!bd) break;
        const l = this.toLocal(bd, p);
        const pl = placeColumn(bd, li, { x: l.x + d.dx + bd.length / 2, z: l.z + d.dz + bd.width / 2 }, { ignore: d.i, tol: 10 / this.ppm() });
        this.dragPlacement.set(pl);
        if (!pl.valid) break; // do not drop it in a void or outside: it stays at the last good spot
        this.gesture((s) => {
          const c = this.index(s, bd.id)?.levels[li]?.columns?.[d.i];
          if (c) {
            c.x = pl.x;
            c.z = pl.z;
          }
        });
        break;
      }
      case 'draw':
        this.drag.set({ ...d, x1: snap(p.x, 1), z1: snap(p.z, 1) });
        break;
      case 'shape': {
        if (!bd) break;
        const l = this.toLocal(bd, p);
        this.drag.set({ ...d, b: { x: snap(l.x, 0.5), z: snap(l.z, 0.5) } });
        break;
      }
      case 'wallDraw': {
        if (!bd) break;
        const l = this.toLocal(bd, p);
        this.drag.set({ ...d, b: { x: Math.min(bd.length, Math.max(0, snap(l.x + bd.length / 2, 0.5))), z: Math.min(bd.width, Math.max(0, snap(l.z + bd.width / 2, 0.5))) } });
        break;
      }
    }
  }

  /** First movement of a gesture opens one undo step; every move edits the draft live (3D follows on release). */
  private gesture(fn: (s: SiteSpec) => void, guardId?: string): void {
    if (guardId) {
      // buildings may not overlap: a move / resize / rotate that would make them do so is simply not applied
      const probe = cloneSpec(this.ed.draft());
      fn(probe);
      if (overlapsOthers(probe, guardId)) {
        if (!this.warned) this.toast.show('Buildings cannot overlap.');
        this.warned = true;
        return;
      }
    }
    if (!this.gestureStarted) {
      this.ed.beginGesture();
      this.gestureStarted = true;
    }
    this.ed.live(fn);
  }

  /** End of a box / lasso: indoors it selects columns of the floor, outdoors trees. Shift (or a Shift start) adds. */
  private finishSelArea(d: { pts: Pt[]; add: boolean }, shift: boolean): void {
    const area = this.selShape() === 'lasso' ? d.pts : this.selAreaOf(d.pts);
    const add = d.add || shift;
    const bd = this.b();
    if (this.indoor() && bd) {
      const hit = pointsInside(this.columnsWorld(bd), area);
      const next = add ? [...new Set([...this.colIdxs(), ...hit])] : hit;
      this.colSet.set(next);
      this.pick.set(next.length ? { t: 'column', i: next[next.length - 1]! } : { t: 'building' });
      if (hit.length > 1) this.toast.show(`${hit.length} columns selected. Duplicate repeats the group; Fill floor continues its grid.`);
      return;
    }
    const hit = pointsInside(this.ed.draft().trees, area);
    const next = add ? [...new Set([...this.treeIdxs(), ...hit])] : hit;
    this.treeSet.set(next);
    this.pick.set(next.length ? { t: 'tree', i: next[next.length - 1]! } : null);
    if (hit.length) this.toast.show(`${next.length} trees selected. Delete removes them; the inspector changes them all.`);
  }

  /** The four corners of a box dragged from the first to the last point (square to the edited building indoors). */
  private selAreaOf(pts: Pt[]): Pt[] {
    const a = pts[0]!, b = pts[pts.length - 1]!;
    const bd = this.indoor() ? this.b() : null;
    if (!bd) return [a, { x: b.x, z: a.z }, b, { x: a.x, z: b.z }];
    const la = this.toLocal(bd, a), lb = this.toLocal(bd, b);
    return [la, { x: lb.x, z: la.z }, lb, { x: la.x, z: lb.z }].map((l) => this.fromLocal(bd, l));
  }

  protected up(e: PointerEvent): void {
    const d = this.drag();
    this.drag.set(null);
    this.magnetHit.set(false);
    this.dragPlacement.set(null);
    (e.currentTarget as Element | null)?.releasePointerCapture?.(e.pointerId);
    if (!d) return;
    const bd = this.b();
    if (d.t === 'bridgeDraw') {
      const len = Math.hypot(d.b.x - d.a.x, d.b.z - d.a.z);
      if (len >= 6) this.placeStructure('bridge', { x: (d.a.x + d.b.x) / 2, z: (d.a.z + d.b.z) / 2 }, { length: Math.round(len), rotDeg: Math.round((Math.atan2(d.b.z - d.a.z, d.b.x - d.a.x) * 180) / Math.PI) });
    } else if (d.t === 'selArea') {
      this.finishSelArea(d, e.shiftKey);
    } else if (d.t === 'layer') {
      this.layers.commit(d.pts);
    } else if (d.t === 'under') {
      this.under.commit(d.a, d.b);
    } else if (d.t === 'terrain') {
      this.terrain.commit(d.pts, d.h0);
    } else if (d.t === 'scatter') {
      const poly = areaOf(this.scatterMode(), d.pts, this.scatterWidth());
      const live = this.ed.draft();
      const mix = this.treeMix();
      const made = scatterTrees(poly, live.trees, { spacing: this.scatterSpacing(), conifers: mix === 'c' ? 1 : mix === 'd' ? 0 : 0.4 }, (q) => nearBuilding(live.buildings, q));
      if (made.length) {
        this.ed.commitSite((s) => {
          s.trees.push(...made);
        });
        this.applyNow();
      }
      this.toast.show(made.length ? `${made.length} trees planted. Undo removes the whole stroke.` : 'No room for trees there (or the stroke was too short).');
    } else if (d.t === 'fenceDraw') {
      if (Math.hypot(d.b.x - d.a.x, d.b.z - d.a.z) >= 0.5) {
        this.ed.commitSite((s) => {
          (s.walls ??= []).push(newFence(d.a, d.b, this.fenceMat()));
        });
        this.pick.set({ t: 'fence', i: (this.ed.draft().walls?.length ?? 1) - 1 });
        this.applyNow();
      }
    } else if (d.t === 'voidDraw' && bd) {
      const x0 = Math.min(d.a.x, d.b.x), x1 = Math.max(d.a.x, d.b.x), z0 = Math.min(d.a.z, d.b.z), z1 = Math.max(d.a.z, d.b.z);
      if (x1 - x0 >= 0.5 && z1 - z0 >= 0.5) {
        const li = Math.min(this.level(), bd.levels.length - 1);
        let idx = 0;
        this.ed.commitSite((s) => {
          const lev = this.index(s, bd.id)?.levels[li];
          if (!lev) return;
          (lev.voids ??= []).push({ x0, z0, x1, z1, water: li === 0 ? false : undefined });
          idx = lev.voids.length - 1;
        });
        this.pick.set({ t: 'void', i: idx });
        this.applyNow();
      }
    } else if (d.t === 'draw') {
      const w = Math.abs(d.x1 - d.x0), h = Math.abs(d.z1 - d.z0);
      const ghost: BuildingSpec = { id: '~', name: '', pos: { x: (d.x0 + d.x1) / 2, z: (d.z0 + d.z1) / 2 }, rotDeg: 0, length: w, width: h, levels: [] };
      if (w >= 3 && h >= 3 && this.autoAlign()) {
        const n = autoAlign(ghost, this.ed.draft().buildings);
        if (n) this.toast.show(`Aligned to ${n} neighbouring building${n > 1 ? 's' : ''}.`);
      }
      if (w >= 3 && h >= 3 && this.ed.draft().buildings.some((o) => buildingsOverlap(ghost, o))) this.toast.show('Buildings cannot overlap: draw it on free ground (use Merge to join them).');
      else if (w >= 3 && h >= 3) {
        const preset: Partial<BuildingSpec> = this.buildKind() === 'greenhouse'
          ? { name: 'Greenhouse', frame: 'greenhouse', color: '#9ec1b6', levels: [{ baseY: 0, height: 2.4, sides: { n: false, s: false, e: false, w: false }, doors: {}, partitions: [], roof: 'vault', roofRise: 0, vaultK: 0.7 }] }
          : { name: `Building ${this.ed.draft().buildings.length + 1}` };
        const gh = this.buildKind() === 'greenhouse'; // a greenhouse tunnel always runs along its long side
        this.ed.addBuilding({ pos: { ...ghost.pos }, length: gh ? Math.max(w, h) : w, width: gh ? Math.min(w, h) : h, rotDeg: (ghost.rotDeg + (gh && h > w ? 90 : 0)) % 360, ...preset });
        this.pick.set({ t: 'building' });
        this.tool.set('select');
        this.applyNow();
      }
    } else if (d.t === 'shape' && bd) {
      const rect: Rect = { x0: d.a.x, z0: d.a.z, x1: d.b.x, z1: d.b.z };
      if (Math.abs(rect.x1 - rect.x0) >= 0.5 && Math.abs(rect.z1 - rect.z0) >= 0.5) {
        const probe = cloneSpec({ ...this.ed.draft(), buildings: [bd] }).buildings[0]!;
        const whole = cloneSpec(this.ed.draft());
        const fits = reshapeBuilding(probe, rect, d.op);
        const wi = whole.buildings.findIndex((x) => x.id === bd.id);
        if (fits && wi >= 0) whole.buildings[wi] = probe;
        if (!fits) this.toast.show(d.op === 'cut' ? 'That cut would split the building or leave a hole.' : 'The wing has to touch the building.');
        else if (overlapsOthers(whole, bd.id)) this.toast.show('That wing would overlap another building.');
        else {
          this.ed.commitSite((s) => {
            const x = this.index(s, bd.id);
            if (x) reshapeBuilding(x, rect, d.op);
          });
          this.applyNow();
        }
      }
    } else if (d.t === 'wallDraw' && bd) {
      if (Math.hypot(d.b.x - d.a.x, d.b.z - d.a.z) >= 0.5) {
        const li = Math.min(this.level(), bd.levels.length - 1);
        this.ed.commitSite((s) => {
          this.index(s, bd.id)?.levels[li]?.partitions.push([d.a, d.b]);
        });
        this.applyNow();
      }
    } else if (d.t !== 'frame' && d.t !== 'frameRot' && this.gestureStarted) this.applyNow();
    this.gestureStarted = false;
  }

  protected wheel(e: WheelEvent): void {
    // the overlay swallows wheel events over the model: forward them to the map as a zoom around the pointer
    e.preventDefault();
    const map = this.map;
    if (!map) return;
    const r = this.wrapEl().nativeElement.getBoundingClientRect();
    map.setZoomAround(L.point(e.clientX - r.left, e.clientY - r.top), Math.min(21, Math.max(15, map.getZoom() - Math.sign(e.deltaY) * 0.5)), { animate: false });
  }

  // ---- right-click menu: what it offers depends on what is under the pointer ----

  protected readonly ctx = signal<{ x: number; y: number; items: CtxItem[] } | null>(null);
  protected closeMenus(): void {
    this.ctx.set(null);
    this.fly.set(null);
  }
  protected runCtx(it: CtxItem): void {
    this.ctx.set(null);
    it.act?.();
  }

  protected onContext(e: MouseEvent): void {
    e.preventDefault();
    if (this.mode() !== 'model' || this.view3d()) return;
    const t = e.target as Element;
    if (t.closest('.palette, .ctx, .opts, app-float-box')) return;
    this.fly.set(null);
    if (this.tool() === 'measure' && this.measure.chain().a) {
      // a right click while measuring just ends the chain
      this.measure.endChain();
      return;
    }
    const items = this.ctxItems(t.closest('[data-pk]')?.getAttribute('data-pk') ?? '', this.toWorld(e));
    if (!items.length) return;
    const r = this.wrapEl().nativeElement.getBoundingClientRect();
    this.ctx.set({ x: Math.max(4, Math.min(e.clientX - r.left, r.width - 190)), y: Math.max(4, Math.min(e.clientY - r.top, r.height - 12 - items.length * 28)), items });
  }

  /** Select what was right-clicked (without dragging it), then list what can be done with it. */
  private ctxItems(pk: string, p: Pt): CtxItem[] {
    const [kind, id = ''] = pk.split(':');
    const n = Number(id);
    const del: CtxItem = { label: 'Delete', danger: true, act: () => this.deleteSel() };
    const head = (label: string): CtxItem => ({ label, head: true });
    const sep: CtxItem = { label: '', sep: true };
    switch (kind) {
      case 'building': {
        if (this.ed.selectedId() !== id) {
          this.ed.select(id);
          this.level.set(0);
          if (this.indoor()) this.enterIndoor();
        }
        this.pick.set({ t: 'building' });
        const bd = this.b();
        if (!bd) return [];
        return [
          head(bd.name || 'Building'),
          this.indoor() ? { label: 'Exit indoors', act: () => this.exitIndoor() } : { label: 'Edit indoors', act: () => bd.frame || this.enterIndoor() },
          { label: 'Duplicate', act: () => this.duplicate() },
          { label: 'Rotate 90°', act: () => this.mutate(this.setRot, (bd.rotDeg + 90) % 360) },
          ...this.byCoords('Move its centre to coordinates…', (q) => this.ed.commitSite((s) => void (s.buildings.find((x) => x.id === bd.id)!.pos = q))),
          sep,
          del,
        ];
      }
      case 'tree':
        if (!this.treeIdxs().includes(n)) this.treeSet.set([]);
        this.pick.set({ t: 'tree', i: n });
        return [head(this.treeIdxs().length > 1 ? `${this.treeIdxs().length} trees` : 'Tree'), ...(this.treeIdxs().length > 1 ? [] : this.byCoords('Move to coordinates…', (q) => this.ed.commitSite((s) => void Object.assign(s.trees[n]!, q)))), del];
      case 'structure':
        this.pick.set({ t: 'structure', i: n });
        return [head('Structure'), { label: 'Duplicate', act: () => this.duplicateStruct() }, ...this.byCoords('Move to coordinates…', (q) => this.ed.commitSite((s) => void Object.assign(s.structures![n]!, q))), sep, del];
      case 'fence':
        this.pick.set({ t: 'fence', i: n });
        return [head('Fence'), del];
      case 'road':
        this.pick.set({ t: 'road', i: n });
        return [head(roadDef(this.ed.draft().roads?.[n]?.kind).label), del];
      case 'surface':
        this.pick.set({ t: 'surface', i: n });
        return [head(surfaceDef(this.ed.draft().surfaces?.[n]?.kind).label), del];
      case 'water':
        this.pick.set({ t: 'water', i: n });
        return [head('Water'), del];
      case 'under':
        this.pick.set({ t: 'under', i: n });
        return [head(this.ed.draft().underground?.[n]?.name ?? 'Underground'), del];
      case 'wall':
        this.pick.set({ t: 'wall', i: n });
        return [head('Interior wall'), del];
      case 'void':
        this.pick.set({ t: 'void', i: n });
        return [head('Void'), del];
      case 'opening':
        this.pick.set({ t: 'opening', id });
        return [head('Door / window'), del];
      case 'col':
        if (!this.colIdxs().includes(n)) this.colSet.set([n]);
        this.pick.set({ t: 'column', i: n });
        return [
          head(this.colIdxs().length > 1 ? `${this.colIdxs().length} columns` : 'Column'),
          { label: 'Select its row (east–west)', act: () => this.selectColumns('x') },
          { label: 'Select its line (north–south)', act: () => this.selectColumns('z') },
          { label: 'Select all alike', act: () => this.selectColumns('grid') },
          { label: 'Duplicate', act: () => this.colDup() },
          sep,
          del,
        ];
      case 'meas':
        this.measure.sel.set(n);
        return [head('Measure'), { label: 'Delete this measure', danger: true, act: () => this.measure.delete() }, { label: 'Clear all measures', act: () => this.measure.clear() }];
      default: {
        const tool = (label: string, t: Tool): CtxItem => ({ label, act: () => this.setTool(t) });
        if (this.indoor()) {
          return [head(`Floor ${this.levelName(this.level())}`), tool('Draw a wall', 'wall'), tool('Place columns', 'column'), tool('Add a door', 'door'), tool('Add a window', 'window'), tool('Cut a void', 'void'), sep, { label: 'Exit indoors', act: () => this.exitIndoor() }];
        }
        const q = { x: snap(p.x, 1), z: snap(p.z, 1) };
        return [
          head('Ground'),
          { label: 'New building here', act: () => this.newBuildingAt(q) },
          { label: 'Plant a tree here', act: () => { this.ed.addTree(snap(p.x, 0.5), snap(p.z, 0.5), this.newTreeKind()); this.applyNow(); } },
          tool('Scatter trees…', 'scatter'),
          tool('Draw a fence', 'fence'),
          { label: 'Measure from here', act: () => { this.setTool('measure'); this.measure.startAt(p); } },
          ...this.byCoords('New building at coordinates…', (q) => this.newBuildingAt(q)),
          ...(this.hasPlace() ? [{ label: 'Copy the coordinates of this point', act: () => this.copyCoords(p) }] : []),
          sep,
          tool('Select tool', 'select'),
        ];
      }
    }
  }

  /** The bando has a real place, drawn north-up (old rotated bandos are not): coordinates mean something here. */
  private readonly hasPlace = computed(() => !this.placeHidden() && this.ed.draft().bearingDeg === 0);

  /** A menu entry that asks for coordinates and hands the point (bando metres) to `use`, then rebuilds; none without a place. */
  private byCoords(label: string, use: (q: Pt) => void): CtxItem[] {
    if (!this.hasPlace()) return [];
    return [
      {
        label,
        act: () => {
          const text = prompt(tr('Coordinates: latitude, longitude (45.6469, 12.3002 or 45°38\'49"N 12°18\'01"E)'));
          if (text === null) return;
          const g = parseLatLon(text);
          if (!g) return void this.toast.show('Those are not coordinates: latitude, longitude, e.g. 45.6469, 12.3002.');
          const q = siteFromLatLon(this.ed.draft().origin, g);
          if (Math.max(Math.abs(q.x), Math.abs(q.z)) > this.ed.draft().extent + 500) return void this.toast.show('That point is far outside this bando.');
          use(q);
          this.applyNow();
        },
      },
    ];
  }

  private copyCoords(p: Pt): void {
    const t = latLonText(this.ed.draft().origin, p);
    void navigator.clipboard?.writeText(t).catch(() => undefined);
    this.toast.show(`${t} (copied)`);
  }

  /** A default 20 × 12 m building centred on `q`, if the ground is free. */
  private newBuildingAt(q: Pt): void {
    const ghost: BuildingSpec = { id: '~', name: '', pos: q, rotDeg: 0, length: 20, width: 12, levels: [] };
    if (this.ed.draft().buildings.some((o) => buildingsOverlap(ghost, o))) {
      this.toast.show('Buildings cannot overlap: right-click on free ground.');
      return;
    }
    this.ed.addBuilding({ pos: q, length: 20, width: 12, rotDeg: 0, name: `Building ${this.ed.draft().buildings.length + 1}` });
    this.pick.set({ t: 'building' });
    this.applyNow();
  }

  protected key(e: KeyboardEvent): void {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.tool() === 'measure') {
      e.preventDefault();
      this.measure.delete();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.deleteSel();
    } else if (e.key === 'Escape' && this.blocks.armed()) {
      this.blocks.armed.set(null);
    } else if (e.key === 'Escape') {
      this.tool.set('select');
      this.scene.pin.set(null);
      this.drag.set(null);
      this.zoneSel.set(null);
      this.measure.chain.update((m) => ({ ...m, a: null, start: null }));
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    }
  }

  // ---- inspector edits ----

  protected deleteSel(): void {
    if (this.mode() !== 'model') return;
    const p = this.pick();
    const bd = this.b();
    const li = bd ? Math.min(this.level(), bd.levels.length - 1) : 0;
    if (p?.t === 'tree') {
      const gone = [...this.treeIdxs()].sort((x, y) => y - x);
      this.ed.commitSite((s) => gone.forEach((k) => void s.trees.splice(k, 1)));
      this.treeSet.set([]);
    }
    else if (p?.t === 'structure') this.ed.commitSite((s) => void s.structures?.splice(p.i, 1));
    else if (p?.t === 'fence') this.ed.commitSite((s) => void s.walls?.splice(p.i, 1));
    else if (p?.t === 'road') this.ed.commitSite((s) => void s.roads?.splice(p.i, 1));
    else if (p?.t === 'surface') this.ed.commitSite((s) => void s.surfaces?.splice(p.i, 1));
    else if (p?.t === 'water') this.ed.commitSite((s) => void s.waters?.splice(p.i, 1));
    else if (p?.t === 'under') this.ed.commitSite((s) => void s.underground?.splice(p.i, 1));
    else if (p?.t === 'void' && bd) this.ed.commitSite((s) => void this.index(s, bd.id)?.levels[li]?.voids?.splice(p.i, 1));
    else if (p?.t === 'column' && bd) {
      const gone = [...this.colIdxs()].sort((x, y) => y - x);
      this.ed.commitSite((s) => gone.forEach((k) => void this.index(s, bd.id)?.levels[li]?.columns?.splice(k, 1)));
      this.colSet.set([]);
    }
    else if (p?.t === 'opening' && bd) {
      this.ed.commitSite((s) => {
        const x = this.index(s, bd.id);
        if (x) removeOpening(x, li, p.id);
      });
    } else if (p?.t === 'wall' && bd) this.ed.removePartition(li, p.i);
    else if (bd && p?.t === 'building') {
      if (this.indoor()) this.exitIndoor();
      this.ed.removeBuilding(bd.id);
    } else return;
    this.pick.set(null);
    this.applyNow();
  }

  protected duplicate(): void {
    this.ed.duplicateSelected();
    this.applyNow();
  }

  /** Edit the selected building (one undo step) and refresh the 3D model. */
  protected mutate<T>(fn: (b: BuildingSpec, v: T) => void, v: T): void {
    const id = this.ed.selectedId();
    this.ed.commitSite((s) => {
      const x = this.index(s, id);
      if (x) fn(x, v);
    });
    this.applyNow();
  }

  /** The Modules section: every pattern block of the library (catalogue and own), with its values per block. */
  protected readonly patternBlocks = computed(() => this.blockLib.all().filter((b) => b.kind === 'pattern'));
  protected readonly modValues = signal<Record<string, Record<string, ParamValue>>>({});
  protected modValue = (b: BlockSpec, key: string): ParamValue => paramValues(b, this.modValues()[b.id])[key]!;
  protected setModValue(id: string, key: string, v: ParamValue): void {
    this.modValues.update((m) => ({ ...m, [id]: { ...m[id], [key]: v } }));
  }
  protected selValue = (e: Event): string => (e.target as HTMLSelectElement).value;
  /** Façade and store patterns work on rectangular buildings only. */
  protected needsRect = (b: BlockSpec): boolean => !!(b.content.pattern?.facade || b.content.pattern?.store);
  protected sideLabel = (o: string): string => ({ all: 'all walls', n: 'north', s: 'south', e: 'east', w: 'west' })[o] ?? o;

  protected readonly setName = (b: BuildingSpec, v: string): void => { b.name = v; };
  protected readonly setLength = (b: BuildingSpec, v: number): void => { b.length = Math.max(2, v); };
  protected readonly setWidth = (b: BuildingSpec, v: number): void => { b.width = Math.max(2, v); };
  protected readonly setRot = (b: BuildingSpec, v: number): void => { b.rotDeg = v; };
  /** The four walls of a rectangular building, as `LevelSpec.sides` names them. */
  protected readonly wallSides = [
    { k: 'n' as const, label: 'north', short: 'N' },
    { k: 's' as const, label: 'south', short: 'S' },
    { k: 'e' as const, label: 'east', short: 'E' },
    { k: 'w' as const, label: 'west', short: 'W' },
  ];
  protected rawNum = (e: Event): number | null => {
    const v = (e.target as HTMLInputElement).value.trim();
    return v === '' ? null : Number(v);
  };
  /** One wall's own ruin (percent); empty removes it and the wall follows the building again. */
  protected readonly setWallRuin =
    (k: 'n' | 's' | 'e' | 'w') =>
    (b: BuildingSpec, pct: number | null): void => {
      const walls = { ...b.ruinWalls };
      if (pct === null || !isFinite(pct)) delete walls[k];
      else walls[k] = Math.min(1, Math.max(0, pct / 100));
      if (Object.keys(walls).length) b.ruinWalls = walls;
      else delete b.ruinWalls;
    };
  /** A greenhouse keeps its glass unless told otherwise (the field only exists when it is off). */
  protected readonly setGlass = (b: BuildingSpec, on: boolean): void => {
    if (on) delete b.glass;
    else b.glass = false;
  };
    /** A yes / no property of a building: set, or removed when off (old bandos stay as they were). */
  protected readonly setFlag =
    (key: 'roofless' | 'crenels') =>
    (b: BuildingSpec, on: boolean): void => {
      if (on) b[key] = true;
      else delete b[key];
    };
    /** 0 = intact (the field is removed); otherwise how ruined, as a fraction. */
  protected readonly setRuin = (b: BuildingSpec, pct: number): void => {
    if (pct > 0) b.ruin = Math.min(1, pct / 100);
    else delete b.ruin;
  };
    /** 0 removes the basement; otherwise its inside height (2 – 12 m). */
  protected readonly setBasement = (b: BuildingSpec, v: number): void => {
    if (v > 0) b.basement = { height: Math.min(12, Math.max(2, v)) };
    else delete b.basement;
  };
  protected readonly toRectangle = (b: BuildingSpec): void => resetToRect(b);

  protected setOpening(patch: Partial<{ kind: 'door' | 'window'; w: number; h: number; sill: number; c: number; closed: boolean }>): void {
    const id = this.openId();
    if (!id) return;
    this.mutate((b) => patchOpening(b, Math.min(this.level(), b.levels.length - 1), id, patch), 0);
  }

  protected setTree(patch: Partial<{ h: number; r: number; kind: 'd' | 'c' }>): void {
    const all = this.treeIdxs();
    if (!all.length) return;
    this.ed.commitSite((s) => {
      for (const i of all) {
        const t = s.trees[i];
        if (t) Object.assign(t, patch);
      }
    });
    this.applyNow();
  }

  protected fenceLen(w: { a: Pt; b: Pt }): number {
    return Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
  }

  protected setFenceMat(m: FenceMaterial): void {
    const i = this.fenceI();
    this.ed.commitSite((s) => {
      const w = s.walls?.[i];
      if (w) setFenceMaterial(w, m);
    });
    this.applyNow();
  }

  /** The species of a tree planted now: the chosen one, or a random pick for "Mixed". */
  private newTreeKind(): 'd' | 'c' {
    const m = this.treeMix();
    return m === 'mix' ? (Math.random() < 0.4 ? 'c' : 'd') : m;
  }

  protected setFence(patch: Partial<{ height: number; thick: number }>): void {
    const i = this.fenceI();
    this.ed.commitSite((s) => {
      const w = s.walls?.[i];
      if (w) Object.assign(w, patch);
    });
    this.applyNow();
  }

  protected setVoid(patch: { water?: boolean }): void {
    const i = this.voidI(), li = this.level();
    this.mutate((b) => Object.assign(b.levels[li]?.voids?.[i] ?? {}, patch), 0);
  }

  protected setColumn(patch: Partial<{ size: number; round: boolean; x: number; z: number }>): void {
    const i = this.colI(), li = this.level();
    this.mutate((b) => Object.assign(b.levels[li]?.columns?.[i] ?? {}, patch), 0);
  }

  protected removeFloor(): void {
    const li = this.level();
    this.ed.removeLevel(li);
    this.level.set(Math.max(0, Math.min(li, (this.b()?.levels.length ?? 1) - 1)));
    this.applyNow();
  }

  /** Edit the top floor (the roof lives there). */
  protected editTop<T>(fn: (l: LevelSpec, v: T) => void, v: T): void {
    const bd = this.b();
    if (!bd) return;
    this.ed.editSelectedLevel((l) => fn(l, v), bd.levels.length - 1);
    this.applyNow();
  }

  protected readonly setTurn = (l: LevelSpec, v: boolean): void => { l.roofTurn = v; };
  protected readonly setCount = (l: LevelSpec, v: number): void => { l.roofCount = Math.max(1, Math.min(12, Math.round(v))); delete l.vaultCount; };

  protected addLevel(): void {
    this.ed.addLevel();
    this.level.set((this.b()?.levels.length ?? 1) - 1);
    this.applyNow();
  }

  protected readonly setHeight = (l: LevelSpec, v: number): void => { l.height = Math.max(1, v); };
  protected readonly setRoof = (l: LevelSpec, v: LevelSpec['roof']): void => { l.roof = v; };

  protected editLevel<T>(fn: (l: LevelSpec, v: T) => void, v: T): void {
    this.ed.editSelectedLevel((l) => fn(l, v), this.level());
    this.applyNow();
  }

  protected kindOf = (e: Event): 'door' | 'window' => (selectedFrom(e) === 'window' ? 'window' : 'door');
  protected roofOf = (e: Event): LevelSpec['roof'] => selectedFrom(e) as LevelSpec['roof'];
}
