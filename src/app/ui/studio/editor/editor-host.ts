import type { Signal, WritableSignal } from '@angular/core';
import type { Pt } from '../../../core/footprint';
import type { SiteEditor } from '../../../core/site-editor';
import type { SiteGround } from '../../../core/site-ground';
import type { BuildingSpec, StructureSpec } from '../../../core/site-spec';
import type { SiteService } from '../../../services/site.service';
import type { ToastService } from '../../../services/toast.service';

/** The editor's tools, the selection and the drag in progress: shared by the editor and its tool controllers. */
export type Tool = 'select' | 'building' | 'structure' | 'stairs' | 'merge' | 'cut' | 'wing' | 'tree' | 'scatter' | 'fence' | 'door' | 'window' | 'wall' | 'void' | 'column' | 'measure' | 'terrain' | 'road' | 'surface' | 'water' | 'tunnel';
export type Pick = { t: 'building' } | { t: 'tree'; i: number } | { t: 'opening'; id: string } | { t: 'wall'; i: number } | { t: 'fence'; i: number } | { t: 'void'; i: number } | { t: 'column'; i: number } | { t: 'structure'; i: number } | { t: 'road'; i: number } | { t: 'surface'; i: number } | { t: 'water'; i: number } | { t: 'under'; i: number } | null;
export type Handle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
export type Drag =
  | { t: 'move'; ox: number; oz: number; px: number; pz: number }
  | { t: 'resize'; sx: number; sz: number; ax: number; az: number }
  | { t: 'rotate' }
  | { t: 'edge'; start: BuildingSpec; axis: 'x' | 'z'; at: number; from: number; to: number; n: 1 | -1 }
  | { t: 'tree'; i: number; dx: number; dz: number }
  | { t: 'open'; id: string }
  | { t: 'openEnd'; id: string; end: 0 | 1 }
  | { t: 'draw'; x0: number; z0: number; x1: number; z1: number }
  | { t: 'shape'; op: 'add' | 'cut'; a: Pt; b: Pt }
  | { t: 'wallDraw'; a: Pt; b: Pt }
  | { t: 'bridgeDraw'; a: Pt; b: Pt }
  | { t: 'structMove'; i: number; dx: number; dz: number }
  | { t: 'structRot'; i: number }
  | { t: 'fenceDraw'; a: Pt; b: Pt }
  | { t: 'scatter'; pts: Pt[] }
  | { t: 'terrain'; pts: Pt[]; h0: number }
  | { t: 'layer'; pts: Pt[] }
  | { t: 'layerPt'; kind: 'road' | 'surface' | 'water'; i: number; k: number }
  | { t: 'under'; a: Pt; b: Pt }
  | { t: 'fenceEnd'; i: number; end: 0 | 1 }
  | { t: 'voidDraw'; a: Pt; b: Pt }
  | { t: 'column'; i: number; dx: number; dz: number }
  | { t: 'selArea'; pts: Pt[]; add: boolean }
  | { t: 'pan'; x: number; y: number }
  | { t: 'measMove'; i: number; last: Pt }
  | { t: 'measEnd'; i: number; end: 0 | 1; old: Pt }
  | { t: 'frame'; h: Handle }
  | { t: 'frameRot' };

/**
 * What a tool controller needs from the editor: the draft, the selection, the drag, the scale and the ground, and a
 * few actions. Controllers keep a tool's own options and turn its finished drags into spec edits (one undo step).
 */
export interface EditorHost {
  readonly ed: SiteEditor;
  readonly site: SiteService;
  readonly toast: ToastService;
  readonly pick: WritableSignal<Pick>;
  readonly drag: WritableSignal<Drag | null>;
  readonly tool: Signal<Tool>;
  /** Screen pixels per metre. */
  readonly ppm: Signal<number>;
  /** The ground the editor shows: the draft's terrain. */
  readonly ground: Signal<SiteGround>;
  /** The site point under the pointer. */
  readonly hover: Signal<Pt | null>;
  readonly view3d: WritableSignal<boolean>;
  /** The floor being edited, and how it is labelled (G, L1 ...). */
  readonly level: Signal<number>;
  levelName(i: number): string;
  /** The column multi-selection. */
  readonly colSet: WritableSignal<number[]>;
  /** The selected structure. */
  readonly structSel: Signal<StructureSpec | null>;
  /** The selected building. */
  readonly building: Signal<BuildingSpec | null>;
  setTool(t: Tool): void;
  /** A tool's colour. */
  tc(id: Tool): string;
  /** Rebuild the 3D model from the draft now. */
  applyNow(): void;
  /** Keep the pointer on the plan until the button is released. */
  capture(e: PointerEvent): void;
  /** The site point under a pointer event. */
  toWorld(e: PointerEvent): Pt;
  /** A press on the empty plan (the active tool's gesture). */
  bgDown(e: PointerEvent): void;
}

/** Points as an SVG `points` list. */
export const polyPts = (pts: readonly Pt[]): string => pts.map((q) => `${q.x},${q.z}`).join(' ');
