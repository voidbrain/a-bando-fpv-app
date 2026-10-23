import { Component, DestroyRef, ElementRef, afterNextRender, afterRenderEffect, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { uiResets } from '../../state/layout.store';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { contains, edgesOf, type Pt, type Rect } from '../../core/footprint';
import { buildingsOverlap, stairsFor, columnGrid, columnRow, convertBuilding, duplicateColumn, duplicateColumns, fillModule, mergeBuildings, overlapsOthers, repeatOpening } from '../../core/building-ops';
import { addOpening, insideBuilding, listOpenings, moveOpening, outlineOf, previewOpening, patchOpening, removeOpening, reshapeBuilding, resetToRect, resizeOpening, type OpenSeg } from '../../core/openings';
import { cloneSpec, uid, type BuildingSpec, type LevelSpec, type LocationInfo, type RoadKind, type RoadSpec, type SiteSpec, type StructureKind, type StructureSpec, type SurfaceKind, type UndergroundSpec } from '../../core/site-spec';
import { autoAlign, magnetAngle } from '../../core/align';
import { columnsInLine, pointsInside, treeZones } from '../../core/elements';
import { FENCES, fenceDef, newFence, setFenceMaterial, type FenceMaterial } from '../../core/fences';
import { areaCorners } from '../../core/areas';
import { ROADS, SURFACES, WATER_COLOR, roadDef, simplifyPath, surfaceDef } from '../../core/layers';
import { newTunnel, sectionProfile, tunnelAxis, tunnelOutline } from '../../core/underground';
import type { GroundStyle } from '../../three/site-model';
import { contourPaths, defaultTerrain, heightColor, heightRange, type Falloff, type TerrainOp, type TerrainStroke } from '../../core/terrain';
import { siteGround } from '../../core/site-ground';
import { PickMenu, type PickOption } from './pick-menu';
import { BlocksBox, type BlockArm } from './blocks-box';
import { applyPattern, detachInstance, paramValues, placeBlock, removeInstance, updateInstance, type BlockSpec, type ParamValue } from '../../core/blocks';
import { BlockLibraryService } from '../../services/block-library.service';
import { expandShapes, shapesFootprint } from '../../core/shapes';
import { anglesAt, arcOf, fmtLength, groundProfile, lengthOf, nearestSnap, orthoSnap, snapTargets, type Seg } from '../../core/measure';
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
import type { PreviewTarget } from '../../three/element-preview';

type Tool = 'select' | 'building' | 'structure' | 'stairs' | 'merge' | 'cut' | 'wing' | 'tree' | 'scatter' | 'fence' | 'door' | 'window' | 'wall' | 'void' | 'column' | 'measure' | 'terrain' | 'road' | 'surface' | 'water' | 'tunnel';
type Pick = { t: 'building' } | { t: 'tree'; i: number } | { t: 'opening'; id: string } | { t: 'wall'; i: number } | { t: 'fence'; i: number } | { t: 'void'; i: number } | { t: 'column'; i: number } | { t: 'structure'; i: number } | { t: 'road'; i: number } | { t: 'surface'; i: number } | { t: 'water'; i: number } | { t: 'under'; i: number } | null;
type Entry = { key: string; tool: Tool; mode?: ScatterMode; op?: TerrainOp; icon: string; name: string; color: string; hint: string; group: string; sep?: boolean };
type CtxItem = { label: string; act?: () => void; danger?: boolean; sep?: boolean; head?: boolean };
type Handle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
type Drag =
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

/** Tools that place something on the selected building: while one is active, a click puts the thing where the ghost is. */
const PLACE: readonly Tool[] = ['door', 'window', 'wall', 'void', 'column', 'stairs', 'cut', 'wing'];
const MIN_HALF = 20;
const M_LAT = 111132;
const snap = (v: number, step: number): number => Math.round(v / step) * step;
/** A screen position inside the editor, pixels from its top-left corner. */
type XY = { x: number; y: number };

const clampHalf = (v: number): number => Math.min(MAX_HALF_EXTENT, Math.max(MIN_HALF, v));
const STREET = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

/** The picture of each structure kind and fence material in the pickers (keys of TOOL_ICONS). */
const STRUCT_ICON: Record<StructureKind, string> = {
  chimney: 'chimney', silo: 'silo', tank: 'tank', water_tower: 'waterTower', lattice_tower: 'lattice', tower_crane: 'crane',
  bridge: 'bridge', stairs: 'stairs', ramp: 'ramp', container: 'container', car: 'car', truck: 'truck', excavator: 'excavator', shapes: 'blocks',
};
const ROAD_ICON: Record<RoadKind, string> = { road: 'road', track: 'track', path: 'pathway', rail: 'rail' };
const SURFACE_ICON: Record<SurfaceKind, string> = { grass: 'grassland', asphalt: 'asphalt', concrete: 'concrete', gravel: 'gravel', dirt: 'dirt', sand: 'sand', rubble: 'rubble' };
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
  template: `
    <div class="bar">
      <ng-content />
      <div class="seg">
        <button [class.on]="mode() === 'area'" [disabled]="placeHidden()" (click)="setMode('area')" [title]="placeHidden() ? 'This bando was shared without its place: there is no map area to edit' : ''">1 · Area</button>
        <button [class.on]="mode() === 'model'" [disabled]="!hasModel()" (click)="setMode('model')" [title]="hasModel() ? '' : 'Generate the model first'">2 · Model</button>
      </div>
      @if (mode() === 'model') {
        <div class="seg" title="2D edits the plan; 3D just looks around the whole bando">
          <button [class.on]="!view3d()" (click)="view3d.set(false)">2D</button>
          <button [class.on]="view3d()" (click)="setView3d()">3D</button>
        </div>
        @if (view3d()) {
          <label class="lay" title="Show the roofs in the 3D view"><input type="checkbox" [checked]="roofs3d()" (change)="roofs3d.set(checked($event))" /> roofs</label>
        }
        @if (ed.draft().terrain) {
          <label class="lay" title="How the ground is drawn: its own colours, coloured by height (also under the 2D plan), or as a wireframe (3D)">ground
            <select [value]="groundStyle()" (change)="groundStyle.set(asGroundStyle($event))">
              <option value="natural" [selected]="groundStyle() === 'natural'">natural</option>
              <option value="height" [selected]="groundStyle() === 'height'">height map</option>
              <option value="wire" [selected]="groundStyle() === 'wire'">wireframe</option>
            </select>
          </label>
        }
        @if (!view3d()) {
          <button class="btn" [class.on]="indoor()" [disabled]="!b() || !!b()!.frame" (click)="toggleIndoor()" title="Take the roof off and edit one floor of the selected building: walls, doors, windows, voids, columns, stairs">{{ indoor() ? '✓ Indoors' : 'Indoors' }}</button>
          @if (indoor() && b(); as ib) {
            <span class="grp">
              @for (l of ib.levels; track $index) {
                <button class="btn" [class.on]="$index === level()" (click)="pickLevel($index)" title="Edit this floor · click again to see the whole building">{{ levelName($index) }}</button>
              }
              <button class="btn" (click)="addLevel()" title="Add a floor on top (a copy of the last one; the roof moves up)">＋</button>
              <button class="btn" [disabled]="ib.levels.length < 2" (click)="removeFloor()" title="Remove the selected floor">－</button>
            </span>
          }
        }
      }
      <span class="sp"></span>
      @if (mode() === 'model') {
        <button class="btn" [disabled]="!ed.canUndo()" (click)="undo()" title="Undo (Ctrl+Z)">↶</button>
        <button class="btn" [disabled]="!ed.canRedo()" (click)="redo()" title="Redo">↷</button>
        <button class="btn" [class.on]="blocksOpen()" (click)="blocksOpen.set(!blocksOpen())" title="Blocks: ready-made objects, buildings and patterns from your library and the online catalogue">▦ Blocks</button>
        <button class="btn" [class.on]="elementsOpen()" (click)="elementsOpen.set(!elementsOpen())" title="Elements: list of all buildings, structures, walls and trees (grouped by area), with thumbnails and links">☰</button>
        <button class="btn" [class.on]="ai.open()" (click)="ai.open.set(!ai.open())" title="Chat with the AI assistant to edit buildings and interiors">💬 AI @if (ai.busy()) { <i class="spin"></i> }</button>
        <button class="btn primary" (click)="save()">Save</button>
      }
      <label class="lay" title="Map under the model">🗺
        <select [value]="studio.basemap()" (change)="setBase($event)">
          <option value="street">Street</option>
          <option value="sat">Satellite</option>
          <option value="off">Hidden</option>
        </select>
      </label>
      <label class="lay" title="Map opacity"><input type="range" min="0.2" max="1" step="0.05" [value]="studio.mapOpacity()" (input)="setOpacity($event)" /></label>
    </div>
    <div class="wrap" #wrap tabindex="0" [class.v3]="view3d() && overlayOn()" (keydown)="key($event)" (pointerdown)="closeMenus()" (contextmenu)="onContext($event)">
      <div class="map" #el></div>

      @if (overlayOn() && !view3d()) {
        <svg
          #svg
          class="ov"
          [class.cap]="captures()"
          [class.sel]="tool() === 'select'"
          [class.placing]="placing()"
          [class.indoor]="indoor()"
          [attr.viewBox]="vb()"
          preserveAspectRatio="none"
          (pointerdown)="bgDown($event)"
          (pointermove)="move($event)"
          (pointerup)="up($event)"
          (pointercancel)="up($event)"
          (pointerleave)="hover.set(null)"
          (wheel)="wheel($event)"
        >
          @for (p of ed.draft().pads; track $index) {
            <rect [attr.x]="p.x - p.w / 2" [attr.y]="p.z - p.d / 2" [attr.width]="p.w" [attr.height]="p.d" [attr.transform]="'rotate(' + (p.rotDeg ?? 0) + ' ' + p.x + ' ' + p.z + ')'" [attr.fill]="p.color ?? '#888'" opacity="0.55" />
          }
          @if (heightImage(); as hi) {
            <image [attr.href]="hi.href" [attr.x]="hi.x" [attr.y]="hi.z" [attr.width]="hi.w" [attr.height]="hi.d" preserveAspectRatio="none" style="image-rendering: pixelated" pointer-events="none" />
          }
          @if (contours(); as ct) {
            <path [attr.d]="ct.minor" fill="none" stroke="#3a2a14" stroke-opacity="0.35" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none" />
            <path [attr.d]="ct.major" fill="none" stroke="#3a2a14" stroke-opacity="0.7" stroke-width="1.6" vector-effect="non-scaling-stroke" pointer-events="none" />
          }
          @for (sf of ed.draft().surfaces ?? []; track $index) {
            <polygon class="hit edge" [class.out]="indoor()" [attr.points]="polyPts(sf.pts)" [attr.fill]="surfColor(sf.kind)" fill-opacity="0.45" [attr.stroke]="isPicked('surface', $index) ? '#ffd166' : surfColor(sf.kind)" [attr.stroke-width]="isPicked('surface', $index) ? 3 : 1.5" vector-effect="non-scaling-stroke" [attr.data-pk]="'surface:' + $index" (pointerdown)="layerDown($event, 'surface', $index)" />
          }
          @for (w of ed.draft().waters ?? []; track $index) {
            <polygon class="hit edge" [class.out]="indoor()" [attr.points]="polyPts(w.pts)" [attr.fill]="waterColor" fill-opacity="0.6" [attr.stroke]="isPicked('water', $index) ? '#ffd166' : '#1f4f73'" [attr.stroke-width]="isPicked('water', $index) ? 3 : 1.5" vector-effect="non-scaling-stroke" [attr.data-pk]="'water:' + $index" (pointerdown)="layerDown($event, 'water', $index)" />
          }
          @if (cutCells(); as cc) {
            <path [attr.d]="cc" fill="#101410" fill-opacity="0.75" pointer-events="none" />
          }
          @for (u of ed.draft().underground ?? []; track u.id) {
            <polygon class="hit edge" [class.out]="indoor()" [attr.points]="polyPts(u.outline)" fill="none" [attr.stroke]="underSel() === u ? '#ffd166' : tc('tunnel')" [attr.stroke-width]="underSel() === u ? 3 : 2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" [attr.data-pk]="'under:' + $index" (pointerdown)="underDown($event, $index)" />
          }
          @if (underPreview(); as up) {
            <polygon [attr.points]="up" [attr.fill]="tc('tunnel')" fill-opacity="0.2" [attr.stroke]="tc('tunnel')" stroke-width="2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" pointer-events="none" />
          }
          @for (r of ed.draft().roads ?? []; track $index) {
            @if (isPicked('road', $index)) {
              <polyline [attr.points]="polyPts(r.pts)" fill="none" stroke="#ffd166" [attr.stroke-width]="r.width + 2 / ppm()" stroke-linecap="round" stroke-linejoin="round" pointer-events="none" />
            }
            <polyline class="hit" [class.out]="indoor()" [attr.points]="polyPts(r.pts)" fill="none" [attr.stroke]="roadColor(r)" [attr.stroke-width]="r.width" [attr.stroke-dasharray]="r.kind === 'rail' ? r.width * 0.6 + ' ' + r.width * 0.3 : null" stroke-linecap="round" stroke-linejoin="round" opacity="0.85" [attr.data-pk]="'road:' + $index" (pointerdown)="layerDown($event, 'road', $index)" />
          }
          @if (layerPreview(); as lp) {
            @if (tool() === 'road') {
              <polyline [attr.points]="lp" fill="none" [attr.stroke]="tc('road')" stroke-opacity="0.7" [attr.stroke-width]="roadWidth()" stroke-linecap="round" stroke-linejoin="round" pointer-events="none" />
            } @else {
              <polygon [attr.points]="lp" [attr.fill]="tc(tool())" fill-opacity="0.25" [attr.stroke]="tc(tool())" stroke-width="2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" pointer-events="none" />
            }
          }
          @for (f of pathView(); track f.id) {
            @for (sg of f.segs; track $index) {
              <polyline [attr.points]="sg.pts" fill="none" [attr.stroke]="sg.color" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" pointer-events="none" />
            }
            @if (f.start; as s0) {
              <circle [attr.cx]="s0.x" [attr.cy]="s0.z" [attr.r]="7 / ppm()" fill="#3ddc84" stroke="#0b2a17" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none" />
              <text [attr.x]="s0.x" [attr.y]="s0.z" text-anchor="middle" dominant-baseline="central" [attr.font-size]="9 / ppm()" font-weight="700" fill="#0b2a17" pointer-events="none">S</text>
            }
            @if (f.end; as e0) {
              <circle [attr.cx]="e0.x" [attr.cy]="e0.z" [attr.r]="7 / ppm()" fill="#ff6b6b" stroke="#3a0b0b" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none" />
              <text [attr.x]="e0.x" [attr.y]="e0.z" text-anchor="middle" dominant-baseline="central" [attr.font-size]="9 / ppm()" font-weight="700" fill="#3a0b0b" pointer-events="none">E</text>
            }
          }
          @if (zoneRect(); as zr) {
            <rect [attr.transform]="'rotate(' + zr.rot + ' ' + (zr.x + zr.w / 2) + ' ' + (zr.z + zr.d / 2) + ')'" [attr.x]="zr.x" [attr.y]="zr.z" [attr.width]="zr.w" [attr.height]="zr.d" fill="none" stroke="#ffd166" stroke-width="2" stroke-dasharray="8 5" vector-effect="non-scaling-stroke" />
          }
          @for (st of ed.draft().structures ?? []; track st.id) {
            <g class="hit" [class.out]="indoor() && st.kind !== 'stairs' && st.kind !== 'ramp'" [attr.transform]="'translate(' + st.x + ' ' + st.z + ') rotate(' + st.rotDeg + ')'" [attr.data-pk]="'structure:' + $index" (pointerdown)="structDown($event, $index)">
              @switch (st.kind) {
                @case ('bridge') {
                  <rect [attr.x]="-(st.length ?? 30) / 2" [attr.y]="-st.size / 2" [attr.width]="st.length ?? 30" [attr.height]="st.size" fill="#8d8d86" fill-opacity="0.85" [attr.stroke]="structI() === $index ? '#ffd166' : '#3a3a36'" [attr.stroke-width]="structI() === $index ? 3 : 1.5" vector-effect="non-scaling-stroke" />
                  <line [attr.x1]="-(st.length ?? 30) / 2" y1="0" [attr.x2]="(st.length ?? 30) / 2" y2="0" stroke="#f2e9b8" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" pointer-events="none" />
                }
                @case ('lattice_tower') {
                  <rect [attr.x]="-st.size" [attr.y]="-st.size" [attr.width]="st.size * 2" [attr.height]="st.size * 2" fill="#c9ced2" fill-opacity="0.6" [attr.stroke]="structI() === $index ? '#ffd166' : '#4c5359'" [attr.stroke-width]="structI() === $index ? 3 : 1.5" vector-effect="non-scaling-stroke" />
                  <line [attr.x1]="-st.size" [attr.y1]="-st.size" [attr.x2]="st.size" [attr.y2]="st.size" stroke="#4c5359" vector-effect="non-scaling-stroke" pointer-events="none" />
                  <line [attr.x1]="st.size" [attr.y1]="-st.size" [attr.x2]="-st.size" [attr.y2]="st.size" stroke="#4c5359" vector-effect="non-scaling-stroke" pointer-events="none" />
                }
                @case ('shapes') {
                  @if (shapesBox(st); as fb) {
                    <rect [attr.x]="fb.x0" [attr.y]="fb.z0" [attr.width]="fb.x1 - fb.x0" [attr.height]="fb.z1 - fb.z0" fill="#c9c5b8" fill-opacity="0.75" [attr.stroke]="structI() === $index ? '#ffd166' : '#3a3a36'" [attr.stroke-width]="structI() === $index ? 3 : 1.5" stroke-dasharray="4 2" vector-effect="non-scaling-stroke" />
                  }
                }
                @case ('tower_crane') {
                  <line [attr.x1]="-(st.length ?? 45) * 0.25" y1="0" [attr.x2]="st.length ?? 45" y2="0" stroke="#e0b020" stroke-width="5" vector-effect="non-scaling-stroke" />
                  <rect [attr.x]="-st.size" [attr.y]="-st.size" [attr.width]="st.size * 2" [attr.height]="st.size * 2" fill="#e0b020" [attr.stroke]="structI() === $index ? '#ffd166' : '#4c4220'" [attr.stroke-width]="structI() === $index ? 3 : 1.5" vector-effect="non-scaling-stroke" />
                }
                @default {
                  @if (isRect(st.kind)) {
                    <rect [attr.x]="-(st.length ?? 6) / 2" [attr.y]="-st.size / 2" [attr.width]="st.length ?? 6" [attr.height]="st.size" [attr.fill]="rectFill(st.kind)" fill-opacity="0.85" [attr.stroke]="structI() === $index ? '#ffd166' : '#2b2b28'" [attr.stroke-width]="structI() === $index ? 3 : 1.5" vector-effect="non-scaling-stroke" />
                    <line [attr.x1]="-(st.length ?? 6) * 0.32" y1="0" [attr.x2]="(st.length ?? 6) * 0.32" y2="0" stroke="#1d1d1b" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none" />
                    <polygon [attr.points]="arrowHead(st.length ?? 6, st.size)" fill="#1d1d1b" pointer-events="none" />
                  } @else {
                    <circle [attr.r]="st.size" [attr.fill]="st.kind === 'chimney' ? '#a86b52' : '#c4c8c6'" fill-opacity="0.85" [attr.stroke]="structI() === $index ? '#ffd166' : '#3a3a36'" [attr.stroke-width]="structI() === $index ? 3 : 1.5" vector-effect="non-scaling-stroke" />
                    <circle [attr.r]="st.size * 0.55" fill="none" stroke="#3a3a36" vector-effect="non-scaling-stroke" pointer-events="none" />
                  }
                }
              }
            </g>
            <text [attr.x]="st.x" [attr.y]="st.z + (isRect(st.kind) ? 0 : st.size + 4)" text-anchor="middle" [attr.font-size]="Math.max(2, 11 / ppm())" fill="#1b231e" stroke="#fff" stroke-width="0.35" paint-order="stroke" pointer-events="none">{{ st.name }}</text>
            @if (structI() === $index && (isRect(st.kind) || st.kind === 'lattice_tower' || st.kind === 'tower_crane')) {
              <g [attr.transform]="'translate(' + st.x + ' ' + st.z + ') rotate(' + st.rotDeg + ')'">
                <line x1="0" [attr.y1]="-(isRect(st.kind) ? st.size / 2 : st.size)" x2="0" [attr.y2]="-(isRect(st.kind) ? st.size / 2 : st.size) - 30 / ppm()" stroke="#b7ed83" vector-effect="non-scaling-stroke" pointer-events="none" />
                <g class="hit rotk" [attr.transform]="'translate(0 ' + (-(isRect(st.kind) ? st.size / 2 : st.size) - 30 / ppm()) + ') scale(' + 1 / ppm() + ')'" (pointerdown)="structRotDown($event, $index)">
                  <title>Drag to rotate · Shift: 15° steps</title>
                  <circle r="10" fill="#ffd166" stroke="#12200b" stroke-width="1.5" />
                  <path d="M -4.5 2.5 A 5 5 0 1 1 1.5 4.8" fill="none" stroke="#12200b" stroke-width="1.8" stroke-linecap="round" />
                  <path d="M 1.5 4.8 L -0.5 1.6 M 1.5 4.8 L 4.6 3.6" fill="none" stroke="#12200b" stroke-width="1.8" stroke-linecap="round" />
                </g>
              </g>
            }
          }
          @for (w of ed.draft().walls ?? []; track $index) {
            <line class="hit" [class.out]="indoor()" [attr.x1]="w.a.x" [attr.y1]="w.a.z" [attr.x2]="w.b.x" [attr.y2]="w.b.z" [attr.stroke]="fenceI() === $index ? '#ffd166' : (w.color ?? fenceColor(w.material))" [attr.stroke-dasharray]="w.material === 'chainlink' ? '2 2' : null" stroke-width="6" stroke-linecap="round" vector-effect="non-scaling-stroke" [attr.data-pk]="'fence:' + $index" (pointerdown)="fenceDown($event, $index)" />
            @if (fenceI() === $index) {
              <circle class="hit" [attr.cx]="w.a.x" [attr.cy]="w.a.z" [attr.r]="hr()" fill="#fff" stroke="#12200b" vector-effect="non-scaling-stroke" (pointerdown)="fenceEndDown($event, $index, 0)" />
              <circle class="hit" [attr.cx]="w.b.x" [attr.cy]="w.b.z" [attr.r]="hr()" fill="#fff" stroke="#12200b" vector-effect="non-scaling-stroke" (pointerdown)="fenceEndDown($event, $index, 1)" />
            }
          }
          @for (t of ed.draft().trees; track $index) {
            <circle class="hit" [class.out]="indoor()" [attr.cx]="t.x" [attr.cy]="t.z" [attr.r]="t.r" [attr.fill]="t.kind === 'c' ? '#2f6b3c' : '#4f9a4a'" fill-opacity="0.85" [attr.stroke]="isTreeSel($index) ? '#ffd166' : '#1d3d22'" stroke-width="1.5" vector-effect="non-scaling-stroke" [attr.data-pk]="'tree:' + $index" (pointerdown)="treeDown($event, $index)" />
          }
          @for (bd of ed.draft().buildings; track bd.id) {
            <g [attr.transform]="tf(bd)" [attr.opacity]="indoor() && bd.id !== ed.selectedId() ? 0.35 : 1">
              @if (bd.frame) {
                @for (x of ribs(bd); track x) {
                  <line [attr.x1]="x" [attr.y1]="-bd.width / 2" [attr.x2]="x" [attr.y2]="bd.width / 2" stroke="#56655f" vector-effect="non-scaling-stroke" pointer-events="none" />
                }
              }
              <polygon class="hit" [attr.points]="outline(bd)" [attr.fill]="bd.color ?? '#d7d0bd'" [attr.fill-opacity]="indoor() && bd.id === ed.selectedId() ? 0.2 : 0.8" [attr.stroke]="bd.id === ed.selectedId() ? (magnetHit() ? '#38d6ff' : '#b7ed83') : '#2d3a33'" [attr.stroke-width]="bd.id === ed.selectedId() ? 3 : 1.5" vector-effect="non-scaling-stroke" [attr.data-pk]="'building:' + bd.id" (pointerdown)="bldDown($event, bd)" />
            </g>
            <text [attr.x]="bd.pos.x" [attr.y]="bd.pos.z" text-anchor="middle" dominant-baseline="middle" [attr.font-size]="labelSize(bd)" fill="#1b231e" stroke="#fff" stroke-width="0.35" paint-order="stroke" pointer-events="none">{{ bd.name }}</text>
          }
          @if (b(); as bd) {
            <g [attr.transform]="tf(bd)">
              @if (!indoor()) {
                @for (pt of lvl()?.partitions ?? []; track $index) {
                  <line [attr.x1]="pt[0].x - bd.length / 2" [attr.y1]="pt[0].z - bd.width / 2" [attr.x2]="pt[1].x - bd.length / 2" [attr.y2]="pt[1].z - bd.width / 2" stroke="#3a463f" stroke-width="3" stroke-linecap="round" vector-effect="non-scaling-stroke" pointer-events="none" />
                }
              }
              @if (indoor()) {
                @for (pt of lvl()?.partitions ?? []; track $index) {
                  <line class="hit" [attr.x1]="pt[0].x - bd.length / 2" [attr.y1]="pt[0].z - bd.width / 2" [attr.x2]="pt[1].x - bd.length / 2" [attr.y2]="pt[1].z - bd.width / 2" [attr.stroke]="wallI() === $index ? '#ffd166' : '#f1f4f2'" stroke-width="5" stroke-linecap="round" vector-effect="non-scaling-stroke" [attr.data-pk]="'wall:' + $index" (pointerdown)="wallDown($event, $index)" />
                }
                @if (drag()?.t === 'wallDraw') {
                  <line [attr.x1]="wd().a.x - bd.length / 2" [attr.y1]="wd().a.z - bd.width / 2" [attr.x2]="wd().b.x - bd.length / 2" [attr.y2]="wd().b.z - bd.width / 2" [attr.stroke]="tc('wall')" stroke-width="4" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" pointer-events="none" />
                }
              }
              @if (indoor() && placing()) {
                <path [attr.d]="gridPath(bd, 1)" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1" fill="none" vector-effect="non-scaling-stroke" pointer-events="none" />
                <path [attr.d]="gridPath(bd, 5)" stroke="#ffffff" stroke-opacity="0.28" stroke-width="1" fill="none" vector-effect="non-scaling-stroke" pointer-events="none" />
              }
              @if (indoor()) {
                @for (v of lvl()?.voids ?? []; track $index) {
                  <rect class="hit" [attr.x]="v.x0 - bd.length / 2" [attr.y]="v.z0 - bd.width / 2" [attr.width]="v.x1 - v.x0" [attr.height]="v.z1 - v.z0" [attr.fill]="v.water ? '#3d86b6' : '#0b0e0c'" fill-opacity="0.65" [attr.stroke]="voidI() === $index ? '#ffd166' : '#8fb7d1'" stroke-width="2" stroke-dasharray="5 3" vector-effect="non-scaling-stroke" [attr.data-pk]="'void:' + $index" (pointerdown)="voidDown($event, $index)" />
                }
                @for (c of lvl()?.columns ?? []; track $index) {
                  @if (c.round) {
                    <circle class="hit" [attr.cx]="c.x - bd.length / 2" [attr.cy]="c.z - bd.width / 2" [attr.r]="c.size / 2" fill="#c9c5b8" [attr.stroke]="isColSel($index) ? '#ffd166' : '#222'" [attr.stroke-width]="isColSel($index) ? 3 : 2" vector-effect="non-scaling-stroke" [attr.data-pk]="'col:' + $index" (pointerdown)="colDown($event, $index)" (dblclick)="selectColumns('x')" />
                  } @else {
                    <rect class="hit" [attr.x]="c.x - bd.length / 2 - c.size / 2" [attr.y]="c.z - bd.width / 2 - c.size / 2" [attr.width]="c.size" [attr.height]="c.size" fill="#c9c5b8" [attr.stroke]="isColSel($index) ? '#ffd166' : '#222'" [attr.stroke-width]="isColSel($index) ? 3 : 2" vector-effect="non-scaling-stroke" [attr.data-pk]="'col:' + $index" (pointerdown)="colDown($event, $index)" (dblclick)="selectColumns('x')" />
                  }
                }
                @if (pv(); as g) {
                  @for (gl of g.guides; track $index) {
                    <line [attr.x1]="gl.x0 - bd.length / 2" [attr.y1]="gl.z0 - bd.width / 2" [attr.x2]="gl.x1 - bd.length / 2" [attr.y2]="gl.z1 - bd.width / 2" [attr.stroke]="gl.kind === 'equal' ? '#7dff9a' : '#7fd0ff'" stroke-width="1.5" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" pointer-events="none" />
                  }
                  @for (lb of g.labels; track $index) {
                    <text [attr.x]="lb.x - bd.length / 2" [attr.y]="lb.z - bd.width / 2" text-anchor="middle" dominant-baseline="middle" [attr.font-size]="Math.max(0.5, (lb.kind === 'wall' ? 10 : 12) / ppm())" [attr.fill]="lb.kind === 'equal' ? '#7dff9a' : lb.kind === 'wall' ? '#c9d3cc' : '#bfe7ff'" [attr.fill-opacity]="lb.kind === 'wall' ? 0.75 : 1" stroke="#101612" stroke-width="0.25" paint-order="stroke" pointer-events="none">{{ lb.text }}</text>
                  }
                  @if (g.seg; as sg) {
                    <line [attr.x1]="sg.x0 - bd.length / 2" [attr.y1]="sg.z0 - bd.width / 2" [attr.x2]="sg.x1 - bd.length / 2" [attr.y2]="sg.z1 - bd.width / 2" [attr.stroke]="sg.kind === 'door' ? '#ff9a2e' : '#4fc3f7'" stroke-width="9" stroke-opacity="0.75" vector-effect="non-scaling-stroke" pointer-events="none" />
                  }
                  @if (ghostKind() === 'column') {
                    @if (colShape() === 'round') {
                      <circle [attr.cx]="g.x - bd.length / 2" [attr.cy]="g.z - bd.width / 2" [attr.r]="colSize() / 2" [attr.fill]="g.valid ? '#b7ed83' : '#ff6b6b'" fill-opacity="0.55" [attr.stroke]="g.valid ? '#b7ed83' : '#ff6b6b'" vector-effect="non-scaling-stroke" pointer-events="none" />
                    } @else {
                      <rect [attr.x]="g.x - bd.length / 2 - colSize() / 2" [attr.y]="g.z - bd.width / 2 - colSize() / 2" [attr.width]="colSize()" [attr.height]="colSize()" [attr.fill]="g.valid ? '#b7ed83' : '#ff6b6b'" fill-opacity="0.55" [attr.stroke]="g.valid ? '#b7ed83' : '#ff6b6b'" vector-effect="non-scaling-stroke" pointer-events="none" />
                    }
                  } @else if (ghostKind() === 'stairs') {
                    <rect [attr.x]="g.x - bd.length / 2 - stairsGhost().w / 2" [attr.y]="g.z - bd.width / 2 - stairsGhost().d / 2" [attr.width]="stairsGhost().w" [attr.height]="stairsGhost().d" [attr.fill]="g.valid ? '#b7ed83' : '#ff6b6b'" fill-opacity="0.4" [attr.stroke]="g.valid ? '#b7ed83' : '#ff6b6b'" stroke-dasharray="5 3" vector-effect="non-scaling-stroke" pointer-events="none" />
                  }
                }
                @if (drag()?.t === 'voidDraw') {
                  <rect [attr.x]="vd().x - bd.length / 2" [attr.y]="vd().z - bd.width / 2" [attr.width]="vd().w" [attr.height]="vd().d" [attr.fill]="tc('void')" fill-opacity="0.4" [attr.stroke]="tc('void')" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" pointer-events="none" />
                }
              }
              @for (o of openings(); track o.id) {
                <line class="hit" [attr.x1]="seg(o).x1" [attr.y1]="seg(o).y1" [attr.x2]="seg(o).x2" [attr.y2]="seg(o).y2" [attr.stroke]="o.kind === 'door' ? '#ff9a2e' : '#4fc3f7'" [attr.stroke-width]="openId() === o.id ? 10 : 7" vector-effect="non-scaling-stroke" [attr.data-pk]="'opening:' + o.id" (pointerdown)="openDown($event, o.id)" />
                @if (openId() === o.id) {
                  <circle class="hit" [attr.cx]="seg(o).x1" [attr.cy]="seg(o).y1" [attr.r]="hr()" fill="#fff" stroke="#12200b" vector-effect="non-scaling-stroke" (pointerdown)="openEndDown($event, o.id, 0)" />
                  <circle class="hit" [attr.cx]="seg(o).x2" [attr.cy]="seg(o).y2" [attr.r]="hr()" fill="#fff" stroke="#12200b" vector-effect="non-scaling-stroke" (pointerdown)="openEndDown($event, o.id, 1)" />
                }
              }
              @if (tool() === 'select' && !indoor()) {
                @if (!bd.footprint) {
                  @for (c of corners; track $index) {
                    <rect class="hit" [attr.x]="c[0] * bd.length / 2 - hr()" [attr.y]="c[1] * bd.width / 2 - hr()" [attr.width]="hr() * 2" [attr.height]="hr() * 2" fill="#b7ed83" stroke="#12200b" vector-effect="non-scaling-stroke" (pointerdown)="cornerDown($event, c[0], c[1])" />
                  }
                } @else {
                  @for (e of edgesOf(bd.footprint); track e.i) {
                    <rect class="hit" [attr.x]="(e.axis === 'x' ? (e.from + e.to) / 2 : e.at) - hr()" [attr.y]="(e.axis === 'x' ? e.at : (e.from + e.to) / 2) - hr()" [attr.width]="hr() * 2" [attr.height]="hr() * 2" fill="#b7ed83" stroke="#12200b" vector-effect="non-scaling-stroke" (pointerdown)="edgeDown($event, e.i)" />
                  }
                }
                <line [attr.x1]="0" [attr.y1]="-bd.width / 2" [attr.x2]="0" [attr.y2]="-bd.width / 2 - 30 / ppm()" stroke="#b7ed83" vector-effect="non-scaling-stroke" pointer-events="none" />
                <g class="hit rotk" [attr.transform]="'translate(0 ' + (-bd.width / 2 - 30 / ppm()) + ') scale(' + 1 / ppm() + ')'" (pointerdown)="rotDown($event)">
                  <title>Drag to rotate · magnet lines it up with neighbours · Shift: 15° steps · Alt: free</title>
                  <circle r="10" fill="#ffd166" stroke="#12200b" stroke-width="1.5" />
                  <path d="M -4.5 2.5 A 5 5 0 1 1 1.5 4.8" fill="none" stroke="#12200b" stroke-width="1.8" stroke-linecap="round" />
                  <path d="M 1.5 4.8 L -0.5 1.6 M 1.5 4.8 L 4.6 3.6" fill="none" stroke="#12200b" stroke-width="1.8" stroke-linecap="round" />
                </g>
              }
              @if (drag()?.t === 'shape') {
                <rect [attr.x]="sh().x" [attr.y]="sh().z" [attr.width]="sh().w" [attr.height]="sh().d" [attr.fill]="sh().op === 'cut' ? tc('cut') : tc('wing')" fill-opacity="0.35" [attr.stroke]="sh().op === 'cut' ? tc('cut') : tc('wing')" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" pointer-events="none" />
              }
            </g>
          }
          @if (drag()?.t === 'bridgeDraw') {
            <line [attr.x1]="bdw().a.x" [attr.y1]="bdw().a.z" [attr.x2]="bdw().b.x" [attr.y2]="bdw().b.z" [attr.stroke]="tc('structure')" [attr.stroke-width]="7" stroke-dasharray="8 5" vector-effect="non-scaling-stroke" pointer-events="none" />
          }
          @for (z of zonePolys(); track $index) {
            <polygon [attr.points]="z" [attr.fill]="tc('scatter')" fill-opacity="0.08" [attr.stroke]="tc('scatter')" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke" pointer-events="none" />
          }
          @if (zoneHi(); as zh) {
            <polygon [attr.points]="zh" [attr.fill]="tc('scatter')" fill-opacity="0.22" [attr.stroke]="tc('scatter')" stroke-width="3" vector-effect="non-scaling-stroke" pointer-events="none" />
          }
          @if (scatterPreview(); as sp) {
            <polygon [attr.points]="sp" [attr.fill]="tc('scatter')" fill-opacity="0.2" [attr.stroke]="tc('scatter')" stroke-width="2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" pointer-events="none" />
          }
          @if (drag()?.t === 'fenceDraw') {
            <line [attr.x1]="fd().a.x" [attr.y1]="fd().a.z" [attr.x2]="fd().b.x" [attr.y2]="fd().b.z" [attr.stroke]="tc('fence')" stroke-width="5" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" pointer-events="none" />
          }
          @if (drag()?.t === 'draw') {
            <rect [attr.x]="dr().x" [attr.y]="dr().z" [attr.width]="dr().w" [attr.height]="dr().d" fill="#b7ed83" fill-opacity="0.25" stroke="#b7ed83" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" pointer-events="none" />
          }
          @for (m of meas().segs; track $index) {
            <line [attr.x1]="m.a.x" [attr.y1]="m.a.z" [attr.x2]="m.b.x" [attr.y2]="m.b.z" [attr.stroke]="measSel() === $index ? '#fff' : tc('measure')" [attr.stroke-width]="measSel() === $index ? 3 : 2" stroke-dasharray="8 5" vector-effect="non-scaling-stroke" pointer-events="none" />
            <line class="mhit" [attr.data-pk]="'meas:' + $index" [attr.x1]="m.a.x" [attr.y1]="m.a.z" [attr.x2]="m.b.x" [attr.y2]="m.b.z" stroke="transparent" stroke-width="14" vector-effect="non-scaling-stroke" [attr.pointer-events]="measHit()" (pointerdown)="measureLineDown($event, $index)"><title>Click to select · drag to move · Delete removes it</title></line>
            <circle [attr.cx]="m.a.x" [attr.cy]="m.a.z" [attr.r]="4 / ppm()" [attr.fill]="tc('measure')" pointer-events="none" />
            <circle [attr.cx]="m.b.x" [attr.cy]="m.b.z" [attr.r]="4 / ppm()" [attr.fill]="tc('measure')" pointer-events="none" />
            <text [attr.x]="(m.a.x + m.b.x) / 2" [attr.y]="(m.a.z + m.b.z) / 2" text-anchor="middle" [attr.font-size]="13 / ppm()" fill="#c8f4ff" stroke="#222" stroke-width="0.4" paint-order="stroke" pointer-events="none">{{ fmt(m) }}</text>
          }
          @for (an of measArcs(); track $index) {
            <path [attr.d]="an.path" fill="#ffb3f0" fill-opacity="0.18" stroke="#ffb3f0" stroke-width="1.5" vector-effect="non-scaling-stroke" pointer-events="none" />
            <text [attr.x]="an.label.x" [attr.y]="an.label.z" text-anchor="middle" dominant-baseline="central" [attr.font-size]="11 / ppm()" fill="#ffd9f7" stroke="#222" stroke-width="0.4" paint-order="stroke" pointer-events="none">{{ an.deg.toFixed(1) }}°</text>
          }
          @if (measSelSeg(); as ms) {
            <circle class="mhit" [attr.cx]="ms.a.x" [attr.cy]="ms.a.z" [attr.r]="6 / ppm()" fill="#fff" stroke="#0b3a47" stroke-width="1.5" vector-effect="non-scaling-stroke" [attr.pointer-events]="measHit() === 'stroke' ? 'all' : 'none'" (pointerdown)="measEndDown($event, 0)" />
            <circle class="mhit" [attr.cx]="ms.b.x" [attr.cy]="ms.b.z" [attr.r]="6 / ppm()" fill="#fff" stroke="#0b3a47" stroke-width="1.5" vector-effect="non-scaling-stroke" [attr.pointer-events]="measHit() === 'stroke' ? 'all' : 'none'" (pointerdown)="measEndDown($event, 1)" />
          }
          @if (meas().a; as ma) {
            <circle [attr.cx]="ma.x" [attr.cy]="ma.z" [attr.r]="5 / ppm()" [attr.fill]="tc('measure')" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none" />
            @if (measHover(); as mh) {
              <line [attr.x1]="ma.x" [attr.y1]="ma.z" [attr.x2]="mh.x" [attr.y2]="mh.z" [attr.stroke]="tc('measure')" stroke-width="2" stroke-dasharray="8 5" vector-effect="non-scaling-stroke" pointer-events="none" />
              <text [attr.x]="(ma.x + mh.x) / 2" [attr.y]="(ma.z + mh.z) / 2" text-anchor="middle" [attr.font-size]="13 / ppm()" fill="#c8f4ff" stroke="#222" stroke-width="0.4" paint-order="stroke" pointer-events="none">{{ fmt({ a: ma, b: mh }) }}</text>
            }
          }
          @if (measHover(); as mh) {
            @if (measSnap()) {
              <circle [attr.cx]="mh.x" [attr.cy]="mh.z" [attr.r]="8 / ppm()" fill="none" stroke="#ffe066" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none" />
              <text [attr.x]="mh.x + 11 / ppm()" [attr.y]="mh.z + 14 / ppm()" [attr.font-size]="11 / ppm()" fill="#ffe066" stroke="#222" stroke-width="0.4" paint-order="stroke" pointer-events="none">{{ measSnap() }}</text>
            }
          }
          @if (tool() === 'terrain') {
            @if (terrPreview(); as tp) {
              <path [attr.d]="tp" fill="none" [attr.stroke]="tc('terrain')" stroke-opacity="0.35" [attr.stroke-width]="terrainOp() === 'ramp' ? terrRadius() : terrRadius() * 2" stroke-linecap="round" stroke-linejoin="round" pointer-events="none" />
            }
            @if (hover(); as hv) {
              <circle [attr.cx]="hv.x" [attr.cy]="hv.z" [attr.r]="terrainOp() === 'ramp' ? terrRadius() / 2 : terrRadius()" fill="none" [attr.stroke]="tc('terrain')" stroke-width="2" stroke-dasharray="5 4" vector-effect="non-scaling-stroke" pointer-events="none" />
            }
          }
          @if (armed(); as am) {
            @if (hover(); as hv) {
              <circle [attr.cx]="hv.x" [attr.cy]="hv.z" [attr.r]="10 / ppm()" fill="none" stroke="#b7ed83" stroke-width="2" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" pointer-events="none" />
              <text [attr.x]="hv.x + 12 / ppm()" [attr.y]="hv.z - 8 / ppm()" [attr.font-size]="11 / ppm()" fill="#eef4ed" stroke="#101410" stroke-width="0.4" paint-order="stroke" pointer-events="none">{{ am.block.name }}</text>
            }
          }
          @if (selOutline(); as so) {
            <polygon [attr.points]="so" fill="#ffffff" fill-opacity="0.12" stroke="#ffffff" stroke-dasharray="5 3" vector-effect="non-scaling-stroke" pointer-events="none" />
          }
          <circle [attr.cx]="ed.draft().droneStart.x" [attr.cy]="ed.draft().droneStart.z" [attr.r]="2" fill="#ff6b6b" pointer-events="none" />
        </svg>
      }

      @if (overlayOn() && view3d()) {
        <app-site-view
          [spec]="ed.draft()"
          [roofHidden]="!roofs3d()"
          [frameKey]="ed.draft().id"
          [mode]="tool() === 'select' ? 'select' : 'draw'"
          [selection]="sel3d()"
          [focus]="focus3d()"
          [flights]="flightList()"
          [speedMax]="flights.speedMax"
          (picked)="onPick3d($event)"
          (ground)="onGround3d($event)"
          [groundStyle]="groundStyle()"
          [cursor]="cursor3d()"
        />
      }
      @if (!(overlayOn() && view3d())) {
        <svg class="compass" viewBox="-30 -30 60 60" aria-label="North is up">
          <circle r="27" fill="rgba(10,16,12,0.75)" stroke="#6f8577" />
          <polygon points="0,-23 5,-3 -5,-3" fill="#ff5a4d" />
          <polygon points="0,23 5,3 -5,3" fill="#8a948d" />
          <text y="-14" x="0" text-anchor="middle" dominant-baseline="middle" font-size="9" font-weight="700" fill="#fff" stroke="#000" stroke-width="2" paint-order="stroke">N</text>
          @if (mode() === 'model' && b(); as cb) {
            <line x1="0" y1="0" [attr.x2]="axisEnd(cb)[0]" [attr.y2]="axisEnd(cb)[1]" stroke="#b7ed83" stroke-width="2.5" stroke-linecap="round" />
          }
        </svg>
      }
      @if (mode() === 'model' && overlayOn()) {
        <div #pal class="palette" role="toolbar" aria-label="Tools" aria-orientation="vertical" [style.left.px]="palXY().x" [style.top.px]="palXY().y" (pointerdown)="$event.stopPropagation()">
          <div class="tgrip" title="Drag to move the tools · double-click to put them back" (pointerdown)="tbDown($event, 'pal')" (pointermove)="tbMove($event)" (pointerup)="tbUp($event)" (pointercancel)="tbUp($event)" (dblclick)="tbReset('pal')" aria-hidden="true">⠿</div>
          @for (g of groups(); track g.id) {
            @if (g.sep) {
              <i class="psep"></i>
            }
            <div class="pg">
              <button class="pbtn" [class.on]="g.on" [style.--tc]="g.shown.color" (pointerdown)="pbDown(g.id, g.items.length)" (pointerup)="pbUp()" (pointerleave)="pbUp()" (click)="pbClick(g.shown)" (contextmenu)="g.items.length > 1 ? toggleFly(g.id, $event) : $event.preventDefault()" [title]="g.shown.name + ' · ' + g.shown.hint + (g.items.length > 1 ? ' · hold or click the corner for the other tools' : '')">
                <app-tool-icon [name]="g.shown.icon" />
                @if (g.items.length > 1) {
                  <span class="tri" (pointerdown)="$event.stopPropagation()" (click)="toggleFly(g.id, $event)"></span>
                }
              </button>
              @if (fly() === g.id) {
                <div class="fly" (pointerdown)="$event.stopPropagation()">
                  @for (it of g.items; track it.key) {
                    <button class="fbtn" [class.on]="entryActive(it)" [style.--tc]="it.color" (click)="pickEntry(it)" [title]="it.hint"><app-tool-icon [name]="it.icon" /> {{ it.name }}</button>
                  }
                </div>
              }
            </div>
          }
          @if (!indoor() && hasPath() && !view3d()) {
            <i class="psep"></i>
            <div class="pg"><button class="pbtn" [class.on]="pinMode() === 's'" style="--tc: #ff6b6b" (click)="armPin('s')" title="Pin start · click where the loaded flight started"><app-tool-icon name="pinStart" /></button></div>
            <div class="pg"><button class="pbtn" [class.on]="pinMode() === 'e'" style="--tc: #ff6b6b" (click)="armPin('e')" title="Pin end · click where the loaded flight ended"><app-tool-icon name="pinEnd" /></button></div>
          }
        </div>
        @if (!view3d() || tool() !== 'select') {
          <div class="opts" role="toolbar" [attr.aria-label]="toolName() + ' options'" [style.left.px]="optsXY().left" [style.right.px]="optsXY().right" [style.top.px]="optsXY().top" [style.max-width.px]="optsXY().max" (pointerdown)="$event.stopPropagation()">
            <span class="tgrip" title="Drag to move the options · double-click to put them back beside the tool" (pointerdown)="tbDown($event, 'opts')" (pointermove)="tbMove($event)" (pointerup)="tbUp($event)" (pointercancel)="tbUp($event)" (dblclick)="tbReset('opts')" aria-hidden="true">⠿</span>
            <b [style.color]="toolColor()">{{ toolName() }}</b>
                @switch (tool()) {
                  @case ('select') {
                    <span class="seg" title="How a drag on empty ground selects (outdoors: hold Shift; indoors: columns of the floor)">
                      <button [class.on]="selShape() === 'box'" [attr.aria-pressed]="selShape() === 'box'" (click)="selShape.set('box')">▭ Box</button>
                      <button [class.on]="selShape() === 'lasso'" [attr.aria-pressed]="selShape() === 'lasso'" (click)="selShape.set('lasso')">◌ Lasso</button>
                    </span>
                    <span class="dim small">{{ indoor() ? 'drag on the floor · Shift adds' : 'Shift + drag · Shift + click adds' }}</span>
                    @if (!indoor()) {
                      <label class="lay" title="While moving or rotating a building: snap flush to close neighbours and line up with their angles and the map axes. Hold Alt to drag freely."><input type="checkbox" [checked]="magnet()" (change)="magnet.set(checked($event))" /> magnet</label>
                    }
                  }
                  @case ('structure') {
                    <app-pick-menu label="What to place" [options]="structOptions" [value]="structKind()" (valueChange)="structKind.set(asStruct($event))" />
                  }
                  @case ('measure') {
                    <button class="btn" [disabled]="measSel() === null" (click)="deleteMeasure()" title="Delete the selected measure (Delete key)">Delete</button>
                    <button class="btn" [disabled]="!meas().segs.length" (click)="clearMeasures()" title="Remove all measures">Clear all</button>
                  }
                  @case ('scatter') {
                    <app-pick-menu label="Brush shape" [options]="scatterOptions" [value]="scatterMode()" (valueChange)="scatterMode.set(asScatter($event))" />
                    <app-pick-menu label="Trees" [options]="treeMixOptions" [value]="treeMix()" (valueChange)="treeMix.set(asMix($event))" />
                    <label class="lay" title="Average distance between trees">every <input class="mini" type="number" min="2" max="30" step="0.5" [value]="scatterSpacing()" (change)="scatterSpacing.set(num($event))" /> m</label>
                    @if (scatterMode() === 'pen') {
                      <label class="lay" title="Width of the pen stroke">width <input class="mini" type="number" min="2" max="60" step="1" [value]="scatterWidth()" (change)="scatterWidth.set(num($event))" /> m</label>
                    }
                  }
                  @case ('tunnel') {
                    <app-pick-menu label="What" [options]="underKindOptions" [value]="underKind()" (valueChange)="underKind.set($event === 'room' ? 'room' : 'tunnel')" />
                    @if (underKind() === 'tunnel') {
                      <app-pick-menu label="Section" [compact]="true" [options]="underShapeOptions" [value]="underShape()" (valueChange)="underShape.set(asUnderShape($event))" />
                      <label class="lay" title="Inside width, metres">width <input class="mini" type="number" min="0.8" max="30" step="0.5" [value]="underWidth()" (change)="underWidth.set(Math.max(0.8, num($event)))" /> m</label>
                    }
                    <label class="lay" title="Inside height, metres">height <input class="mini" type="number" min="0.8" max="30" step="0.5" [value]="underHeight()" (change)="underHeight.set(Math.max(0.8, num($event)))" /> m</label>
                    <label class="lay" title="How far the floor is below the ground where you start dragging (a room: its ceiling)">depth <input class="mini" type="number" min="0" max="60" step="0.5" [value]="underDepth()" (change)="underDepth.set(Math.max(0, num($event)))" /> m</label>
                  }
                  @case ('road') {
                    <app-pick-menu label="Kind" [options]="roadOptions" [value]="roadKind()" (valueChange)="setRoadKind(asRoad($event))" />
                    <label class="lay" title="Width, metres">width <input class="mini" type="number" min="0.5" max="40" step="0.5" [value]="roadWidth()" (change)="roadWidth.set(Math.max(0.5, num($event)))" /> m</label>
                  }
                  @case ('surface') {
                    <app-pick-menu label="Ground" [options]="surfaceOptions" [value]="surfaceKind()" (valueChange)="surfaceKind.set(asSurface($event))" />
                  }
                  @case ('water') {
                    <label class="lay" title="Depth of the basin below the water, metres">depth <input class="mini" type="number" min="0.2" max="20" step="0.5" [value]="waterDepth()" (change)="waterDepth.set(Math.max(0.2, num($event)))" /> m</label>
                  }
                  @case ('terrain') {
                    <app-pick-menu label="Shape the ground" [options]="terrOpOptions" [value]="terrainOp()" (valueChange)="terrainOp.set(asOp($event))" />
                    <label class="lay" title="Brush radius (ramp: its width)">⌀ <input class="mini" type="number" min="1" max="100" step="1" [value]="terrRadius()" (change)="terrRadius.set(Math.max(1, num($event)))" /> m</label>
                    @if (terrainOp() !== 'flatten') {
                      <label class="lay" [title]="terrainOp() === 'smooth' ? 'How much to soften (percent)' : 'Metres'">{{ terrStrengthLabel() }} <input class="mini" type="number" [min]="terrainOp() === 'smooth' ? 5 : 0.1" [max]="terrainOp() === 'smooth' ? 100 : 60" step="0.5" [value]="terrStrength()" (change)="terrStrength.set(Math.max(0.1, num($event)))" />{{ terrainOp() === 'smooth' ? '' : ' m' }}</label>
                    }
                    @if (terrainOp() !== 'ramp') {
                      <app-pick-menu label="Edge" [compact]="true" [options]="falloffOptions" [value]="terrFalloff()" (valueChange)="terrFalloff.set(asFalloff($event))" />
                    }
                    <button class="btn" [disabled]="!ed.draft().terrain?.strokes?.length" (click)="clearTerrain()" title="Remove every terrain stroke (back to the real ground, or flat)">Reset</button>
                    <button class="btn" [disabled]="loadingGround()" (click)="realGround()" [title]="ed.draft().terrain?.base ? 'Download the real ground again (your strokes stay)' : 'Download the real ground heights for this bando (your strokes stay)'">@if (loadingGround()) {<i class="spin"></i> } {{ ed.draft().terrain?.base ? 'Re-load real ground' : 'Real ground' }}</button>
                  }
                  @case ('tree') {
                    <app-pick-menu label="Tree" [options]="treeMixOptions" [value]="treeMix()" (valueChange)="treeMix.set(asMix($event))" />
                  }
                  @case ('fence') {
                    <app-pick-menu label="Material" [options]="fenceOptions" [value]="fenceMat()" (valueChange)="fenceMat.set(asFence($event))" />
                  }
                  @case ('building') {
                    <label class="lay" title="Snap the new building flush against close neighbours (closes small gaps, straightens small angles)"><input type="checkbox" [checked]="autoAlign()" (change)="autoAlign.set(checked($event))" /> auto-align</label>
                    <app-pick-menu label="What to draw" [options]="buildOptions" [value]="buildKind()" (valueChange)="buildKind.set($event === 'greenhouse' ? 'greenhouse' : 'building')" />
                  }
                  @case ('column') {
                    <app-pick-menu label="Shape of new columns" [options]="colOptions" [value]="colShape()" (valueChange)="colShape.set($event === 'round' ? 'round' : 'square')" />
                    <label class="lay" title="Column size (side or diameter), metres">⌀ <input type="number" class="mini" min="0.15" step="0.05" [value]="colSize()" (change)="colSize.set(Math.max(0.15, num($event)))" /> m</label>
                  }
                  @case ('stairs') {
                    <app-pick-menu label="Stairs or a ramp" [options]="stairsOptions" [value]="stairsKind()" (valueChange)="stairsKind.set($event === 'ramp' ? 'ramp' : 'stairs')" />
                    @if (level() < (b()?.levels.length ?? 1) - 1) {
                      <label class="lay" title="Cut a hole in the floor above where the stairs arrive"><input type="checkbox" [checked]="stairwell()" (change)="stairwell.set(checked($event))" /> open floor above</label>
                    }
                  }
                }

          </div>
        }
      }
      @if (mode() === 'area') {
        <div class="frame" [style.left.px]="fb().l" [style.top.px]="fb().t" [style.width.px]="fb().w" [style.height.px]="fb().h" [style.transform]="'rotate(' + rot() + 'deg)'">
          <div class="rotk" (pointerdown)="frameRotDown($event)" (pointermove)="move($event)" (pointerup)="up($event)" (pointercancel)="up($event)" title="Drag to turn the frame (shift = steps of 15°). Only what is inside the turned frame is used."></div>
          @for (h of handles; track h) {
            <div [class]="'h ' + h" (pointerdown)="frameDown($event, h)" (pointermove)="move($event)" (pointerup)="up($event)" (pointercancel)="up($event)"></div>
          }
        </div>
        <div class="search">
          <input type="text" [(ngModel)]="query" placeholder="Search a place or lat,lon" (keydown.enter)="search()" aria-label="Search a place" />
          <button class="btn" (click)="search()" [disabled]="searching()">Go</button>
        </div>
        @if (hits().length) {
          <div class="hits">
            @for (h of hits(); track h.lat + ',' + h.lon) {
              <button (click)="pick2(h)" [title]="h.label">{{ h.label }}</button>
            }
          </div>
        }
        <div class="read" [class.warn]="atMax()">{{ round(half().e * 2) }} × {{ round(half().n * 2) }} m{{ rot() ? ' · ' + round(rot()) + '°' : '' }}{{ atMax() ? ' (maximum)' : '' }} <button class="btn mini" [disabled]="!rot()" (click)="rot.set(0)" title="Turn the frame back to north-up">↺</button></div>
      } @else if (!overlayOn()) {
        <div class="notice">This bando was built with the old rotated layout and can't be drawn over the map. Go to <b>1 · Area</b> and press <b>Regenerate</b> to rebuild it aligned to the map.</div>
      }

      @if (groundUnder() !== null) {
        <div class="read" aria-live="off">ground {{ groundUnder()!.toFixed(1) }} m</div>
      }
      @if (ctx(); as c) {
        <div class="ctx" [style.left.px]="c.x" [style.top.px]="c.y" (pointerdown)="$event.stopPropagation()" (contextmenu)="$event.preventDefault(); $event.stopPropagation()">
          @for (it of c.items; track $index) {
            @if (it.sep) {
              <i class="psep"></i>
            } @else if (it.head) {
              <div class="head">{{ it.label }}</div>
            } @else {
              <button [class.danger]="it.danger" (click)="runCtx(it)">{{ it.label }}</button>
            }
          }
        </div>
      }

      @if (mode() === 'model' && overlayOn() && ai.open()) {
        <app-assistant-box />
      }
      @if (mode() === 'model' && overlayOn() && blocksOpen()) {
        <app-blocks-box [building]="b()" [structure]="structSel()" (arm)="armBlock($event)" (apply)="applyBlockPattern($event)" />
      }
      @if (mode() === 'model' && overlayOn() && elementsOpen()) {
        <app-elements-box [spec]="ed.draft()" [selectedId]="ed.selectedId()" (go)="goTo($event)" (hover)="zoneHover.set($event)" (zones)="zonesOn.set($event)" />
      }

      @if (mode() === 'model' && overlayOn()) {
        <app-float-box fid="inspector-v4" title="Inspector" [x]="8" [y]="58" [w]="300" [h]="340" [right]="true" [cols]="true">
          @if (previewTarget(); as pt) {
            <app-element-preview [target]="pt" [key]="previewKey()" [caption]="previewCaption()" (picked)="onPreviewPick($event)" />
          }
          @switch (pick()?.t) {
            @case ('opening') {
              @if (op(); as o) {
                <div class="f"><label>type <select (change)="setOpening({ kind: kindOf($event) })"><option value="door" [selected]="o.kind === 'door'">door</option><option value="window" [selected]="o.kind === 'window'">window</option></select></label></div>
                <div class="f"><label>width <input type="number" min="0.4" step="0.1" [value]="o.w.toFixed(2)" (change)="setOpening({ w: num($event) })" /></label>
                <label>height <input type="number" min="0.3" step="0.1" [value]="o.h.toFixed(2)" (change)="setOpening({ h: num($event) })" /></label></div>
                @if (o.kind === 'window') {
                  <div class="f"><label>sill (bottom) <input type="number" min="0" step="0.1" [value]="o.sill.toFixed(2)" (change)="setOpening({ sill: num($event) })" /></label></div>
                }
                <div class="f"><label>position on wall <input type="number" step="0.1" [value]="(o.c - o.from).toFixed(2)" (change)="setOpening({ c: o.from + num($event) })" /></label></div>
                <div class="f"><label><input type="checkbox" [checked]="o.closed" (change)="setOpening({ closed: checked($event) })" /> closed ({{ o.kind === 'door' ? 'a door leaf' : 'a pane' }}; open = just the hole)</label></div>
                <div class="f"><span class="dim">repeat along the wall</span><label>× <input type="number" min="2" max="40" step="1" [value]="repN()" (change)="repN.set(num($event))" /></label>
                <label>every <input type="number" min="0.5" step="0.5" [value]="repS()" (change)="repS.set(num($event))" /> m</label>
                <button class="btn" (click)="repeatSel()">Repeat</button></div>
                <div class="f"><button class="btn danger" (click)="deleteSel()">Delete</button></div>
              }
            }
            @case ('tree') {
              @if (tree(); as t) {
                @if (treeIdxs().length > 1) {
                  <div class="f"><span class="dim">{{ treeIdxs().length }} trees selected · changes apply to all</span></div>
                }
                <div class="f"><label>height <input type="number" min="1" step="0.5" [value]="t.h" (change)="setTree({ h: num($event) })" /></label>
                <label>radius <input type="number" min="0.5" step="0.25" [value]="t.r" (change)="setTree({ r: num($event) })" /></label></div>
                <div class="f"><app-pick-menu label="Kind" [options]="treeKindOptions" [value]="t.kind" (valueChange)="setTree({ kind: $event === 'c' ? 'c' : 'd' })" />
                <button class="btn danger" (click)="deleteSel()">Delete</button></div>
              }
            }
            @case ('structure') {
              @if (structSel(); as st) {
                <div class="f"><label class="grow">name <input type="text" class="grow" [value]="st.name" (change)="setStruct({ name: text($event) })" /></label></div>
                <div class="f"><span class="dim">{{ structLabel(st.kind) }}</span></div>
                @if (st.kind === 'shapes') {
                  <div class="f"><span class="dim">{{ (st.shapes ?? []).length }} shapes · {{ st.height.toFixed(1) }} m tall · its form comes from its block</span></div>
                } @else {
                  <div class="f"><label>{{ heightLabel(st.kind) }} <input type="number" min="0.3" step="0.5" [value]="st.height" (change)="setStruct({ height: num($event) })" /></label>
                  <label>{{ sizeLabel(st.kind) }} <input type="number" min="0.3" step="0.1" [value]="st.size" (change)="setStruct({ size: num($event) })" /></label></div>
                }
                @if (hasLength(st.kind)) {
                  <div class="f"><label>{{ st.kind === 'tower_crane' ? 'jib length' : 'length' }} <input type="number" min="1" step="0.5" [value]="(st.length ?? 6).toFixed(1)" (change)="setStruct({ length: num($event) })" /></label>
                  @if (st.kind === 'bridge') {
                    <label>style <select (change)="setStruct({ style: styleOf($event) })"><option value="beam" [selected]="(st.style ?? 'beam') === 'beam'">beam on piers</option><option value="arch" [selected]="st.style === 'arch'">arch</option></select></label>
                  }</div>
                }
                <div class="f"><label>raised by <input type="number" min="0" step="0.5" [value]="st.y ?? 0" (change)="setStruct({ y: num($event) })" /> m</label>
                @if (st.kind !== 'chimney' && st.kind !== 'silo' && st.kind !== 'tank' && st.kind !== 'water_tower') {
                  <label>rotation° <input type="number" step="5" [value]="st.rotDeg.toFixed(0)" (change)="setStruct({ rotDeg: num($event) })" /></label>
                }</div>
                @if (selBlock(); as sb) {
                  <div class="f"><span class="dim">From block “{{ sb.name }}” v{{ sb.ref.v }}</span>
                  @if (sb.latest) {<button class="btn" (click)="updateSelBlock()">Update to v{{ sb.latest }}</button>}
                  <button class="btn" (click)="detachSelBlock()" title="Keep it, forget the block">Detach</button>
                  <button class="btn danger" (click)="removeSelBlock()" title="Remove everything this placement made">Remove placement</button></div>
                }
                <div class="f"><button class="btn" (click)="duplicateStruct()">⧉ Duplicate</button> <button class="btn danger" (click)="deleteSel()">Delete</button></div>
              }
            }
            @case ('under') {
              @if (underSel(); as u) {
                <div class="f"><label class="grow">name <input type="text" class="grow" [value]="u.name" (change)="setUnder({ name: text($event) })" /></label></div>
                <div class="f"><label>floor <input type="number" step="0.5" [value]="u.floor" (change)="setUnder({ floor: num($event) })" /> m</label>
                <label>ceiling <input type="number" step="0.5" [value]="u.ceiling" (change)="setUnder({ ceiling: num($event) })" /> m</label></div>
                <div class="f"><app-pick-menu label="Section" [options]="underShapeOptions" [value]="u.shape" (valueChange)="setUnder({ shape: asUnderShape($event) })" />
                <label>walls <input type="number" min="0.1" max="3" step="0.1" [value]="u.wall" (change)="setUnder({ wall: Math.max(0.1, num($event)) })" /> m</label></div>
                <div class="f"><label>water in it <input type="number" min="0" step="0.1" [value]="u.water ?? 0" (change)="setUnder({ water: Math.max(0, num($event)) || undefined })" /> m</label></div>
                @if (underSection(); as sec) {
                  <svg class="section" viewBox="0 0 260 96" role="img" [attr.aria-label]="'Side view along ' + u.name + ': ground, ceiling and floor'">
                    <rect [attr.x]="sec.x0" [attr.y]="sec.ceil" [attr.width]="sec.x1 - sec.x0" [attr.height]="sec.floor - sec.ceil" fill="#101410" fill-opacity="0.85" stroke="#9b5de5" stroke-width="1.5" />
                    <path [attr.d]="sec.groundFill" fill="#7d6a4f" fill-opacity="0.55" />
                    <path [attr.d]="sec.ground" fill="none" stroke="#c49a6c" stroke-width="1.5" />
                    <text x="4" y="10" font-size="9" fill="#aab9af">{{ sec.top.toFixed(1) }} m</text>
                    <text x="4" y="92" font-size="9" fill="#aab9af">{{ sec.bottom.toFixed(1) }} m</text>
                    <text x="256" y="92" font-size="9" fill="#aab9af" text-anchor="end">{{ sec.len.toFixed(0) }} m</text>
                  </svg>
                }
                <div class="f"><span class="dim">Heights are metres from the bando's zero. It opens where the ground is between floor and ceiling: dashed = covered, dark = open.</span></div>
                <div class="f"><button class="btn danger" (click)="deleteSel()">Delete</button></div>
              }
            }
            @case ('road') {
              @if (roadSel(); as r) {
                <div class="f"><span class="dim">{{ roadLen(r).toFixed(0) }} m long</span></div>
                <div class="f"><app-pick-menu label="Kind" [options]="roadOptions" [value]="r.kind" (valueChange)="setLayer({ kind: asRoad($event) })" />
                <label>width <input type="number" min="0.5" max="40" step="0.5" [value]="r.width" (change)="setLayer({ width: Math.max(0.5, num($event)) })" /> m</label></div>
                <div class="f"><app-pick-menu label="Surface" [options]="roadSurfaceOptions" [value]="r.surface ?? ''" (valueChange)="setLayer({ surface: $event ? asSurface($event) : undefined })" /></div>
                <div class="f"><button class="btn danger" (click)="deleteSel()">Delete</button></div>
              }
            }
            @case ('surface') {
              @if (surfaceSel(); as sf) {
                <div class="f"><app-pick-menu label="Ground" [options]="surfaceOptions" [value]="sf.kind" (valueChange)="setLayer({ kind: asSurface($event) })" /></div>
                <div class="f"><button class="btn danger" (click)="deleteSel()">Delete</button></div>
              }
            }
            @case ('water') {
              @if (waterSel(); as w) {
                <div class="f"><span class="dim">Water · its surface sits just below the lowest bank</span></div>
                <div class="f"><label>depth <input type="number" min="0.2" max="20" step="0.5" [value]="w.depth" (change)="setLayer({ depth: Math.max(0.2, num($event)) })" /> m</label>
                <label>level <input type="number" min="-10" max="5" step="0.1" [value]="w.level ?? -0.3" (change)="setLayer({ level: num($event) })" /> m</label></div>
                <div class="f"><button class="btn danger" (click)="deleteSel()">Delete</button></div>
              }
            }
            @case ('fence') {
              @if (fence(); as w) {
                <div class="f"><span class="dim">{{ fenceLabel(w.material) }} · {{ fenceLen(w).toFixed(1) }} m</span></div>
                <div class="f"><app-pick-menu label="Material" [options]="fenceOptions" [value]="w.material ?? 'masonry'" (valueChange)="setFenceMat(asFence($event))" /></div>
                <div class="f"><label>height <input type="number" min="0.3" step="0.1" [value]="w.height" (change)="setFence({ height: num($event) })" /></label>
                <label>thickness <input type="number" min="0.1" step="0.05" [value]="w.thick" (change)="setFence({ thick: num($event) })" /></label></div>
                <div class="f"><button class="btn danger" (click)="deleteSel()">Delete</button></div>
              }
            }
            @case ('void') {
              @if (voidSel(); as v) {
                <div class="f"><span class="dim">Void · {{ (v.x1 - v.x0).toFixed(1) }} × {{ (v.z1 - v.z0).toFixed(1) }} m · floor {{ levelName(level()) }}</span></div>
                @if (level() === 0) {
                  <div class="f"><label><input type="checkbox" [checked]="!!v.water" (change)="setVoid({ water: checked($event) })" /> water (basin)</label></div>
                }
                <div class="f"><button class="btn danger" (click)="deleteSel()">Delete</button></div>
              }
            }
            @case ('column') {
              @if (colSel(); as c) {
                @if (colIdxs().length > 1) {
                  <div class="f"><span class="dim">{{ colIdxs().length }} columns selected</span></div>
                }
                <div class="f"><span class="dim">select</span>
                <button class="btn" (click)="selectColumns('x')" title="Every column in the same east–west row (double-click a column does the same)">Row</button>
                <button class="btn" (click)="selectColumns('z')" title="Every column in the same north–south line">Line</button>
                <button class="btn" (click)="selectColumns('grid')" title="Every column of the same size and shape on this floor">All alike</button></div>
                <div class="f"><label>size <input type="number" min="0.15" step="0.05" [value]="c.size" (change)="setColumn({ size: num($event) })" /></label>
                <label><input type="checkbox" [checked]="!!c.round" (change)="setColumn({ round: checked($event) })" /> round</label></div>
                <div class="f"><label>from west wall <input type="number" step="0.1" [value]="c.x.toFixed(2)" (change)="setColumn({ x: num($event) })" /></label>
                <label>from north wall <input type="number" step="0.1" [value]="c.z.toFixed(2)" (change)="setColumn({ z: num($event) })" /></label></div>
                <div class="f"><span class="dim">repeat</span><label>× <input type="number" min="2" max="60" step="1" [value]="colN()" (change)="colN.set(num($event))" /></label>
                <label>every <input type="number" min="0.8" step="0.5" [value]="colS()" (change)="colS.set(num($event))" /> m</label>
                <select (change)="colAxis.set(axisOf($event))"><option value="x" [selected]="colAxis() === 'x'">along x (east)</option><option value="z" [selected]="colAxis() === 'z'">along z (south)</option></select></div>
                <div class="f"><button class="btn" (click)="colDup()" title="One copy, spacing away along the chosen direction">⧉ Duplicate</button>
                <button class="btn" (click)="colRowAdd()">Make a row</button>
                <button class="btn" (click)="colFill()" title="Fill the whole floor with columns like this one on a grid of the spacing above (not inside voids)">Fill floor</button></div>
                <div class="f"><button class="btn danger" (click)="deleteSel()">Delete</button></div>
              }
            }
            @case ('wall') {
              <div class="f"><span class="dim">Interior wall</span> <button class="btn danger" (click)="deleteSel()">Delete wall</button></div>
            }
            @default {
              @if (b(); as bd) {
                <div class="sec">
                  <label class="fld span2">name <input type="text" [value]="bd.name" (change)="mutate(setName, text($event))" /></label>
                  @if (!bd.footprint) {
                    <label class="fld">length m <input type="number" min="2" step="0.5" [value]="bd.length.toFixed(1)" (change)="mutate(setLength, num($event))" /></label>
                    <label class="fld">width m <input type="number" min="2" step="0.5" [value]="bd.width.toFixed(1)" (change)="mutate(setWidth, num($event))" /></label>
                  } @else {
                    <div class="span2 dim">Shaped · {{ bd.length.toFixed(1) }} × {{ bd.width.toFixed(1) }} m · {{ bd.footprint.length }} corners
                    <button class="btn" (click)="mutate(toRectangle, 0)" title="Back to a plain rectangle over the bounding box">Reset shape</button></div>
                  }
                  <label class="fld">rotation° <input type="number" step="5" [value]="bd.rotDeg.toFixed(0)" (change)="mutate(setRot, num($event))" /></label>
                  @if (bd.frame) {
                    <label class="fld">arch height <input type="number" min="0.3" max="1.3" step="0.05" [value]="bd.levels[0]?.vaultK ?? 0.7" (change)="editLevel(setArch, num($event))" /></label>
                  } @else if (lvl(); as l) {
                    <label class="fld">wall height m <input type="number" min="1" step="0.5" [value]="l.height" (change)="editLevel(setHeight, num($event))" /></label>
                  }
                </div>
                @if (!bd.frame) {
                  <div class="sec">
                    <div class="st">Floors</div>
                    <div class="row">
                      @for (l of bd.levels; track $index) {
                        <button class="btn" [class.on]="$index === level() && floorFocus()" [class.cur]="$index === level()" (click)="pickLevel($index)" title="Show only this floor solid, the rest of the building ghosted (click again for the whole building)">{{ levelName($index) }}</button>
                      }
                      <button class="btn" (click)="addLevel()" title="Add a floor on top (a copy of the last one; the roof moves up)">＋</button>
                      <button class="btn" [disabled]="bd.levels.length < 2" (click)="removeFloor()" title="Remove the selected floor">－</button>
                    </div>
                    <label class="fld" title="A basement under the ground floor: the ground is cut under the building; reach it through a void in the ground floor">basement m <input type="number" min="0" max="12" step="0.5" [value]="bd.basement?.height ?? 0" (change)="mutate(setBasement, num($event))" /></label>
                  </div>
                  @if (topLevel(); as tl) {
                    <div class="sec">
                      <div class="st">Roof</div>
                      @if (!bd.footprint) {
                        <label class="fld">shape <select (change)="editTop(setRoof, roofOf($event))"><option value="gable" [selected]="tl.roof === 'gable'">gable</option><option value="vault" [selected]="tl.roof === 'vault'">vault</option><option value="flat" [selected]="tl.roof === 'flat'">flat</option></select></label>
                        <label class="fld">repeat × <input type="number" min="1" max="12" step="1" [value]="tl.roofCount ?? tl.vaultCount ?? 1" (change)="editTop(setCount, num($event))" /></label>
                        <label class="chk span2"><input type="checkbox" [checked]="!!tl.roofTurn" (change)="editTop(setTurn, checked($event))" /> turn 90°</label>
                      } @else {
                        <span class="dim span2">flat (shaped building)</span>
                      }
                    </div>
                  }
                  <details class="sec mods">
                    <summary>Modules · repeatable blocks <span class="dim small">(floor {{ levelName(level()) }})</span></summary>
                    @for (pb of patternBlocks(); track pb.id) {
                      <div class="row">
                        <b [title]="pb.description ?? ''">{{ pb.name }}</b>
                        @for (p of pb.params; track p.key) {
                          @if (p.type === 'choice') {
                            <select (change)="setModValue(pb.id, p.key, selValue($event))" [title]="p.label" [attr.aria-label]="p.label">
                              @for (o of p.options ?? []; track o) {
                                <option [value]="o" [selected]="modValue(pb, p.key) === o">{{ sideLabel(o) }}</option>
                              }
                            </select>
                          } @else if (p.type !== 'bool') {
                            <label [title]="p.label">{{ p.label.toLowerCase() }} <input type="number" [min]="p.min ?? null" [max]="p.max ?? null" [step]="p.step ?? (p.type === 'int' ? 1 : 0.5)" [value]="modValue(pb, p.key)" (change)="setModValue(pb.id, p.key, num($event))" /></label>
                          }
                        }
                        <button class="btn" (click)="applyBlockPattern({ block: pb, params: modValues()[pb.id] ?? {}, rot: 0 })" [disabled]="!!bd.footprint && needsRect(pb)" [title]="(pb.description ?? '') + ' Replaces what was there; still editable one by one.'">Apply</button>
                      </div>
                    } @empty {
                      <div class="dim small">No pattern blocks yet: open ▦ Blocks to fetch the catalogue.</div>
                    }
                  </details>
                }
                @if (selBlock(); as sb) {
                  <div class="sec acts">
                    <span class="dim small">From block “{{ sb.name }}” v{{ sb.ref.v }}</span>
                    @if (sb.latest) {<button class="btn" (click)="updateSelBlock()">Update to v{{ sb.latest }}</button>}
                    <button class="btn" (click)="detachSelBlock()" title="Keep it, forget the block">Detach</button>
                    <button class="btn danger" (click)="removeSelBlock()" title="Remove everything this placement made">Remove placement</button>
                  </div>
                }
                <div class="sec acts">
                  <button class="btn" (click)="convertTo(bd.frame ? 'building' : 'greenhouse')" title="Rebuilds it as the other kind: the interior, openings and outline are lost">{{ bd.frame ? '→ Building' : '→ Greenhouse' }}</button>
                  <button class="btn" (click)="duplicate()">⧉ Duplicate</button>
                  <button class="btn danger" (click)="deleteSel()">Delete</button>
                </div>
              } @else {
                <div class="dim">Click a building, tree, door or window on the map. Use the tools above to add or reshape.</div>
              }
            }
          }
        </app-float-box>
      }
    </div>

    <div class="foot">
      <span class="dim small grow">{{ hint() }}</span>
      @if (mode() === 'area') {
        <span class="grp areas" role="group" aria-label="Areas">
          <button class="btn" (click)="studio.addArea()" title="Keep this framed area and frame another one: they are generated together">＋ Add area</button>
          @for (a of studio.areas(); track $index) {
            <span class="chip">Area {{ $index + 1 }} <button class="x" (click)="studio.removeArea($index)" [attr.aria-label]="'Remove area ' + ($index + 1)" title="Remove this area">✕</button></span>
          }
          @if (studio.areas().length) {
            <label class="lay" title="On: one bando covering the areas and the ground between them. Off: only what is inside each area."><input type="checkbox" [checked]="studio.fillGaps()" (change)="studio.fillGaps.set(checked($event))" /> fill the gaps</label>
          }
        </span>
        <button class="btn" (click)="setServer()" title="Use your own OpenStreetMap data server (e.g. the PHP proxy) instead of the public ones">Data server…</button>
        <button class="btn primary" (click)="generate()" [disabled]="studio.busy()">{{ studio.busy() ? 'Building…' : studio.isNew() ? 'Generate 3D' : 'Regenerate 3D' }}</button>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
      gap: 4px;
    }
    .bar {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      align-items: center;
    }
    .seg {
      display: inline-flex;
      border: 1px solid var(--line);
      border-radius: 6px;
      overflow: hidden;
    }
    .seg button {
      background: none;
      border: 0;
      padding: 3px 9px;
      cursor: pointer;
      color: var(--dim);
    }
    .seg button.on {
      background: var(--accent);
      color: var(--accent-ink);
      font-weight: 700;
    }
    .sp {
      flex: 1;
    }
    /* the tool palette and its options sit above the float boxes (inspector, elements, assistant) */
    .palette {
      position: absolute;
      left: 8px;
      top: 8px;
      z-index: 1250;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px;
      background: var(--panel-solid);
      border: 1px solid var(--line);
      border-radius: 9px;
    }
    .pg {
      position: relative;
    }
    /* the corner mark that says "more tools here" */
    .tri {
      position: absolute;
      right: 1px;
      bottom: 1px;
      width: 10px;
      height: 10px;
      clip-path: polygon(100% 0, 100% 100%, 0 100%);
      background: var(--dim);
    }
    .tri:hover {
      background: var(--text);
    }
    .fly {
      position: absolute;
      left: calc(100% + 6px);
      top: 0;
      z-index: 1260;
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 150px;
      padding: 4px;
      background: var(--panel-solid);
      border: 1px solid var(--line);
      border-radius: 9px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
    }
    .fbtn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 8px;
      white-space: nowrap;
      color: var(--text, #e8efe9);
      background: none;
      border: 1px solid transparent;
      border-radius: 6px;
      cursor: pointer;
    }
    .fbtn:hover {
      background: rgba(255, 255, 255, 0.08);
    }
    .fbtn.on {
      background: rgba(255, 255, 255, 0.13);
      border-color: var(--tc);
    }
    .ctx {
      position: absolute;
      z-index: 1300;
      display: flex;
      flex-direction: column;
      min-width: 170px;
      padding: 4px;
      background: var(--panel-solid);
      border: 1px solid var(--line);
      border-radius: 9px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    }
    .ctx button {
      text-align: left;
      padding: 5px 10px;
      color: var(--text, #e8efe9);
      background: none;
      border: 0;
      border-radius: 6px;
      cursor: pointer;
    }
    .ctx button:hover {
      background: rgba(255, 255, 255, 0.1);
    }
    .ctx button.danger {
      color: #ff8a8a;
    }
    .ctx .head {
      padding: 3px 10px;
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--dim);
    }
    .pbtn {
      position: relative;
      width: 32px;
      height: 32px;
      display: grid;
      place-items: center;
      padding: 0;
      font-size: 16px;
      line-height: 1;
      color: var(--text, #e8efe9);
      background: none;
      border: 1px solid transparent;
      border-radius: 6px;
      cursor: pointer;
    }
    .pbtn::after {
      content: '';
      position: absolute;
      right: 3px;
      bottom: 3px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--tc);
    }
    .pbtn:hover {
      background: rgba(255, 255, 255, 0.08);
    }
    .pbtn.on {
      background: rgba(255, 255, 255, 0.13);
      border-color: var(--tc);
    }
    /* the handle that moves a toolbar */
    .tgrip {
      display: grid;
      place-items: center;
      height: 14px;
      color: var(--dim);
      cursor: grab;
      touch-action: none;
      font-size: 11px;
      line-height: 1;
    }
    .tgrip:hover {
      color: var(--text);
    }
    .opts .tgrip {
      height: auto;
      padding: 0 2px;
    }
    .psep {
      display: block;
      height: 1px;
      margin: 3px 2px;
      background: var(--line);
    }
    .opts {
      /* left / right / top are bound: beside the active tool, or where it was dragged */
      position: absolute;
      z-index: 1250;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 10px;
      padding: 4px 8px;
      font-size: 12px;
      background: var(--panel-solid);
      border: 1px solid var(--line);
      border-radius: 9px;
    }
    .grp {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-wrap: wrap;
    }
    input.mini {
      width: 54px;
    }
    .ov.cap.placing .hit {
      pointer-events: none;
    }
    .ov.indoor .out {
      opacity: 0.22;
      pointer-events: none;
    }
    .lay {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
    }
    .lay input[type='range'] {
      width: 56px;
    }
    .wrap {
      position: relative;
      /* dragging on the plan must never select the labels under the pointer */
      user-select: none;
      -webkit-user-select: none;
      flex: 1 1 auto;
      min-height: 240px;
      border-radius: 6px;
      overflow: hidden;
      background: #0a0f0c;
      outline: none;
    }
    .map {
      position: absolute;
      inset: 0;
    }
    .wrap.v3 .map {
      visibility: hidden;
    }
    .ov {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: 700;
      pointer-events: none;
      touch-action: none;
    }
    .ov.cap {
      pointer-events: auto;
      cursor: crosshair;
    }
    .ov.cap.sel {
      cursor: default;
    }
    .ov .hit {
      pointer-events: auto;
      cursor: pointer;
    }
    .ov .rotk {
      cursor: grab;
    }
    .section {
      flex: 1 1 100%;
      width: 100%;
      height: auto;
      background: #0a0f0c;
      border: 1px solid var(--line);
      border-radius: 6px;
    }
    /* surfaces and water are picked by their edge only: a click inside them still pans the map or selects what is on them */
    .ov .hit.edge {
      pointer-events: visibleStroke;
      stroke-linejoin: round;
    }
    .frame {
      position: absolute;
      z-index: 700;
      pointer-events: none;
      border: 2px dashed var(--accent);
      box-shadow: 0 0 0 9999px rgba(8, 14, 10, 0.5);
    }
    .h {
      position: absolute;
      pointer-events: auto;
      touch-action: none;
    }
    .h.n, .h.s { left: 12px; right: 12px; height: 14px; cursor: ns-resize; }
    .h.e, .h.w { top: 12px; bottom: 12px; width: 14px; cursor: ew-resize; }
    .h.n { top: -8px; } .h.s { bottom: -8px; }
    .h.e { right: -8px; } .h.w { left: -8px; }
    .h.nw, .h.ne, .h.sw, .h.se { width: 18px; height: 18px; background: var(--accent); border-radius: 3px; border: 2px solid #12200b; }
    .h.nw { top: -10px; left: -10px; cursor: nwse-resize; }
    .h.se { bottom: -10px; right: -10px; cursor: nwse-resize; }
    .h.ne { top: -10px; right: -10px; cursor: nesw-resize; }
    .h.sw { bottom: -10px; left: -10px; cursor: nesw-resize; }
    .rotk {
      position: absolute;
      left: 50%;
      top: -30px;
      width: 16px;
      height: 16px;
      margin-left: -8px;
      border-radius: 50%;
      background: #ffd166;
      border: 2px solid #12200b;
      cursor: grab;
      pointer-events: auto;
      touch-action: none;
    }
    .search {
      position: absolute;
      z-index: 1100;
      top: 8px;
      left: 8px;
      right: 56px;
      display: flex;
      gap: 6px;
    }
    .search input {
      flex: 1;
    }
    .hits {
      position: absolute;
      z-index: 1100;
      top: 40px;
      left: 8px;
      right: 56px;
      max-height: 40%;
      overflow: auto;
      background: var(--panel-solid);
      border: 1px solid var(--line);
      border-radius: 6px;
      display: flex;
      flex-direction: column;
    }
    .hits button {
      background: none;
      border: 0;
      border-bottom: 1px solid var(--line);
      text-align: left;
      padding: 5px 8px;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .hits button:hover {
      background: #31443a;
    }
    .compass {
      position: absolute;
      z-index: 1100;
      right: 8px;
      top: 8px;
      width: 46px;
      height: 46px;
      pointer-events: none;
    }
    .spin {
      display: inline-block;
      width: 11px;
      height: 11px;
      border: 2px solid var(--dim);
      border-top-color: var(--accent);
      border-radius: 50%;
      vertical-align: -1px;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    .read {
      position: absolute;
      z-index: 1100;
      left: 50%;
      bottom: 12px;
      transform: translateX(-50%);
      background: rgba(10, 16, 12, 0.85);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 2px 10px;
      font: 600 12px var(--mono);
      pointer-events: none;
    }
    .read.warn {
      color: var(--warn);
      border-color: var(--warn);
    }
    .notice {
      position: absolute;
      z-index: 1100;
      left: 12px;
      right: 12px;
      top: 12px;
      background: var(--panel-solid);
      border: 1px solid var(--warn);
      border-radius: 8px;
      padding: 8px 10px;
    }
    .foot {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 4px 1px 8px;
      border: 1px dashed #ffd166;
      border-radius: 9px;
      font-size: 11px;
    }
    .chip .x {
      background: none;
      border: 0;
      color: var(--dim);
      cursor: pointer;
      padding: 0 2px;
    }
    .chip .x:hover {
      color: var(--text);
    }
    .f {
      display: flex;
      flex: 0 1 auto;
      flex-wrap: wrap;
      gap: 4px 8px;
      align-items: center;
    }
    .f > label {
      min-width: 0;
    }
    .f input[type='text'] {
      min-width: 0;
      flex: 1;
    }
    .f label {
      display: inline-flex;
      gap: 4px;
      align-items: center;
    }
    .f input[type='number'] {
      width: 64px;
    }
    .mods {
      padding-top: 6px;
    }
    .mods summary {
      cursor: pointer;
    }
    /* inspector sections: a caption, then fields two to a row */
    .sec {
      flex: 1 1 100%;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 8px;
      align-items: end;
      padding-top: 6px;
      border-top: 1px solid var(--line);
    }
    .sec > .st {
      grid-column: 1 / -1;
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--dim);
    }
    .sec .span2,
    .sec .row {
      grid-column: 1 / -1;
    }
    .sec .row {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 6px;
      align-items: center;
    }
    .fld {
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 11px;
      color: var(--dim);
      min-width: 0;
    }
    .fld input,
    .fld select {
      width: 100%;
      box-sizing: border-box;
    }
    .chk {
      display: inline-flex;
      gap: 6px;
      align-items: center;
    }
    .sec.acts {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    details.sec.mods {
      display: block;
    }
    .btn.cur:not(.on) {
      border-color: var(--accent);
    }
  `,
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
  private static readonly TERRAIN: readonly { op: TerrainOp; icon: string; name: string }[] = [
    { op: 'raise', icon: 'terrainRaise', name: 'Terrain · raise' },
    { op: 'lower', icon: 'terrainLower', name: 'Terrain · lower' },
    { op: 'smooth', icon: 'terrainSmooth', name: 'Terrain · smooth' },
    { op: 'flatten', icon: 'terrainFlatten', name: 'Terrain · flatten' },
    { op: 'hill', icon: 'terrainHill', name: 'Terrain · hill' },
    { op: 'crater', icon: 'terrainCrater', name: 'Terrain · crater' },
    { op: 'ramp', icon: 'ramp', name: 'Terrain · ramp' },
  ];
  /** Every tool on offer right now, with the brush expanded to its shapes. */
  protected readonly entries = computed<Entry[]>(() =>
    this.visibleTools().flatMap((t): Entry[] =>
      t.id === 'scatter'
        ? BandoEditor.SCATTER.map((m) => ({ key: `scatter:${m.mode}`, tool: t.id, mode: m.mode, icon: m.icon, name: m.name, color: t.color, hint: t.hint, group: t.group }))
        : t.id === 'terrain'
          ? BandoEditor.TERRAIN.map((m) => ({ key: `terrain:${m.op}`, tool: t.id, op: m.op, icon: m.icon, name: m.name, color: t.color, hint: t.hint, group: t.group }))
          : [{ key: t.id, tool: t.id, icon: t.icon, name: t.name, color: t.color, hint: t.hint, group: t.group, sep: t.sep }],
    ),
  );
  private entryOn(e: Entry): boolean {
    return this.tool() === e.tool && (!e.mode || this.scatterMode() === e.mode) && (!e.op || this.terrainOp() === e.op);
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

  // ---- movable toolbars: the palette and the options bar remember where they were dragged ----
  private readonly palEl = viewChild<ElementRef<HTMLElement>>('pal');
  /** Where the palette was dragged (null = top-left corner) and where the options bar was (null = beside the active tool). */
  private readonly palPos = signal<XY | null>(BandoEditor.loadXY('palette'));
  private readonly optsPos = signal<XY | null>(BandoEditor.loadXY('opts'));
  /** The active tool button inside the palette, measured after every render: the options bar lines up with it. */
  private readonly toolBtn = signal<{ top: number; palW: number }>({ top: 0, palW: 46 });
  private tb: { which: 'pal' | 'opts'; dx: number; dy: number } | null = null;
  protected readonly palXY = computed(() => {
    const p = this.palPos(), { w, h } = this.size();
    return p ? { x: Math.max(0, Math.min(w - 46, p.x)), y: Math.max(0, Math.min(h - 60, p.y)) } : { x: 8, y: 8 };
  });
  /** Beside the active tool, on the side of the palette with more room (right by default); or where it was dragged. */
  protected readonly optsXY = computed<{ left: number | null; right: number | null; top: number; max: number }>(() => {
    const { w, h } = this.size();
    const o = this.optsPos();
    if (o) return { left: Math.max(0, Math.min(w - 120, o.x)), right: null, top: Math.max(0, Math.min(h - 36, o.y)), max: w - Math.max(0, Math.min(w - 120, o.x)) - 8 };
    const pal = this.palXY(), btn = this.toolBtn();
    const top = Math.max(0, Math.min(h - 36, pal.y + btn.top));
    const onRight = pal.x + btn.palW / 2 < w / 2;
    return onRight
      ? { left: pal.x + btn.palW + 6, right: null, top, max: w - (pal.x + btn.palW + 6) - 8 }
      : { left: null, right: w - pal.x + 6, top, max: pal.x - 14 };
  });
  private static loadXY(k: string): XY | null {
    try {
      const v = JSON.parse(localStorage.getItem(`abando-float-${k}`) ?? 'null') as XY | null;
      return v && isFinite(v.x) && isFinite(v.y) ? v : null;
    } catch {
      return null;
    }
  }
  private static saveXY(k: string, v: XY | null): void {
    try {
      if (v) localStorage.setItem(`abando-float-${k}`, JSON.stringify(v));
      else localStorage.removeItem(`abando-float-${k}`);
    } catch {
      /* no storage */
    }
  }
  protected tbDown(e: PointerEvent, which: 'pal' | 'opts'): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = (e.currentTarget as HTMLElement).parentElement!;
    const box = el.getBoundingClientRect(), host = this.wrapEl().nativeElement.getBoundingClientRect();
    this.tb = { which, dx: e.clientX - box.left, dy: e.clientY - box.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // the bar is about to be placed by hand: start from where it is drawn now
    const at = { x: box.left - host.left, y: box.top - host.top };
    if (which === 'pal') this.palPos.set(at);
    else this.optsPos.set(at);
  }
  protected tbMove(e: PointerEvent): void {
    const t = this.tb;
    if (!t) return;
    const host = this.wrapEl().nativeElement.getBoundingClientRect();
    const at = { x: e.clientX - host.left - t.dx, y: e.clientY - host.top - t.dy };
    if (t.which === 'pal') this.palPos.set(at);
    else this.optsPos.set(at);
  }
  protected tbUp(e: PointerEvent): void {
    const t = this.tb;
    this.tb = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (!t) return;
    if (t.which === 'pal') BandoEditor.saveXY('palette', this.palPos());
    else BandoEditor.saveXY('opts', this.optsPos());
  }
  protected tbReset(which: 'pal' | 'opts'): void {
    if (which === 'pal') {
      this.palPos.set(null);
      BandoEditor.saveXY('palette', null);
    } else {
      this.optsPos.set(null);
      BandoEditor.saveXY('opts', null);
    }
  }
  /** The group whose flyout is open. */
  protected readonly fly = signal<string | null>(null);
  private pressT: ReturnType<typeof setTimeout> | undefined;
  private longPressed = false;

  protected pickEntry(e: Entry): void {
    const def = this.tools.find((t) => t.id === e.tool);
    if (def?.needsBuilding && (!this.b() || this.b()!.frame)) this.toast.show(this.b()?.frame ? `${e.name} does not work on a greenhouse.` : `${e.name}: select a building first, then use it.`);
    this.groupCur.update((g) => ({ ...g, [e.group]: e.key }));
    if (e.mode) this.scatterMode.set(e.mode);
    if (e.op) this.terrainOp.set(e.op);
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
  /** The pointer on the map while the measure tool waits for its second point (the live line). */
  protected readonly measHover = signal<Pt | null>(null);
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

  // ---- blocks: placing from the library ----
  private readonly shapeBoxes = new WeakMap<object, { x0: number; z0: number; x1: number; z1: number }>();
  /** The plan footprint of an object made of shapes (remembered per shapes list). */
  protected shapesBox(st: StructureSpec): { x0: number; z0: number; x1: number; z1: number } {
    const key = st.shapes ?? st;
    let b = this.shapeBoxes.get(key);
    if (!b) this.shapeBoxes.set(key, (b = shapesFootprint(expandShapes(st.shapes ?? []))));
    return b;
  }
  protected readonly blocksOpen = signal(false);
  /** The block waiting for a click on the map. */
  protected readonly armed = signal<BlockArm | null>(null);
  private readonly blockLib = inject(BlockLibraryService);
  protected armBlock(a: BlockArm): void {
    this.setTool('select');
    this.armed.set(a);
    this.view3d.set(false);
    this.toast.show(`Click the map to place “${a.block.name}”. Esc stops.`);
  }
  private placeArmed(a: BlockArm, p: Pt): void {
    let r = { placed: 0, inst: '' };
    this.ed.commitSite((s) => {
      r = placeBlock(s, a.block, a.params, { x: snap(p.x, 0.5), z: snap(p.z, 0.5) }, a.rot);
    });
    if (!r.placed) {
      this.ed.undo();
      this.toast.show('Nothing could be placed from that block.');
      return;
    }
    const st = this.ed.draft().structures ?? [];
    const bi = this.ed.draft().buildings.findIndex((x) => x.block?.inst === r.inst);
    if (bi >= 0) {
      this.ed.select(this.ed.draft().buildings[bi]!.id);
      this.pick.set({ t: 'building' });
    } else {
      const si = st.findIndex((x) => x.block?.inst === r.inst);
      if (si >= 0) this.pick.set({ t: 'structure', i: si });
    }
    this.applyNow();
  }
  protected applyBlockPattern(a: BlockArm): void {
    const id = this.ed.selectedId();
    if (!id) return void this.toast.show('Select a building first.');
    let done: string[] = [];
    this.ed.commitSite((s) => {
      const x = this.index(s, id);
      if (x) done = applyPattern(x, Math.min(this.level(), x.levels.length - 1), a.block, a.params);
    });
    this.colSet.set([]);
    this.applyNow();
    this.toast.show(done.length ? `“${a.block.name}” on floor ${this.levelName(this.level())}: ${done.join(', ')}.` : 'That pattern changed nothing here.');
  }
  /** The block a selected building or structure was placed from, and whether a newer version exists. */
  protected readonly selBlock = computed(() => {
    const p = this.pick();
    const ref = p?.t === 'structure' ? this.structSel()?.block : p?.t === 'building' || !p ? this.b()?.block : undefined;
    if (!ref) return null;
    const lib = this.blockLib.get(ref.id);
    return { ref, name: lib?.name ?? ref.id, latest: lib && lib.version > ref.v ? lib.version : null };
  });
  protected updateSelBlock(): void {
    const sb = this.selBlock(), lib = sb ? this.blockLib.get(sb.ref.id) : null;
    if (!sb || !lib) return;
    this.ed.commitSite((s) => void updateInstance(s, sb.ref.inst, lib));
    this.applyNow();
    this.toast.show(`Updated to v${lib.version}.`);
  }
  protected detachSelBlock(): void {
    const sb = this.selBlock();
    if (!sb) return;
    this.ed.commitSite((s) => detachInstance(s, sb.ref.inst));
    this.applyNow();
  }
  protected removeSelBlock(): void {
    const sb = this.selBlock();
    if (!sb) return;
    this.ed.commitSite((s) => removeInstance(s, sb.ref.inst));
    this.pick.set(null);
    this.applyNow();
  }

  // ---- ground layers: roads, surfaces, water ----
  protected readonly roadKind = signal<RoadKind>('road');
  protected readonly roadWidth = signal(6);
  protected readonly surfaceKind = signal<SurfaceKind>('asphalt');
  protected readonly waterDepth = signal(1.5);
  protected readonly roadOptions: readonly PickOption[] = ROADS.map((r) => ({ id: r.id, label: r.label, icon: ROAD_ICON[r.id], hint: `${r.width} m wide by default` }));
  protected readonly surfaceOptions: readonly PickOption[] = SURFACES.map((x) => ({ id: x.id, label: x.label, icon: SURFACE_ICON[x.id] }));
  protected readonly roadSurfaceOptions: readonly PickOption[] = [{ id: '', label: 'As its kind', icon: 'road' }, ...this.surfaceOptions];
  protected asRoad = (v: string): RoadKind => roadDef(v as RoadKind).id;
  protected asSurface = (v: string): SurfaceKind => surfaceDef(v as SurfaceKind).id;
  protected roadColor = (r: RoadSpec): string => (r.surface ? surfaceDef(r.surface).color : roadDef(r.kind).color);
  protected surfColor = (k: SurfaceKind): string => surfaceDef(k).color;
  protected readonly waterColor = WATER_COLOR;
  protected polyPts = (pts: readonly Pt[]): string => pts.map((q) => `${q.x},${q.z}`).join(' ');
  /** The line / outline being drawn with a layer tool. */
  protected readonly layerPreview = computed(() => {
    const d = this.drag();
    return d?.t === 'layer' ? this.polyPts(d.pts) : '';
  });
  protected setRoadKind(k: RoadKind): void {
    this.roadKind.set(k);
    this.roadWidth.set(roadDef(k).width);
  }
  /** A finished drag: a road along it, or a surface / water inside it (one undo step). */
  private commitLayer(raw: Pt[]): void {
    const t = this.tool();
    const pts = simplifyPath(raw, Math.max(0.3, 3 / this.ppm()));
    if (t === 'road') {
      if (pts.length < 2 || Math.hypot(pts[pts.length - 1]!.x - pts[0]!.x, pts[pts.length - 1]!.z - pts[0]!.z) < 2) return void this.toast.show('Drag along the way to draw a road.');
      this.ed.commitSite((s) => void (s.roads ??= []).push({ pts, width: this.roadWidth(), kind: this.roadKind() }));
      this.pick.set({ t: 'road', i: (this.ed.draft().roads?.length ?? 1) - 1 });
    } else {
      if (pts.length < 3) return void this.toast.show('Draw a loop: the outline of the area.');
      if (t === 'surface') {
        this.ed.commitSite((s) => void (s.surfaces ??= []).push({ pts, kind: this.surfaceKind() }));
        this.pick.set({ t: 'surface', i: (this.ed.draft().surfaces?.length ?? 1) - 1 });
      } else {
        this.ed.commitSite((s) => {
          s.terrain ??= defaultTerrain(s.extent); // a basin is dug into the ground: the ground must be a terrain
          (s.waters ??= []).push({ pts, depth: this.waterDepth() });
        });
        this.pick.set({ t: 'water', i: (this.ed.draft().waters?.length ?? 1) - 1 });
      }
    }
    this.applyNow();
  }
  protected readonly roadSel = computed(() => {
    const p = this.pick();
    return p?.t === 'road' ? (this.ed.draft().roads?.[p.i] ?? null) : null;
  });
  protected readonly surfaceSel = computed(() => {
    const p = this.pick();
    return p?.t === 'surface' ? (this.ed.draft().surfaces?.[p.i] ?? null) : null;
  });
  protected readonly waterSel = computed(() => {
    const p = this.pick();
    return p?.t === 'water' ? (this.ed.draft().waters?.[p.i] ?? null) : null;
  });
  protected isPicked = (t: 'road' | 'surface' | 'water', i: number): boolean => {
    const p = this.pick();
    return p?.t === t && p.i === i;
  };
  /** Edit the selected road / surface / water (one undo step). */
  protected setLayer(patch: { kind?: RoadKind | SurfaceKind; width?: number; surface?: SurfaceKind; depth?: number; level?: number }): void {
    const p = this.pick();
    if (p?.t !== 'road' && p?.t !== 'surface' && p?.t !== 'water') return;
    this.ed.commitSite((s) => {
      const list: object[] | undefined = p.t === 'road' ? s.roads : p.t === 'surface' ? s.surfaces : s.waters;
      const x = list?.[p.i] as Record<string, unknown> | undefined;
      if (!x) return;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete x[k];
        else x[k] = v;
      }
    });
    this.applyNow();
  }
  protected layerDown(e: PointerEvent, t: 'road' | 'surface' | 'water', i: number): void {
    const tool = this.tool();
    if (tool !== 'select') return this.bgDown(e);
    e.stopPropagation();
    this.capture(e);
    this.pick.set({ t, i });
  }
  protected roadLen = (r: RoadSpec): number => r.pts.slice(1).reduce((a, q, i) => a + Math.hypot(q.x - r.pts[i]!.x, q.z - r.pts[i]!.z), 0);

  // ---- underground: tunnels and rooms ----
  protected readonly underKind = signal<'tunnel' | 'room'>('tunnel');
  protected readonly underWidth = signal(4);
  protected readonly underHeight = signal(3.5);
  protected readonly underDepth = signal(1);
  protected readonly underShape = signal<UndergroundSpec['shape']>('box');
  protected readonly underKindOptions: readonly PickOption[] = [
    { id: 'tunnel', label: 'Tunnel', icon: 'tunnel', hint: 'Drag from end to end' },
    { id: 'room', label: 'Room', icon: 'bunker', hint: 'Drag a rectangle (bunker, basement)' },
  ];
  protected readonly underShapeOptions: readonly PickOption[] = [
    { id: 'box', label: 'Box', icon: 'culvertBox', hint: 'Concrete box section' },
    { id: 'pipe', label: 'Pipe', icon: 'culvertPipe', hint: 'Round culvert' },
    { id: 'vault', label: 'Vault', icon: 'culvertVault', hint: 'Brick vault' },
  ];
  protected asUnderShape = (v: string): UndergroundSpec['shape'] => (v === 'pipe' || v === 'vault' ? v : 'box');
  /** The outline being dragged (site metres) as SVG points. */
  protected readonly underPreview = computed(() => {
    const d = this.drag();
    if (d?.t !== 'under') return '';
    return this.polyPts(this.underOutline(d.a, d.b));
  });
  private underOutline(a: Pt, b: Pt): Pt[] {
    if (this.underKind() === 'tunnel') return tunnelOutline(a, b, this.underWidth());
    return [a, { x: b.x, z: a.z }, b, { x: a.x, z: b.z }];
  }
  private commitUnder(a: Pt, b: Pt): void {
    const room = this.underKind() === 'room';
    if (room ? Math.abs(b.x - a.x) < 2 || Math.abs(b.z - a.z) < 2 : Math.hypot(b.x - a.x, b.z - a.z) < 3) return void this.toast.show(room ? 'Drag a rectangle at least 2 m each way.' : 'Drag from one end of the tunnel to the other.');
    const n = (this.ed.draft().underground?.length ?? 0) + 1;
    const g = this.ground();
    const v: UndergroundSpec = room
      ? { id: uid('ug'), name: `Room ${n}`, outline: this.underOutline(a, b), floor: Math.round((Math.min(g.at(a.x, a.z), g.at(b.x, b.z)) - this.underDepth() - this.underHeight()) * 10) / 10, ceiling: 0, shape: 'box', wall: 0.4 }
      : newTunnel(g.grid, a, b, { width: this.underWidth(), height: this.underHeight(), depth: this.underDepth(), shape: this.underShape(), id: uid('ug'), name: `Tunnel ${n}` });
    if (room) v.ceiling = v.floor + this.underHeight();
    this.ed.commitSite((s) => {
      s.terrain ??= defaultTerrain(s.extent); // the ground must be a terrain to be cut where the tunnel opens
      (s.underground ??= []).push(v);
    });
    this.pick.set({ t: 'under', i: n - 1 });
    this.applyNow();
    this.toast.show(`${v.name}: floor ${v.floor} m, ceiling ${v.ceiling} m. It is open where the ground is between them (dark on the plan); deeper ground covers it.`, 4000);
  }
  protected readonly underSel = computed(() => {
    const p = this.pick();
    return p?.t === 'under' ? (this.ed.draft().underground?.[p.i] ?? null) : null;
  });
  /** The side view of the selected volume, scaled into a 260 × 96 drawing: ground line, and its inside as a box. */
  protected readonly underSection = computed(() => {
    const u = this.underSel();
    if (!u) return null;
    const p = sectionProfile(u, this.ground().at, 64);
    const top = Math.max(...p.ground, p.ceiling + p.wall) + 1, bottom = Math.min(...p.ground, p.floor - p.wall) - 1;
    const W = 252, H = 80, sx = W / p.len, sy = H / Math.max(1, top - bottom);
    const X = (t: number): number => 4 + t * sx, Y = (h: number): number => 8 + (top - h) * sy;
    const pts = p.ground.map((h, i) => `${X((p.len * i) / (p.ground.length - 1)).toFixed(1)},${Y(h).toFixed(1)}`);
    const pad = (p.len - (tunnelAxis(u) ? Math.hypot(tunnelAxis(u)!.b.x - tunnelAxis(u)!.a.x, tunnelAxis(u)!.b.z - tunnelAxis(u)!.a.z) : p.len)) / 2;
    return {
      ground: 'M' + pts.join('L'),
      groundFill: 'M' + pts.join('L') + `L${X(p.len)},${8 + H}L${X(0)},${8 + H}Z`,
      x0: X(Math.max(0, pad)), x1: X(p.len - Math.max(0, pad)), ceil: Y(p.ceiling), floor: Y(p.floor), top, bottom, len: p.len,
    };
  });
  protected setUnder(patch: Partial<UndergroundSpec>): void {
    const p = this.pick();
    if (p?.t !== 'under') return;
    this.ed.commitSite((s) => {
      const v = s.underground?.[p.i];
      if (!v) return;
      Object.assign(v, patch);
      if (v.ceiling < v.floor + 0.8) v.ceiling = v.floor + 0.8;
    });
    this.applyNow();
  }
  protected underDown(e: PointerEvent, i: number): void {
    if (this.tool() !== 'select') return this.bgDown(e);
    e.stopPropagation();
    this.capture(e);
    this.pick.set({ t: 'under', i });
  }
  /** Where the ground is cut by underground volumes (the openings), as one SVG path of grid cells. */
  protected readonly cutCells = computed(() => {
    const g = this.ground();
    if (!g.grid || !g.cut) return '';
    const out: string[] = [];
    const c = g.grid.cell;
    for (let k = 0; k < g.cut.length; k++) {
      if (!g.cut[k]) continue;
      const i = k % g.grid.nx, j = (k - i) / g.grid.nx;
      out.push(`M${g.grid.x0 + i * c - c / 2} ${g.grid.z0 + j * c - c / 2}h${c}v${c}h${-c}Z`);
    }
    return out.join('');
  });

  // ---- terrain brushes ----
  /** How the terrain is drawn in 3D (and, as a height map, under the 2D plan). */
  protected readonly groundStyle = signal<GroundStyle>('natural');
  protected asGroundStyle = (e: Event): GroundStyle => {
    const v = (e.target as HTMLSelectElement).value;
    return v === 'height' || v === 'wire' ? v : 'natural';
  };
  /** The brush ring in the 3D view while a terrain tool is active. */
  protected readonly cursor3d = computed(() => {
    const h = this.hover();
    if (!h || !this.view3d() || this.tool() !== 'terrain') return null;
    return { x: h.x, z: h.z, r: this.terrainOp() === 'ramp' ? this.terrRadius() / 2 : this.terrRadius(), color: this.tc('terrain') };
  });
  /** The height map under the 2D plan: one pixel per two grid cells, as an image over the grid's extent. */
  protected readonly heightImage = computed(() => {
    const g = this.ground().grid;
    if (!g || this.groundStyle() !== 'height') return null;
    const step = 2, w = Math.ceil(g.nx / step), h = Math.ceil(g.nz / step);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const cx = c.getContext('2d');
    if (!cx) return null;
    const img = cx.createImageData(w, h);
    const { lo, hi } = heightRange(g);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const [r, gg, b] = heightColor(g.h[Math.min(g.nz - 1, j * step) * g.nx + Math.min(g.nx - 1, i * step)]!, lo, hi);
        const k = (j * w + i) * 4;
        img.data[k] = r * 255;
        img.data[k + 1] = gg * 255;
        img.data[k + 2] = b * 255;
        img.data[k + 3] = 170;
      }
    }
    cx.putImageData(img, 0, 0);
    return { href: c.toDataURL(), x: g.x0, z: g.z0, w: (g.nx - 1) * g.cell, d: (g.nz - 1) * g.cell };
  });
  protected readonly terrainOp = signal<TerrainOp>('raise');
  protected readonly terrRadius = signal(8);
  protected readonly terrStrength = signal(2);
  protected readonly terrFalloff = signal<Falloff>('smooth');
  protected readonly terrOpOptions: readonly PickOption[] = BandoEditor.TERRAIN.map((t) => ({ id: t.op, label: t.op[0]!.toUpperCase() + t.op.slice(1), icon: t.icon }));
  protected readonly falloffOptions: readonly PickOption[] = [
    { id: 'smooth', label: 'Soft edge', icon: 'terrainHill', hint: 'Rounded, natural' },
    { id: 'linear', label: 'Straight edge', icon: 'ramp', hint: 'A steady slope to the rim' },
    { id: 'flat', label: 'Hard edge', icon: 'terrainFlatten', hint: 'Full strength almost to the rim' },
  ];
  protected asOp = (v: string): TerrainOp => BandoEditor.TERRAIN.find((t) => t.op === v)?.op ?? 'raise';
  protected asFalloff = (v: string): Falloff => (v === 'linear' || v === 'flat' ? v : 'smooth');
  /** What "strength" means for the current operation, for its label. */
  protected readonly terrStrengthLabel = computed(() => ({ raise: 'up', lower: 'down', smooth: 'amount %', flatten: '', hill: 'height', crater: 'depth', ramp: 'rise' })[this.terrainOp()]);
  /** The ground the editor shows (contours, the height under the pointer): the draft's terrain, same cache as the 3D model. */
  private readonly ground = computed(() => siteGround(this.ed.draft()));
  private contourCache: { grid: unknown; out: { minor: string; major: string } } | null = null;
  protected readonly contours = computed(() => {
    const g = this.ground().grid;
    if (!g) return null;
    if (this.contourCache?.grid !== g) this.contourCache = { grid: g, out: contourPaths(g) };
    return this.contourCache.out;
  });
  /** Height of the ground under the pointer while a terrain tool is active. */
  protected readonly groundUnder = computed(() => {
    const h = this.hover();
    return this.tool() === 'terrain' && h ? this.ground().at(h.x, h.z) : null;
  });
  /** The stroke being painted, as an SVG path, and the brush footprint under the pointer. */
  protected readonly terrPreview = computed(() => {
    const d = this.drag();
    const pts = d?.t === 'terrain' ? d.pts : [];
    return pts.length > 1 ? 'M' + pts.map((q) => `${q.x} ${q.z}`).join('L') : '';
  });
  /** Turn a finished drag into a stroke on the spec (the terrain is created flat on first use). */
  private commitTerrain(pts: Pt[], h0: number): void {
    const op = this.terrainOp(), r = this.terrRadius(), k = this.terrStrength();
    let stroke: TerrainStroke;
    if (op === 'hill' || op === 'crater') stroke = { op, pts: [pts[0]!], radius: r, strength: Math.abs(k), falloff: this.terrFalloff() };
    else if (op === 'ramp') {
      if (pts.length < 2 || Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.z - pts[0]!.z) < 2) {
        this.toast.show('Drag from the foot of the ramp to its top.');
        return;
      }
      stroke = { op, pts: [pts[0]!, pts[pts.length - 1]!], radius: r / 2, strength: k };
    } else if (op === 'smooth') stroke = { op, pts, radius: r, strength: Math.min(1, Math.max(0.05, k / 100)), falloff: this.terrFalloff() };
    else if (op === 'flatten') stroke = { op, pts, radius: r, strength: 1, height: Math.round(h0 * 10) / 10, falloff: this.terrFalloff() };
    else stroke = { op, pts, radius: r, strength: Math.abs(k), falloff: this.terrFalloff() };
    this.ed.commitSite((s) => {
      s.terrain ??= defaultTerrain(s.extent);
      s.terrain.strokes.push(stroke);
    });
    this.applyNow();
  }
  protected readonly loadingGround = signal(false);
  protected async realGround(): Promise<void> {
    this.loadingGround.set(true);
    try {
      await this.site.loadRealGround();
    } finally {
      this.loadingGround.set(false);
    }
  }
  /** Back to flat ground (one undo step). */
  protected clearTerrain(): void {
    if (!this.ed.draft().terrain?.strokes.length) return;
    this.ed.commitSite((s) => {
      if (s.terrain) s.terrain.strokes = [];
    });
    this.applyNow();
    this.toast.show('Terrain strokes removed. Undo brings them back.');
  }
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
  /** Finished measures, the open end of the one being drawn (`a`) and where the chain began (`start`, to close a loop). */
  protected readonly meas = signal<{ segs: Seg[]; a: Pt | null; start: Pt | null }>({ segs: [], a: null, start: null });
  protected readonly measSel = signal<number | null>(null);
  protected readonly measSelSeg = computed(() => (this.tool() === 'measure' && !this.meas().a ? (this.meas().segs[this.measSel() ?? -1] ?? null) : null));
  /** Measure lines only take the pointer while no chain is open (then a click always adds a point). */
  protected readonly measHit = computed(() => (this.tool() === 'measure' && !this.meas().a ? 'stroke' : 'none'));
  /** What the pointer is magnetised to while measuring ('corner', 'tree' ...), or ''. */
  protected readonly measSnap = signal('');
  /** The angle arcs: radius 34 px, but never more than a third of the shorter arm. */
  protected readonly measArcs = computed(() => {
    const segs = this.meas().segs, r0 = 34 / Math.max(0.01, this.ppm());
    return anglesAt(segs).map((a) => {
      const arm = Math.min(Math.hypot(segs[a.i]!.b.x - segs[a.i]!.a.x, segs[a.i]!.b.z - segs[a.i]!.a.z), Math.hypot(segs[a.j]!.b.x - segs[a.j]!.a.x, segs[a.j]!.b.z - segs[a.j]!.a.z));
      return { ...arcOf(a.at, a.d1, a.d2, Math.min(r0, arm / 3)), deg: a.deg };
    });
  });
  /** A measure's label: its plan length, and on a terrain the height difference and the length along the ground. */
  protected fmt = (m: Seg): string => {
    const flat = lengthOf(m);
    const g = this.ground();
    if (!g.grid) return fmtLength(flat);
    const p = groundProfile(m, g.at);
    if (Math.abs(p.dh) < 0.05 && p.along - flat < 0.05) return fmtLength(flat);
    return `${fmtLength(flat)} · ${p.dh >= 0 ? '↑' : '↓'}${Math.abs(p.dh).toFixed(1)} m · ${fmtLength(p.along)} on the ground`;
  };
  /** Where a measure click or hover lands: magnet to elements within ~10 px, else straightened against the building axes. */
  private measPoint(raw: Pt): Pt {
    const m = this.meas();
    const snap = nearestSnap(snapTargets(this.ed.draft(), m.segs), raw, 10 / Math.max(0.01, this.ppm()));
    if (snap) {
      this.measSnap.set(snap.kind);
      return snap.pt;
    }
    this.measSnap.set('');
    return m.a ? orthoSnap(m.a, raw, this.b()?.rotDeg ?? 0, 2.5) : raw;
  }
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
  protected readonly captures = computed(() => this.tool() !== 'select' || this.pinMode() !== null || this.indoor() || this.shiftHeld() || !!this.armed());
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
    const arm = this.armed();
    if (arm) return `Click the map to place “${arm.block.name}” (again for another one). Esc stops.`;
    if (t === 'structure') return this.structKind() === 'bridge' ? 'Drag from one end of the bridge to the other. Select it to change height, width, style.' : 'Click to place it. Select it to change height and size; drag to move.';
    if (t === 'building') return this.buildKind() === 'greenhouse' ? 'Drag a rectangle: the long side is the tunnel, the short side the arch span.' : 'Drag a rectangle to add a building (it cannot overlap another).';
    if (t === 'merge') return this.b() ? `Click a touching building to merge it into “${this.b()!.name}”.` : 'Click the building to keep, then the one to merge into it.';
    if (t === 'fence') return 'Drag to draw a free-standing wall or fence. Select it to edit height or drag its ends.';
    if (t === 'void') return 'Drag a hole in the selected floor (on the ground floor tick “water” for a basin).';
    if (t === 'column') return 'Click inside the building to place a column on this floor; drag to move.';
    if (t === 'cut' || t === 'wing') return this.b() ? `Drag a rectangle over the selected building to ${t === 'cut' ? 'cut it out' : 'add it as a wing'}.` : 'Select a building first.';
    if (t === 'tree') return 'Click to plant trees; switch to ↖ to move or delete them.';
    if (t === 'tunnel') return (this.underKind() === 'tunnel' ? 'Drag from one end of the tunnel to the other.' : 'Drag a rectangle: a room under the ground (a bunker, a basement).') + ' It opens where the ground is between its floor and ceiling: lower the ground at its ends with Terrain to make the mouths.';
    if (t === 'road') return 'Drag along the way. Select a road to change its kind, width or surface.';
    if (t === 'surface' || t === 'water') return `Draw the outline by hand. Select it (click its edge) to change it or delete it.`;
    if (t === 'terrain') return { raise: 'Drag to raise the ground along the stroke.', lower: 'Drag to dig along the stroke.', smooth: 'Drag to soften bumps and steps.', flatten: 'Drag from a point: the ground around the stroke goes to that point\'s height.', hill: 'Click to put a hill there.', crater: 'Click to dig a crater (with a little rim).', ramp: 'Drag from the foot of the ramp to its top.' }[this.terrainOp()] + ' One stroke = one undo step.';
    if (t === 'scatter') return { pen: 'Drag along a path: trees are planted randomly in a strip around it.', rect: 'Drag a square: it is filled with random trees.', circle: 'Drag from the centre: a circle is filled with random trees.', lasso: 'Draw a loop freehand: it is filled with random trees.' }[this.scatterMode()];
    if (t === 'door' || t === 'window') return this.b() ? `Click a wall of “${this.b()!.name}” to add a ${t}.` : 'Select a building first.';
    if (t === 'wall') return this.b() ? 'Drag inside the building to draw an interior wall.' : 'Select a building first.';
    if (t === 'measure') return 'Click points: each one continues the chain (B of one is A of the next); click the same point twice, Esc or right-click to stop. Click a line to select it, drag to move it, Delete removes it.';
    if (this.indoor()) return `Floor ${this.levelName(this.level())}: roof off in 3D. Doors, windows, walls, voids and columns are edited here, per floor. Delete removes the selection.`;
    return 'Drag a building to move it, corners / edge squares to resize or reshape, the yellow knob to rotate. Drag the map to pan.';
  });

  constructor() {
    afterNextRender(() => this.init());
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
      this.palXY();
      const pal = this.palEl()?.nativeElement;
      const btn = pal?.querySelector<HTMLElement>('.pbtn.on');
      if (!pal) return;
      const next = { top: btn ? btn.getBoundingClientRect().top - pal.getBoundingClientRect().top : 0, palW: pal.offsetWidth };
      const cur = untracked(() => this.toolBtn());
      if (Math.abs(cur.top - next.top) > 0.5 || Math.abs(cur.palW - next.palW) > 0.5) this.toolBtn.set(next);
    });
    effect(() => {
      if (uiResets() === 0) return;
      untracked(() => {
        this.palPos.set(null);
        this.optsPos.set(null);
      });
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
    const v = prompt('Your Overpass / proxy URL (leave empty to use the public servers):', GeoService.endpoint);
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
      this.meas.update((m) => ({ ...m, a: null, start: null }));
      this.measSel.set(null);
    }
    this.measHover.set(null);
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
    const armed = this.armed();
    if (armed && !this.pinMode()) {
      this.placeArmed(armed, p);
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
    } else if (t === 'measure') {
      // click, click, click: every new point continues the chain (B of one is A of the next); the same point twice, a loop closed on its start, Esc or a right click end it
      const m = this.meas();
      const q = this.measPoint(p);
      if (!m.a) {
        this.measSel.set(null);
        this.meas.set({ segs: m.segs, a: q, start: q });
      } else if (Math.hypot(q.x - m.a.x, q.z - m.a.z) <= 0.05) {
        this.meas.set({ ...m, a: null, start: null });
        this.measHover.set(null);
      } else {
        const segs = [...m.segs, { a: m.a, b: q }];
        const closed = !!m.start && segs.length > 1 && Math.hypot(q.x - m.start.x, q.z - m.start.z) <= 0.05;
        this.meas.set({ segs, a: closed ? null : q, start: closed ? null : m.start });
        if (closed) this.measHover.set(null);
      }
    } else if ((t === 'cut' || t === 'wing') && bd) {
      const l = this.toLocal(bd, p);
      const a = { x: snap(l.x, 0.5), z: snap(l.z, 0.5) };
      this.drag.set({ t: 'shape', op: t === 'cut' ? 'cut' : 'add', a, b: { ...a } });
    } else if (t === 'wall' && bd) this.startWall(bd, p);
    else if ((t === 'door' || t === 'window') && bd) this.addOpeningAt(bd, p, t);
  }

  /** A press on a measure: near an end it starts a new measure from there (to read the angle); on the line it selects it and drags it along. */
  protected measureLineDown(e: PointerEvent, i: number): void {
    e.stopPropagation();
    const m = this.meas().segs[i];
    if (!m) return;
    const p = this.toWorld(e);
    const r = 10 / Math.max(0.01, this.ppm());
    if (Math.hypot(p.x - m.a.x, p.z - m.a.z) < r || Math.hypot(p.x - m.b.x, p.z - m.b.z) < r) {
      this.measSel.set(null);
      return this.bgDown(e);
    }
    this.capture(e);
    this.measSel.set(i);
    this.drag.set({ t: 'measMove', i, last: p });
  }

  /** The white knob of the selected measure: drag one end (other measures ending on the same point follow). */
  protected measEndDown(e: PointerEvent, end: 0 | 1): void {
    e.stopPropagation();
    const i = this.measSel();
    const m = i === null ? undefined : this.meas().segs[i];
    if (i === null || !m) return;
    this.capture(e);
    this.drag.set({ t: 'measEnd', i, end, old: end ? m.b : m.a });
  }

  /** Move every measure end that sits on one of `pts` by (dx, dz): measures chained through a point stay joined. */
  private shiftMeas(pts: Pt[], dx: number, dz: number): void {
    const hit = (q: Pt): boolean => pts.some((o) => Math.hypot(o.x - q.x, o.z - q.z) < 0.05);
    const mv = (q: Pt): Pt => (hit(q) ? { x: q.x + dx, z: q.z + dz } : q);
    this.meas.update((m) => ({ ...m, segs: m.segs.map((g) => ({ a: mv(g.a), b: mv(g.b) })) }));
  }

  protected deleteMeasure(): void {
    const i = this.measSel();
    if (i === null) return;
    this.meas.update((m) => ({ segs: m.segs.filter((_, k) => k !== i), a: null, start: null }));
    this.measSel.set(null);
  }

  protected clearMeasures(): void {
    this.meas.set({ segs: [], a: null, start: null });
    this.measSel.set(null);
    this.measHover.set(null);
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
    this.measHover.set(null);
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
    if (!confirm(`Convert to a ${to}? Its interior walls, doors, windows, columns, voids and outline are lost (you can still Undo).`)) return;
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
      if (this.placing() || this.tool() === 'terrain' || this.armed()) this.hover.set(this.toWorld(e)); // the ghost (and its guides) follow the pointer
      // measuring: after the first point, a live line follows the pointer
      if (this.tool() === 'measure') this.measHover.set(this.measPoint(this.toWorld(e)));
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
      case 'measMove': {
        const g = this.meas().segs[d.i];
        if (g) this.shiftMeas([g.a, g.b], p.x - d.last.x, p.z - d.last.z);
        this.drag.set({ ...d, last: p });
        break;
      }
      case 'measEnd': {
        const others = this.meas().segs.filter((g) => Math.hypot(g.a.x - d.old.x, g.a.z - d.old.z) > 0.05 && Math.hypot(g.b.x - d.old.x, g.b.z - d.old.z) > 0.05);
        const sn = nearestSnap(snapTargets(this.ed.draft(), others), p, 10 / Math.max(0.01, this.ppm()));
        const q = sn ? sn.pt : p;
        this.measSnap.set(sn?.kind ?? '');
        this.measHover.set(sn ? q : null);
        this.shiftMeas([d.old], q.x - d.old.x, q.z - d.old.z);
        this.drag.set({ ...d, old: q });
        break;
      }
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
        const op = this.terrainOp();
        this.hover.set(p);
        if (op === 'hill' || op === 'crater') break;
        const last = d.pts[d.pts.length - 1]!;
        if (op === 'ramp') this.drag.set({ ...d, pts: [d.pts[0]!, p] });
        else if (Math.hypot(p.x - last.x, p.z - last.z) >= Math.max(0.5, this.terrRadius() / 4)) this.drag.set({ ...d, pts: [...d.pts, p] });
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
      this.commitLayer(d.pts);
    } else if (d.t === 'under') {
      this.commitUnder(d.a, d.b);
    } else if (d.t === 'terrain') {
      this.commitTerrain(d.pts, d.h0);
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
    if (this.tool() === 'measure' && this.meas().a) {
      // a right click while measuring just ends the chain
      this.meas.update((m) => ({ ...m, a: null, start: null }));
      this.measHover.set(null);
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
          sep,
          del,
        ];
      }
      case 'tree':
        if (!this.treeIdxs().includes(n)) this.treeSet.set([]);
        this.pick.set({ t: 'tree', i: n });
        return [head(this.treeIdxs().length > 1 ? `${this.treeIdxs().length} trees` : 'Tree'), del];
      case 'structure':
        this.pick.set({ t: 'structure', i: n });
        return [head('Structure'), { label: 'Duplicate', act: () => this.duplicateStruct() }, sep, del];
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
        this.measSel.set(n);
        return [head('Measure'), { label: 'Delete this measure', danger: true, act: () => this.deleteMeasure() }, { label: 'Clear all measures', act: () => this.clearMeasures() }];
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
          { label: 'Measure from here', act: () => { this.setTool('measure'); this.meas.update((m) => ({ ...m, a: p, start: p })); } },
          sep,
          tool('Select tool', 'select'),
        ];
      }
    }
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
      this.deleteMeasure();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.deleteSel();
    } else if (e.key === 'Escape' && this.armed()) {
      this.armed.set(null);
    } else if (e.key === 'Escape') {
      this.tool.set('select');
      this.scene.pin.set(null);
      this.drag.set(null);
      this.zoneSel.set(null);
      this.meas.update((m) => ({ ...m, a: null, start: null }));
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
