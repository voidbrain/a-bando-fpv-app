import { computed, signal } from '@angular/core';
import type { Pt } from '../../../core/footprint';
import { ROADS, SURFACES, WATER_COLOR, insertPoint, layerShape, mergeWaters, pathLength, removePoint, roadDef, surfaceDef } from '../../../core/layers';
import type { RoadKind, RoadSpec, SurfaceKind } from '../../../core/site-spec';
import { defaultTerrain } from '../../../core/terrain';
import type { PickOption } from '../pick-menu';
import { polyPts, type EditorHost } from './editor-host';

const ROAD_ICON: Record<RoadKind, string> = { road: 'road', track: 'track', path: 'pathway', rail: 'rail' };
const SURFACE_ICON: Record<SurfaceKind, string> = { grass: 'grassland', asphalt: 'asphalt', concrete: 'concrete', gravel: 'gravel', dirt: 'dirt', sand: 'sand', rubble: 'rubble' };

/** The ground layers tools (Road, Surface, Water): their options, the line being drawn, and edits of the selected one. */
export class LayerTool {
  constructor(private readonly h: EditorHost) {}

  readonly roadKind = signal<RoadKind>('road');
  readonly roadWidth = signal(6);
  readonly surfaceKind = signal<SurfaceKind>('asphalt');
  readonly waterDepth = signal(1.5);
  /** Water is drawn as an outline (a pond) or along a centre line `waterWidth` wide (a canal). */
  readonly waterMode = signal<'outline' | 'line'>('outline');
  readonly waterWidth = signal(8);
  readonly roadOptions: readonly PickOption[] = ROADS.map((r) => ({ id: r.id, label: r.label, icon: ROAD_ICON[r.id], hint: `${r.width} m wide by default` }));
  readonly surfaceOptions: readonly PickOption[] = SURFACES.map((x) => ({ id: x.id, label: x.label, icon: SURFACE_ICON[x.id] }));
  readonly roadSurfaceOptions: readonly PickOption[] = [{ id: '', label: 'As its kind', icon: 'road' }, ...this.surfaceOptions];
  readonly asRoad = (v: string): RoadKind => roadDef(v as RoadKind).id;
  readonly asSurface = (v: string): SurfaceKind => surfaceDef(v as SurfaceKind).id;
  readonly roadColor = (r: RoadSpec): string => (r.surface ? surfaceDef(r.surface).color : roadDef(r.kind).color);
  readonly surfColor = (k: SurfaceKind): string => surfaceDef(k).color;
  readonly waterColor = WATER_COLOR;
  readonly roadLen = (r: RoadSpec): number => pathLength(r.pts);
  /** The line / outline being drawn with a layer tool. */
  readonly preview = computed(() => {
    const d = this.h.drag();
    return d?.t === 'layer' ? polyPts(d.pts) : '';
  });
  readonly roadSel = computed(() => {
    const p = this.h.pick();
    return p?.t === 'road' ? (this.h.ed.draft().roads?.[p.i] ?? null) : null;
  });
  readonly surfaceSel = computed(() => {
    const p = this.h.pick();
    return p?.t === 'surface' ? (this.h.ed.draft().surfaces?.[p.i] ?? null) : null;
  });
  readonly waterSel = computed(() => {
    const p = this.h.pick();
    return p?.t === 'water' ? (this.h.ed.draft().waters?.[p.i] ?? null) : null;
  });
  readonly isPicked = (t: 'road' | 'surface' | 'water', i: number): boolean => {
    const p = this.h.pick();
    return p?.t === t && p.i === i;
  };

  /** The points of the selected road / surface / water, for editing them one by one (with the Select tool, outdoors). */
  readonly editPts = computed(() => {
    const p = this.h.pick();
    if (this.h.tool() !== 'select' || (p?.t !== 'road' && p?.t !== 'surface' && p?.t !== 'water')) return null;
    const pts = (p.t === 'road' ? this.roadSel() : p.t === 'surface' ? this.surfaceSel() : this.waterSel())?.pts;
    return pts ? { kind: p.t, i: p.i, pts, closed: p.t !== 'road' } : null;
  });

  /** A press on a point: drag it; with Alt, remove it (an outline keeps 3 points, a road 2). */
  pointDown(e: PointerEvent, k: number): void {
    const ep = this.editPts();
    if (!ep) return;
    e.stopPropagation();
    if (e.altKey) {
      const next = removePoint(ep.pts, k, ep.closed ? 3 : 2);
      if (!next) return void this.h.toast.show(ep.closed ? 'An outline keeps at least 3 points.' : 'A road keeps at least 2 points.');
      this.setPts(ep.kind, ep.i, next);
      return;
    }
    this.h.capture(e);
    this.h.drag.set({ t: 'layerPt', kind: ep.kind, i: ep.i, k });
  }

  /** A double-click on the selected line or outline: a new point there (one undo step). */
  addPoint(e: MouseEvent): void {
    const ep = this.editPts();
    if (!ep) return;
    e.stopPropagation();
    const r = insertPoint(ep.pts, this.h.toWorld(e as PointerEvent), ep.closed);
    if (r) this.setPts(ep.kind, ep.i, r.pts);
  }

  /** A point being dragged (inside the drag's gesture: no undo step of its own). */
  movePoint(s: { roads?: { pts: Pt[] }[]; surfaces?: { pts: Pt[] }[]; waters?: { pts: Pt[] }[] }, d: { kind: 'road' | 'surface' | 'water'; i: number; k: number }, p: Pt): void {
    const list = d.kind === 'road' ? s.roads : d.kind === 'surface' ? s.surfaces : s.waters;
    const x = list?.[d.i];
    if (x?.pts[d.k]) x.pts[d.k] = { x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 };
  }

  private setPts(kind: 'road' | 'surface' | 'water', i: number, pts: Pt[]): void {
    this.h.ed.commitSite((s) => {
      const x = (kind === 'road' ? s.roads : kind === 'surface' ? s.surfaces : s.waters)?.[i];
      if (x) x.pts = pts;
    });
    this.h.applyNow();
  }

  setRoadKind(k: RoadKind): void {
    this.roadKind.set(k);
    this.roadWidth.set(roadDef(k).width);
  }

  /** A finished drag: a road along it, or a surface / water inside it (one undo step). */
  commit(raw: Pt[]): void {
    const { ed, toast, pick } = this.h;
    const t = this.h.tool();
    const kind = t === 'road' ? 'line' : t === 'water' && this.waterMode() === 'line' ? 'strip' : 'outline';
    const pts = layerShape(raw, kind, { tol: Math.max(0.3, 3 / this.h.ppm()), width: this.waterWidth() });
    if (typeof pts === 'string') return void toast.show(pts);
    if (t === 'road') {
      ed.commitSite((s) => void (s.roads ??= []).push({ pts, width: this.roadWidth(), kind: this.roadKind() }));
      pick.set({ t: 'road', i: (ed.draft().roads?.length ?? 1) - 1 });
    } else if (t === 'surface') {
      ed.commitSite((s) => void (s.surfaces ??= []).push({ pts, kind: this.surfaceKind() }));
      pick.set({ t: 'surface', i: (ed.draft().surfaces?.length ?? 1) - 1 });
    } else {
      ed.commitSite((s) => {
        s.terrain ??= defaultTerrain(s.extent); // a basin is dug into the ground: the ground must be a terrain
        (s.waters ??= []).push({ pts, depth: this.waterDepth() });
      });
      pick.set({ t: 'water', i: (ed.draft().waters?.length ?? 1) - 1 });
    }
    this.h.applyNow();
  }

  /** Join the selected water with the water it overlaps (one undo step). */
  mergeWater(): void {
    const p = this.h.pick();
    if (p?.t !== 'water') return;
    const r = mergeWaters(this.h.ed.draft().waters ?? [], p.i);
    if (!r) return void this.h.toast.show('It does not overlap or touch any other water.');
    this.h.ed.commitSite((s) => void (s.waters = r.waters));
    this.h.pick.set({ t: 'water', i: r.index });
    this.h.applyNow();
    this.h.toast.show('Water merged.');
  }

  /** Edit the selected road / surface / water (one undo step). */
  set(patch: { kind?: RoadKind | SurfaceKind; width?: number; surface?: SurfaceKind; depth?: number; level?: number }): void {
    const p = this.h.pick();
    if (p?.t !== 'road' && p?.t !== 'surface' && p?.t !== 'water') return;
    this.h.ed.commitSite((s) => {
      const list: object[] | undefined = p.t === 'road' ? s.roads : p.t === 'surface' ? s.surfaces : s.waters;
      const x = list?.[p.i] as Record<string, unknown> | undefined;
      if (!x) return;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete x[k];
        else x[k] = v;
      }
    });
    this.h.applyNow();
  }

  down(e: PointerEvent, t: 'road' | 'surface' | 'water', i: number): void {
    if (this.h.tool() !== 'select') return this.h.bgDown(e);
    e.stopPropagation();
    this.h.capture(e);
    this.h.pick.set({ t, i });
  }
}
