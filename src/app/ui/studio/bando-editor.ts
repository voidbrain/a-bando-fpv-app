import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { contains, edgesOf, type Pt, type Rect } from '../../core/footprint';
import { buildingsOverlap, mergeBuildings, overlapsOthers } from '../../core/building-ops';
import { addOpening, insideBuilding, listOpenings, moveOpening, outlineOf, patchOpening, removeOpening, reshapeBuilding, resetToRect, resizeOpening, type OpenSeg } from '../../core/openings';
import { cloneSpec, uid, type BuildingSpec, type LevelSpec, type LocationInfo, type SiteSpec, type StructureKind, type StructureSpec } from '../../core/site-spec';
import { STRUCTURE_DEFAULTS } from '../../three/structures';
import { AiService } from '../../services/ai.service';
import { FlightService } from '../../services/flight.service';
import { GeoService } from '../../services/geo.service';
import { SceneService } from '../../services/scene.service';
import { MAX_HALF_EXTENT, SiteService } from '../../services/site.service';
import { StudioService } from '../../services/studio.service';
import { ToastService } from '../../services/toast.service';
import { ViewStore } from '../../state/view.store';
import { checkedFrom, numberFrom, selectedFrom, textFrom } from '../dom';
import { FloatBox } from '../float-box';
import { AssistantBox } from './assistant-box';
import { ElementPreview } from './element-preview';
import type { PreviewTarget } from '../../three/element-preview';

type Tool = 'select' | 'building' | 'structure' | 'merge' | 'cut' | 'wing' | 'tree' | 'fence' | 'door' | 'window' | 'wall' | 'void' | 'column' | 'measure';
type Pick = { t: 'building' } | { t: 'tree'; i: number } | { t: 'opening'; id: string } | { t: 'wall'; i: number } | { t: 'fence'; i: number } | { t: 'void'; i: number } | { t: 'column'; i: number } | { t: 'structure'; i: number } | null;
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
  | { t: 'fenceEnd'; i: number; end: 0 | 1 }
  | { t: 'voidDraw'; a: Pt; b: Pt }
  | { t: 'column'; i: number; dx: number; dz: number }
  | { t: 'frame'; h: Handle };

const MIN_HALF = 20;
const M_LAT = 111132;
const snap = (v: number, step: number): number => Math.round(v / step) * step;
const clampHalf = (v: number): number => Math.min(MAX_HALF_EXTENT, Math.max(MIN_HALF, v));
const STREET = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const SAT = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

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
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, FloatBox, AssistantBox, ElementPreview],
  host: { class: 'be' },
  template: `
    <div class="bar">
      <div class="seg">
        <button [class.on]="mode() === 'area'" (click)="setMode('area')">1 · Area</button>
        <button [class.on]="mode() === 'model'" [disabled]="!hasModel()" (click)="setMode('model')" [title]="hasModel() ? '' : 'Generate the model first'">2 · Model</button>
      </div>
      @if (mode() === 'model') {
        @for (t of tools; track t.id) {
          <button class="btn" [class.on]="tool() === t.id" [disabled]="!!t.indoor && !indoor()" (click)="setTool(t.id)" [title]="t.hint">{{ t.label }}</button>
        }
        @if (tool() === 'structure') {
          <select class="mini" [value]="structKind()" (change)="structKind.set(structKindOf($event))" title="What to place">
            @for (k of structKinds; track k.id) {
              <option [value]="k.id" [selected]="k.id === structKind()">{{ k.label }}</option>
            }
          </select>
        }
        @if (tool() === 'building') {
          <select class="mini" [value]="buildKind()" (change)="buildKind.set(buildKindOf($event))" title="What to draw">
            <option value="building" [selected]="buildKind() === 'building'">Building</option>
            <option value="greenhouse" [selected]="buildKind() === 'greenhouse'">Greenhouse (arched steel frame)</option>
          </select>
        }
        <button class="btn" [class.on]="indoor()" [disabled]="!b() || !!b()!.frame" (click)="toggleIndoor()" title="Take the roof off and edit walls, doors and windows inside the selected building">{{ indoor() ? '✓ Indoors' : 'Edit indoors' }}</button>
        @if (indoor() && b(); as ib) {
          @for (l of ib.levels; track $index) {
            <button class="btn" [class.on]="$index === level()" (click)="level.set($index)" title="Edit this floor">L{{ $index + 1 }}</button>
          }
          <button class="btn" (click)="addLevel()" title="Add a floor on top (a copy of the last one; the roof moves up)">＋ floor</button>
          <button class="btn" [disabled]="ib.levels.length < 2" (click)="removeFloor()" title="Remove the selected floor">－ floor</button>
        }
        <button class="btn" [class.on]="pinMode() === 's'" [disabled]="!hasPath()" (click)="armPin('s')" title="Needs a loaded flight path: click where the flight started">Pin start</button>
        <button class="btn" [class.on]="pinMode() === 'e'" [disabled]="!hasPath()" (click)="armPin('e')" title="Needs a loaded flight path: click where the flight ended">Pin end</button>
        <button class="btn" [disabled]="!ed.canUndo()" (click)="undo()" title="Undo (Ctrl+Z)">↶</button>
        <button class="btn" [disabled]="!ed.canRedo()" (click)="redo()" title="Redo">↷</button>
        <button class="btn" [class.on]="ai.open()" (click)="ai.open.set(!ai.open())" title="Chat with the in-browser AI assistant to edit buildings and interiors">💬 AI</button>
        <button class="btn primary" (click)="save()">Save</button>
      }
      <span class="sp"></span>
      <label class="lay" title="Map under the model">map
        <select [value]="studio.basemap()" (change)="setBase($event)">
          <option value="street">Street</option>
          <option value="sat">Satellite</option>
          <option value="off">Hidden</option>
        </select>
      </label>
      <label class="lay" title="Map opacity"><input type="range" min="0.2" max="1" step="0.05" [value]="studio.mapOpacity()" (input)="setOpacity($event)" /></label>
    </div>

    <div class="wrap" #wrap tabindex="0" (keydown)="key($event)">
      <div class="map" #el></div>

      @if (overlayOn()) {
        <svg
          #svg
          class="ov"
          [class.cap]="captures()"
          [attr.viewBox]="vb()"
          preserveAspectRatio="none"
          (pointerdown)="bgDown($event)"
          (pointermove)="move($event)"
          (pointerup)="up($event)"
          (pointercancel)="up($event)"
          (wheel)="wheel($event)"
        >
          @for (p of ed.draft().pads; track $index) {
            <rect [attr.x]="p.x - p.w / 2" [attr.y]="p.z - p.d / 2" [attr.width]="p.w" [attr.height]="p.d" [attr.transform]="'rotate(' + (p.rotDeg ?? 0) + ' ' + p.x + ' ' + p.z + ')'" [attr.fill]="p.color ?? '#888'" opacity="0.55" />
          }
          @if (zoneRect(); as zr) {
            <rect [attr.x]="zr.x" [attr.y]="zr.z" [attr.width]="zr.w" [attr.height]="zr.d" fill="none" stroke="#ffd166" stroke-width="2" stroke-dasharray="8 5" vector-effect="non-scaling-stroke" />
          }
          @for (st of ed.draft().structures ?? []; track st.id) {
            <g class="hit" [attr.transform]="'translate(' + st.x + ' ' + st.z + ') rotate(' + st.rotDeg + ')'" (pointerdown)="structDown($event, $index)">
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
                @default {
                  <circle [attr.r]="st.size" [attr.fill]="st.kind === 'chimney' ? '#a86b52' : '#c4c8c6'" fill-opacity="0.85" [attr.stroke]="structI() === $index ? '#ffd166' : '#3a3a36'" [attr.stroke-width]="structI() === $index ? 3 : 1.5" vector-effect="non-scaling-stroke" />
                  <circle [attr.r]="st.size * (st.kind === 'chimney' ? 0.55 : 0.55)" fill="none" stroke="#3a3a36" vector-effect="non-scaling-stroke" pointer-events="none" />
                }
              }
            </g>
            <text [attr.x]="st.x" [attr.y]="st.z + (st.kind === 'bridge' ? 0 : st.size + 4)" text-anchor="middle" [attr.font-size]="Math.max(2, 11 / ppm())" fill="#1b231e" stroke="#fff" stroke-width="0.35" paint-order="stroke" pointer-events="none">{{ st.name }}</text>
            @if (structI() === $index && (st.kind === 'bridge' || st.kind === 'lattice_tower')) {
              <g [attr.transform]="'translate(' + st.x + ' ' + st.z + ') rotate(' + st.rotDeg + ')'">
                <line x1="0" [attr.y1]="-(st.kind === 'bridge' ? st.size / 2 : st.size)" x2="0" [attr.y2]="-(st.kind === 'bridge' ? st.size / 2 : st.size) - 28 / ppm()" stroke="#b7ed83" vector-effect="non-scaling-stroke" pointer-events="none" />
                <circle class="hit" cx="0" [attr.cy]="-(st.kind === 'bridge' ? st.size / 2 : st.size) - 28 / ppm()" [attr.r]="hr()" fill="#ffd166" stroke="#12200b" vector-effect="non-scaling-stroke" (pointerdown)="structRotDown($event, $index)" />
              </g>
            }
          }
          @for (w of ed.draft().walls ?? []; track $index) {
            <line class="hit" [attr.x1]="w.a.x" [attr.y1]="w.a.z" [attr.x2]="w.b.x" [attr.y2]="w.b.z" [attr.stroke]="fenceI() === $index ? '#ffd166' : (w.color ?? '#d9c9a0')" stroke-width="6" stroke-linecap="round" vector-effect="non-scaling-stroke" (pointerdown)="fenceDown($event, $index)" />
            @if (fenceI() === $index) {
              <circle class="hit" [attr.cx]="w.a.x" [attr.cy]="w.a.z" [attr.r]="hr()" fill="#fff" stroke="#12200b" vector-effect="non-scaling-stroke" (pointerdown)="fenceEndDown($event, $index, 0)" />
              <circle class="hit" [attr.cx]="w.b.x" [attr.cy]="w.b.z" [attr.r]="hr()" fill="#fff" stroke="#12200b" vector-effect="non-scaling-stroke" (pointerdown)="fenceEndDown($event, $index, 1)" />
            }
          }
          @for (t of ed.draft().trees; track $index) {
            <circle class="hit" [attr.cx]="t.x" [attr.cy]="t.z" [attr.r]="t.r" [attr.fill]="t.kind === 'c' ? '#2f6b3c' : '#4f9a4a'" fill-opacity="0.85" [attr.stroke]="treeI() === $index ? '#ffd166' : '#1d3d22'" stroke-width="1.5" vector-effect="non-scaling-stroke" (pointerdown)="treeDown($event, $index)" />
          }
          @for (bd of ed.draft().buildings; track bd.id) {
            <g [attr.transform]="tf(bd)" [attr.opacity]="indoor() && bd.id !== ed.selectedId() ? 0.35 : 1">
              @if (bd.frame) {
                @for (x of ribs(bd); track x) {
                  <line [attr.x1]="x" [attr.y1]="-bd.width / 2" [attr.x2]="x" [attr.y2]="bd.width / 2" stroke="#56655f" vector-effect="non-scaling-stroke" pointer-events="none" />
                }
              }
              <polygon class="hit" [attr.points]="outline(bd)" [attr.fill]="bd.color ?? '#d7d0bd'" [attr.fill-opacity]="indoor() && bd.id === ed.selectedId() ? 0.2 : 0.8" [attr.stroke]="bd.id === ed.selectedId() ? '#b7ed83' : '#2d3a33'" [attr.stroke-width]="bd.id === ed.selectedId() ? 3 : 1.5" vector-effect="non-scaling-stroke" (pointerdown)="bldDown($event, bd)" />
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
                  <line class="hit" [attr.x1]="pt[0].x - bd.length / 2" [attr.y1]="pt[0].z - bd.width / 2" [attr.x2]="pt[1].x - bd.length / 2" [attr.y2]="pt[1].z - bd.width / 2" [attr.stroke]="wallI() === $index ? '#ffd166' : '#f1f4f2'" stroke-width="5" stroke-linecap="round" vector-effect="non-scaling-stroke" (pointerdown)="wallDown($event, $index)" />
                }
                @if (drag()?.t === 'wallDraw') {
                  <line [attr.x1]="wd().a.x - bd.length / 2" [attr.y1]="wd().a.z - bd.width / 2" [attr.x2]="wd().b.x - bd.length / 2" [attr.y2]="wd().b.z - bd.width / 2" stroke="#ffd166" stroke-width="4" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" pointer-events="none" />
                }
              }
              @if (indoor()) {
                @for (v of lvl()?.voids ?? []; track $index) {
                  <rect class="hit" [attr.x]="v.x0 - bd.length / 2" [attr.y]="v.z0 - bd.width / 2" [attr.width]="v.x1 - v.x0" [attr.height]="v.z1 - v.z0" [attr.fill]="v.water ? '#3d86b6' : '#0b0e0c'" fill-opacity="0.65" [attr.stroke]="voidI() === $index ? '#ffd166' : '#8fb7d1'" stroke-width="2" stroke-dasharray="5 3" vector-effect="non-scaling-stroke" (pointerdown)="voidDown($event, $index)" />
                }
                @for (c of lvl()?.columns ?? []; track $index) {
                  @if (c.round) {
                    <circle class="hit" [attr.cx]="c.x - bd.length / 2" [attr.cy]="c.z - bd.width / 2" [attr.r]="c.size / 2" fill="#c9c5b8" [attr.stroke]="colI() === $index ? '#ffd166' : '#222'" stroke-width="2" vector-effect="non-scaling-stroke" (pointerdown)="colDown($event, $index)" />
                  } @else {
                    <rect class="hit" [attr.x]="c.x - bd.length / 2 - c.size / 2" [attr.y]="c.z - bd.width / 2 - c.size / 2" [attr.width]="c.size" [attr.height]="c.size" fill="#c9c5b8" [attr.stroke]="colI() === $index ? '#ffd166' : '#222'" stroke-width="2" vector-effect="non-scaling-stroke" (pointerdown)="colDown($event, $index)" />
                  }
                }
                @if (drag()?.t === 'voidDraw') {
                  <rect [attr.x]="vd().x - bd.length / 2" [attr.y]="vd().z - bd.width / 2" [attr.width]="vd().w" [attr.height]="vd().d" fill="#3d86b6" fill-opacity="0.4" stroke="#8fb7d1" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" pointer-events="none" />
                }
              }
              @for (o of openings(); track o.id) {
                <line class="hit" [attr.x1]="seg(o).x1" [attr.y1]="seg(o).y1" [attr.x2]="seg(o).x2" [attr.y2]="seg(o).y2" [attr.stroke]="o.kind === 'door' ? '#ff9a2e' : '#4fc3f7'" [attr.stroke-width]="openId() === o.id ? 10 : 7" vector-effect="non-scaling-stroke" (pointerdown)="openDown($event, o.id)" />
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
                <line [attr.x1]="0" [attr.y1]="-bd.width / 2" [attr.x2]="0" [attr.y2]="-bd.width / 2 - 28 / ppm()" stroke="#b7ed83" vector-effect="non-scaling-stroke" pointer-events="none" />
                <circle class="hit" [attr.cx]="0" [attr.cy]="-bd.width / 2 - 28 / ppm()" [attr.r]="hr()" fill="#ffd166" stroke="#12200b" vector-effect="non-scaling-stroke" (pointerdown)="rotDown($event)" />
              }
              @if (drag()?.t === 'shape') {
                <rect [attr.x]="sh().x" [attr.y]="sh().z" [attr.width]="sh().w" [attr.height]="sh().d" [attr.fill]="sh().op === 'cut' ? '#ff6b6b' : '#b7ed83'" fill-opacity="0.35" [attr.stroke]="sh().op === 'cut' ? '#ff6b6b' : '#b7ed83'" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" pointer-events="none" />
              }
            </g>
          }
          @if (drag()?.t === 'bridgeDraw') {
            <line [attr.x1]="bdw().a.x" [attr.y1]="bdw().a.z" [attr.x2]="bdw().b.x" [attr.y2]="bdw().b.z" stroke="#ffd166" [attr.stroke-width]="7" stroke-dasharray="8 5" vector-effect="non-scaling-stroke" pointer-events="none" />
          }
          @if (drag()?.t === 'fenceDraw') {
            <line [attr.x1]="fd().a.x" [attr.y1]="fd().a.z" [attr.x2]="fd().b.x" [attr.y2]="fd().b.z" stroke="#ffd166" stroke-width="5" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" pointer-events="none" />
          }
          @if (drag()?.t === 'draw') {
            <rect [attr.x]="dr().x" [attr.y]="dr().z" [attr.width]="dr().w" [attr.height]="dr().d" fill="#b7ed83" fill-opacity="0.25" stroke="#b7ed83" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" pointer-events="none" />
          }
          @if (meas().a; as a) {
            @if (meas().b; as mb) {
              <line class="hit" [attr.x1]="a.x" [attr.y1]="a.z" [attr.x2]="mb.x" [attr.y2]="mb.z" stroke="#ffd166" stroke-width="2" stroke-dasharray="8 5" vector-effect="non-scaling-stroke" (pointerdown)="measureLineDown($event)" />
              <line [attr.x1]="a.x" [attr.y1]="a.z" [attr.x2]="mb.x" [attr.y2]="mb.z" stroke="transparent" stroke-width="14" vector-effect="non-scaling-stroke" class="hit" (pointerdown)="measureLineDown($event)" />
              <text [attr.x]="(a.x + mb.x) / 2" [attr.y]="(a.z + mb.z) / 2" text-anchor="middle" [attr.font-size]="13 / ppm()" fill="#ffe9ad" stroke="#222" stroke-width="0.4" paint-order="stroke" pointer-events="none">{{ measureLabel() }}</text>
            }
            <circle [attr.cx]="a.x" [attr.cy]="a.z" [attr.r]="4 / ppm()" fill="#ffd166" pointer-events="none" />
            @if (meas().b; as mb) {
              <circle [attr.cx]="mb.x" [attr.cy]="mb.z" [attr.r]="4 / ppm()" fill="#ffd166" pointer-events="none" />
            }
          }
          <circle [attr.cx]="ed.draft().droneStart.x" [attr.cy]="ed.draft().droneStart.z" [attr.r]="2" fill="#ff6b6b" pointer-events="none" />
        </svg>
      }

      @if (mode() === 'area') {
        <div class="frame" [style.left.px]="fb().l" [style.top.px]="fb().t" [style.width.px]="fb().w" [style.height.px]="fb().h">
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
        <div class="read" [class.warn]="atMax()">{{ round(half().e * 2) }} × {{ round(half().n * 2) }} m{{ atMax() ? ' (maximum)' : '' }}</div>
      } @else if (!overlayOn()) {
        <div class="notice">This bando was built with the old rotated layout and can't be drawn over the map. Go to <b>1 · Area</b> and press <b>Regenerate</b> to rebuild it aligned to the map.</div>
      }

      @if (mode() === 'model' && overlayOn() && ai.open()) {
        <app-assistant-box />
      }

      @if (mode() === 'model' && overlayOn()) {
        <app-float-box fid="inspector-v2" title="Inspector" [x]="8" [y]="40" [w]="300" [h]="430">
          @if (previewTarget(); as pt) {
            <app-element-preview [target]="pt" [key]="previewKey()" [caption]="previewCaption()" />
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
                <div class="f"><button class="btn danger" (click)="deleteSel()">Delete</button></div>
              }
            }
            @case ('tree') {
              @if (tree(); as t) {
                <div class="f"><label>height <input type="number" min="1" step="0.5" [value]="t.h" (change)="setTree({ h: num($event) })" /></label>
                <label>radius <input type="number" min="0.5" step="0.25" [value]="t.r" (change)="setTree({ r: num($event) })" /></label></div>
                <div class="f"><label>kind <select (change)="setTree({ kind: treeKind($event) })"><option value="d" [selected]="t.kind === 'd'">broadleaf</option><option value="c" [selected]="t.kind === 'c'">conifer</option></select></label>
                <button class="btn danger" (click)="deleteSel()">Delete</button></div>
              }
            }
            @case ('structure') {
              @if (structSel(); as st) {
                <div class="f"><label class="grow">name <input type="text" class="grow" [value]="st.name" (change)="setStruct({ name: text($event) })" /></label></div>
                <div class="f"><span class="dim">{{ structLabel(st.kind) }}</span></div>
                <div class="f"><label>{{ st.kind === 'bridge' ? 'deck height' : 'height' }} <input type="number" min="2" step="0.5" [value]="st.height" (change)="setStruct({ height: num($event) })" /></label>
                <label>{{ sizeLabel(st.kind) }} <input type="number" min="0.5" step="0.5" [value]="st.size" (change)="setStruct({ size: num($event) })" /></label></div>
                @if (st.kind === 'bridge') {
                  <div class="f"><label>length <input type="number" min="6" step="1" [value]="(st.length ?? 30).toFixed(0)" (change)="setStruct({ length: num($event) })" /></label>
                  <label>style <select (change)="setStruct({ style: styleOf($event) })"><option value="beam" [selected]="(st.style ?? 'beam') === 'beam'">beam on piers</option><option value="arch" [selected]="st.style === 'arch'">arch</option></select></label></div>
                }
                @if (st.kind === 'bridge' || st.kind === 'lattice_tower') {
                  <div class="f"><label>rotation° <input type="number" step="5" [value]="st.rotDeg.toFixed(0)" (change)="setStruct({ rotDeg: num($event) })" /></label></div>
                }
                <div class="f"><button class="btn danger" (click)="deleteSel()">Delete</button></div>
              }
            }
            @case ('fence') {
              @if (fence(); as w) {
                <div class="f"><span class="dim">Free-standing wall · {{ fenceLen(w).toFixed(1) }} m</span></div>
                <div class="f"><label>height <input type="number" min="0.3" step="0.1" [value]="w.height" (change)="setFence({ height: num($event) })" /></label>
                <label>thickness <input type="number" min="0.1" step="0.05" [value]="w.thick" (change)="setFence({ thick: num($event) })" /></label></div>
                <div class="f"><button class="btn danger" (click)="deleteSel()">Delete</button></div>
              }
            }
            @case ('void') {
              @if (voidSel(); as v) {
                <div class="f"><span class="dim">Void · {{ (v.x1 - v.x0).toFixed(1) }} × {{ (v.z1 - v.z0).toFixed(1) }} m · floor {{ level() + 1 }}</span></div>
                @if (level() === 0) {
                  <div class="f"><label><input type="checkbox" [checked]="!!v.water" (change)="setVoid({ water: checked($event) })" /> water (basin)</label></div>
                }
                <div class="f"><button class="btn danger" (click)="deleteSel()">Delete</button></div>
              }
            }
            @case ('column') {
              @if (colSel(); as c) {
                <div class="f"><label>size <input type="number" min="0.15" step="0.05" [value]="c.size" (change)="setColumn({ size: num($event) })" /></label>
                <label><input type="checkbox" [checked]="!!c.round" (change)="setColumn({ round: checked($event) })" /> round</label></div>
                <div class="f"><button class="btn danger" (click)="deleteSel()">Delete</button></div>
              }
            }
            @case ('wall') {
              <div class="f"><span class="dim">Interior wall</span> <button class="btn danger" (click)="deleteSel()">Delete wall</button></div>
            }
            @default {
              @if (b(); as bd) {
                <div class="f"><label class="grow">name <input type="text" class="grow" [value]="bd.name" (change)="mutate(setName, text($event))" /></label></div>
                @if (!bd.footprint) {
                  <div class="f"><label>length <input type="number" min="2" step="0.5" [value]="bd.length.toFixed(1)" (change)="mutate(setLength, num($event))" /></label>
                  <label>width <input type="number" min="2" step="0.5" [value]="bd.width.toFixed(1)" (change)="mutate(setWidth, num($event))" /></label></div>
                } @else {
                  <div class="f dim">Shaped building · {{ bd.length.toFixed(1) }} × {{ bd.width.toFixed(1) }} m · {{ bd.footprint.length }} corners
                  <button class="btn" (click)="mutate(toRectangle, 0)" title="Back to a plain rectangle over the bounding box">Reset shape</button></div>
                }
                <div class="f"><label>rotation° <input type="number" step="5" [value]="bd.rotDeg.toFixed(0)" (change)="mutate(setRot, num($event))" /></label></div>
                @if (bd.frame) {
                  <div class="f"><span class="dim">Greenhouse · arched steel frame</span></div>
                  <div class="f"><label>arch height <input type="number" min="0.3" max="1.3" step="0.05" [value]="bd.levels[0]?.vaultK ?? 0.7" (change)="editLevel(setArch, num($event))" /></label></div>
                }
                @if (!bd.frame) {
                  <div class="f levels">
                    @for (l of bd.levels; track $index) {
                      <button class="btn" [class.on]="$index === level()" (click)="level.set($index)">L{{ $index + 1 }}</button>
                    }
                    <button class="btn" (click)="addLevel()" title="Add a floor on top (a copy of the last one; the roof moves up)">＋ floor</button>
                    <button class="btn" [disabled]="bd.levels.length < 2" (click)="removeFloor()">－ floor</button>
                  </div>
                  @if (lvl(); as l) {
                    <div class="f"><label>wall height <input type="number" min="1" step="0.5" [value]="l.height" (change)="editLevel(setHeight, num($event))" /></label></div>
                  }
                  @if (topLevel(); as tl) {
                    <div class="f"><span class="dim">roof</span>
                    @if (!bd.footprint) {
                      <select (change)="editTop(setRoof, roofOf($event))"><option value="gable" [selected]="tl.roof === 'gable'">gable</option><option value="vault" [selected]="tl.roof === 'vault'">vault</option><option value="flat" [selected]="tl.roof === 'flat'">flat</option></select>
                      <label><input type="checkbox" [checked]="!!tl.roofTurn" (change)="editTop(setTurn, checked($event))" /> turn 90°</label>
                      <label>repeat × <input type="number" min="1" max="12" step="1" [value]="tl.roofCount ?? tl.vaultCount ?? 1" (change)="editTop(setCount, num($event))" /></label>
                    } @else {
                      <span class="dim">flat (shaped building)</span>
                    }
                    </div>
                  }
                }
                <div class="f"><button class="btn" (click)="duplicate()">⧉ Duplicate</button> <button class="btn danger" (click)="deleteSel()">Delete</button></div>
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
    .lay {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
    }
    .lay input[type='range'] {
      width: 70px;
    }
    .wrap {
      position: relative;
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
    .ov .hit {
      pointer-events: auto;
      cursor: pointer;
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
    }
    .f {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 10px;
      align-items: center;
    }
    .f label {
      display: inline-flex;
      gap: 4px;
      align-items: center;
    }
    .f input[type='number'] {
      width: 64px;
    }
    .levels {
      gap: 3px;
    }
  `,
})
export class BandoEditor {
  protected readonly studio = inject(StudioService);
  protected readonly ai = inject(AiService);
  protected readonly site = inject(SiteService);
  private readonly scene = inject(SceneService);
  private readonly flights = inject(FlightService);
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
  protected readonly tools: readonly { id: Tool; label: string; hint: string; indoor?: boolean }[] = [
    { id: 'select', label: '↖', hint: 'Select · move · resize · rotate' },
    { id: 'building', label: '＋ Building', hint: 'Drag a rectangle on the map (it cannot overlap another building)' },
    { id: 'structure', label: '▲ Structure', hint: 'Place a tower (chimney, silo, tank, water tower, lattice mast) or drag a bridge' },
    { id: 'merge', label: '⊎ Merge', hint: 'Select a building, press Merge, then click a touching building to join them' },
    { id: 'cut', label: '✂ Cut', hint: 'Cut a notch out of the selected building (U, H, L shapes)' },
    { id: 'wing', label: '⊕ Wing', hint: 'Add a wing to the selected building' },
    { id: 'tree', label: '＋ Tree', hint: 'Click the map to plant a tree' },
    { id: 'fence', label: '▭ Fence', hint: 'Drag to draw a free-standing wall or fence outside the buildings' },
    { id: 'door', label: '＋ Door', hint: 'Edit indoors first: click a wall of the selected floor', indoor: true },
    { id: 'window', label: '＋ Window', hint: 'Edit indoors first: click a wall of the selected floor', indoor: true },
    { id: 'wall', label: '＋ Wall', hint: 'Edit indoors first: draw an interior wall on the selected floor', indoor: true },
    { id: 'void', label: '▢ Void', hint: 'Edit indoors first: drag a hole in the selected floor (water on the ground floor)', indoor: true },
    { id: 'column', label: '● Column', hint: 'Edit indoors first: click to place a column on the selected floor', indoor: true },
    { id: 'measure', label: 'Measure', hint: 'Click point A, then point B · click the line to remove it' },
  ];

  protected readonly mode = signal<'area' | 'model'>('area');
  protected readonly tool = signal<Tool>('select');
  /** What the Structure tool places, and what the Building tool draws. */
  protected readonly structKind = signal<StructureKind>('chimney');
  protected readonly buildKind = signal<'building' | 'greenhouse'>('building');
  protected readonly structKinds: readonly { id: StructureKind; label: string }[] = [
    { id: 'chimney', label: 'Chimney' }, { id: 'silo', label: 'Silo' }, { id: 'tank', label: 'Storage tank' },
    { id: 'water_tower', label: 'Water tower' }, { id: 'lattice_tower', label: 'Lattice tower' }, { id: 'bridge', label: 'Bridge (drag)' },
  ];
  protected readonly indoor = signal(false);
  protected readonly level = signal(0);
  protected readonly pick = signal<Pick>(null);
  protected readonly drag = signal<Drag | null>(null);
  protected readonly pinMode = this.scene.pin;
  protected readonly meas = signal<{ a: Pt | null; b: Pt | null }>({ a: null, b: null });
  protected query = '';
  protected readonly hits = signal<LocationInfo[]>([]);
  protected readonly searching = signal(false);

  // map view (Leaflet) as signals: centre, zoom, pixel size
  private readonly center = signal({ lat: this.studio.start().lat, lon: this.studio.start().lon });
  private readonly zoom = signal(this.studio.start().zoom);
  private readonly size = signal({ w: 600, h: 400 });
  /** The area to build, in metres either side of the map centre: independent of the window size and the zoom. */
  protected readonly half = signal<{ e: number; n: number }>({ e: 120, n: 80 });

  private map: L.Map | null = null;
  private tiles: L.TileLayer | null = null;
  private gestureStarted = false;
  private warned = false;
  private roofBefore = false;

  protected readonly b = this.ed.building;
  protected readonly hasModel = computed(() => !this.studio.isNew() && this.ed.draft().buildings.length + this.ed.draft().trees.length > 0);
  protected readonly overlayOn = computed(() => this.mode() === 'model' && this.hasModel() && this.ed.draft().bearingDeg === 0);
  protected readonly captures = computed(() => this.tool() !== 'select' || this.pinMode() !== null);
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
    return { x: cx - z.halfE, z: cz - z.halfN, w: z.halfE * 2, d: z.halfN * 2 };
  });
  protected readonly fb = computed(() => {
    const { w, h } = this.size();
    const k = this.ppm();
    const fw = Math.min(this.half().e * 2 * k, w - 8), fh = Math.min(this.half().n * 2 * k, h - 8);
    return { l: (w - fw) / 2, t: (h - fh) / 2, w: fw, h: fh };
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
    return { kind: 'building', b: bd };
  });
  protected readonly previewKey = computed(() => {
    const p = this.pick();
    const idx = p && 'i' in p ? p.i : p && 'id' in p ? p.id : '';
    return `${this.ed.selectedId()}|${p?.t ?? 'building'}|${idx}|${this.level()}`;
  });
  protected readonly previewCaption = computed(() => {
    const t = this.previewTarget();
    if (t?.kind === 'part') return `floor ${this.level() + 1} · the rest is ghosted · drag to rotate`;
    return 'drag to rotate · wheel to zoom';
  });
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
  protected readonly measureLabel = computed(() => {
    const m = this.meas();
    if (!m.a || !m.b) return '';
    const d = Math.hypot(m.b.x - m.a.x, m.b.z - m.a.z);
    return d >= 1000 ? `${(d / 1000).toFixed(2)} km` : `${d.toFixed(1)} m`;
  });
  protected readonly hint = computed(() => {
    if (this.mode() === 'area') return 'Pan and zoom the map to place the area, drag the frame\'s edges and corners to size it, then Generate.';
    const t = this.tool();
    if (this.pinMode()) return 'Click the map where the flight ' + (this.pinMode() === 's' ? 'started' : 'ended') + '. Esc cancels.';
    if (t === 'structure') return this.structKind() === 'bridge' ? 'Drag from one end of the bridge to the other. Select it to change height, width, style.' : 'Click to place it. Select it to change height and size; drag to move.';
    if (t === 'building') return this.buildKind() === 'greenhouse' ? 'Drag a rectangle: the long side is the tunnel, the short side the arch span.' : 'Drag a rectangle to add a building (it cannot overlap another).';
    if (t === 'merge') return this.b() ? `Click a touching building to merge it into “${this.b()!.name}”.` : 'Click the building to keep, then the one to merge into it.';
    if (t === 'fence') return 'Drag to draw a free-standing wall or fence. Select it to edit height or drag its ends.';
    if (t === 'void') return 'Drag a hole in the selected floor (on the ground floor tick “water” for a basin).';
    if (t === 'column') return 'Click inside the building to place a column on this floor; drag to move.';
    if (t === 'cut' || t === 'wing') return this.b() ? `Drag a rectangle over the selected building to ${t === 'cut' ? 'cut it out' : 'add it as a wing'}.` : 'Select a building first.';
    if (t === 'tree') return 'Click to plant trees; switch to ↖ to move or delete them.';
    if (t === 'door' || t === 'window') return this.b() ? `Click a wall of “${this.b()!.name}” to add a ${t}.` : 'Select a building first.';
    if (t === 'wall') return this.b() ? 'Drag inside the building to draw an interior wall.' : 'Select a building first.';
    if (t === 'measure') return 'Click point A, then point B. Click the line to remove it.';
    if (this.indoor()) return `Floor ${this.level() + 1}: roof off in 3D. Doors, windows, walls, voids and columns are edited here, per floor. Delete removes the selection.`;
    return 'Drag a building to move it, corners / edge squares to resize or reshape, the yellow knob to rotate. Drag the map to pan.';
  });

  constructor() {
    afterNextRender(() => this.init());
    effect(() => {
      // while framing the area, the zone the Generate button uses follows the map centre and the frame size
      if (this.mode() !== 'area') return;
      const c = this.center(), h = this.half();
      this.studio.zone.set({ lat: c.lat, lon: c.lon, halfE: h.e, halfN: h.n });
    });
    effect(() => this.applyBase(this.studio.basemap(), this.studio.mapOpacity()));
    effect(() => {
      // after the assistant edited something: show it. Select the building; for interior work take the roof off.
      const f = this.ai.focus();
      if (!f) return;
      untracked(() => {
        if (this.mode() !== 'model') return;
        this.ed.select(f.id);
        this.pick.set({ t: 'building' });
        this.level.set(f.level);
        if (f.interior && !this.indoor()) this.enterIndoor();
      });
    });
  }

  // ---- map ----

  private init(): void {
    const st = this.studio.start();
    const map = L.map(this.mapEl().nativeElement, { zoomControl: true, minZoom: 15, maxZoom: 21, zoomSnap: 0.25, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false, attributionControl: true, doubleClickZoom: false }).setView([st.lat, st.lon], st.zoom);
    this.map = map;
    this.applyBase(this.studio.basemap(), this.studio.mapOpacity());
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
    this.half.set(sh ? { e: clampHalf(sh.e), n: clampHalf(sh.n) } : { e: clampHalf(this.size().w * 0.35 * mpp), n: clampHalf(this.size().h * 0.35 * mpp) });
    this.mode.set(this.studio.initialMode() === 'model' && this.hasModel() ? 'model' : 'area');
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
    const host = this.wrapEl().nativeElement.getBoundingClientRect();
    const k = this.ppm(), c = this.siteC();
    return { x: c.x + (e.clientX - host.left - host.width / 2) / k, z: c.z + (e.clientY - host.top - host.height / 2) / k };
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
    if (this.tools.find((x) => x.id === t)?.indoor && !this.indoor()) return; // doors, windows, walls, voids, columns: building edit only
    this.scene.pin.set(null);
    this.tool.set(t);
    if (t === 'wall' && this.b()) this.enterIndoor();
    if (t !== 'measure') this.meas.set({ a: null, b: null });
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
    if (this.tools.find((x) => x.id === this.tool())?.indoor) this.tool.set('select');
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
    else if (t === 'tree') {
      this.ed.addTree(snap(p.x, 0.5), snap(p.z, 0.5));
      this.applyNow();
    } else if (t === 'measure') {
      const m = this.meas();
      if (m.a && m.b) this.meas.set({ a: p, b: null });
      else if (m.a) this.meas.set({ a: m.a, b: p });
      else this.meas.set({ a: p, b: null });
    } else if ((t === 'cut' || t === 'wing') && bd) {
      const l = this.toLocal(bd, p);
      const a = { x: snap(l.x, 0.5), z: snap(l.z, 0.5) };
      this.drag.set({ t: 'shape', op: t === 'cut' ? 'cut' : 'add', a, b: { ...a } });
    } else if (t === 'wall' && bd) this.startWall(bd, p);
    else if ((t === 'door' || t === 'window') && bd) this.addOpeningAt(bd, p, t);
  }

  protected measureLineDown(e: PointerEvent): void {
    e.stopPropagation();
    this.meas.set({ a: null, b: null });
  }

  protected bldDown(e: PointerEvent, bd: BuildingSpec): void {
    const t = this.tool();
    if (this.pinMode() || t === 'building' || t === 'tree' || t === 'measure' || t === 'fence' || t === 'structure') return this.bgDown(e);
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
    } else if (t === 'column') this.addColumnAt(bd, p);
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
    if (this.pinMode() || t === 'building' || t === 'tree' || t === 'measure' || t === 'fence' || t === 'structure') return this.bgDown(e);
    e.stopPropagation();
    this.capture(e);
    const tr = this.ed.draft().trees[i];
    if (!tr) return;
    const p = this.toWorld(e);
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
    if (this.pinMode() || t === 'building' || t === 'tree' || t === 'measure' || t === 'fence' || t === 'structure') return this.bgDown(e);
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

  private placeStructure(kind: StructureKind, at: Pt, extra: Partial<StructureSpec> = {}): void {
    const d = STRUCTURE_DEFAULTS[kind];
    this.ed.commitSite((s) => {
      (s.structures ??= []).push({ id: uid('st'), kind, name: d.name, x: at.x, z: at.z, rotDeg: 0, height: d.height, size: d.size, ...(kind === 'bridge' ? { length: d.length, style: 'beam' as const } : {}), ...extra });
    });
    this.pick.set({ t: 'structure', i: (this.ed.draft().structures?.length ?? 1) - 1 });
    this.tool.set('select');
    this.applyNow();
  }

  protected structKindOf = (e: Event): StructureKind => ((e.target as HTMLSelectElement).value as StructureKind);
  protected buildKindOf = (e: Event): 'building' | 'greenhouse' => ((e.target as HTMLSelectElement).value === 'greenhouse' ? 'greenhouse' : 'building');
  protected styleOf = (e: Event): 'beam' | 'arch' => ((e.target as HTMLSelectElement).value === 'arch' ? 'arch' : 'beam');
  protected structLabel(k: StructureKind): string {
    return this.structKinds.find((x) => x.id === k)?.label.replace(' (drag)', '') ?? k;
  }
  protected sizeLabel(k: StructureKind): string {
    return k === 'bridge' ? 'deck width' : k === 'lattice_tower' ? 'base half-width' : k === 'water_tower' ? 'tank radius' : k === 'chimney' ? 'base radius' : 'radius';
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
    if (this.pinMode() || t === 'building' || t === 'tree' || t === 'measure' || t === 'fence' || t === 'structure') return this.bgDown(e);
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
    this.pick.set({ t: 'column', i });
    this.drag.set({ t: 'column', i, dx: c.x - bd.length / 2 - l.x, dz: c.z - bd.width / 2 - l.z });
  }

  private addColumnAt(bd: BuildingSpec, world: Pt): void {
    const l = this.toLocal(bd, world);
    if (!insideBuilding(bd, l)) {
      this.toast.show('Place the column inside the building.');
      return;
    }
    const li = Math.min(this.level(), bd.levels.length - 1);
    let idx = 0;
    this.ed.commitSite((s) => {
      const lev = this.index(s, bd.id)?.levels[li];
      if (!lev) return;
      (lev.columns ??= []).push({ x: snap(l.x + bd.length / 2, 0.5), z: snap(l.z + bd.width / 2, 0.5), size: 0.6 });
      idx = lev.columns.length - 1;
    });
    this.pick.set({ t: 'column', i: idx });
    this.applyNow();
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
    if (!d) return;
    const p = this.toWorld(e);
    const bd = this.b();
    const li = bd ? Math.min(this.level(), bd.levels.length - 1) : 0;
    switch (d.t) {
      case 'frame': {
        const host = this.wrapEl().nativeElement.getBoundingClientRect();
        const dx = Math.abs(e.clientX - (host.left + host.width / 2)) * this.mpp();
        const dz = Math.abs(e.clientY - (host.top + host.height / 2)) * this.mpp();
        this.half.update((h) => ({ e: d.h.includes('e') || d.h.includes('w') ? clampHalf(snap(dx, 5)) : h.e, n: d.h.includes('n') || d.h.includes('s') ? clampHalf(snap(dz, 5)) : h.n }));
        break;
      }
      case 'move':
        if (!bd) break;
        this.gesture((s) => {
          const x = this.index(s, bd.id);
          if (x) x.pos = { x: snap(d.ox + p.x - d.px, 0.5), z: snap(d.oz + p.z - d.pz, 0.5) };
        }, bd.id);
        break;
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
        const rot = ((snap(ang, e.shiftKey ? 15 : 1) % 360) + 360) % 360;
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
      case 'column': {
        if (!bd) break;
        const l = this.toLocal(bd, p);
        this.gesture((s) => {
          const c = this.index(s, bd.id)?.levels[li]?.columns?.[d.i];
          if (c) {
            c.x = Math.min(bd.length, Math.max(0, snap(l.x + d.dx + bd.length / 2, 0.5)));
            c.z = Math.min(bd.width, Math.max(0, snap(l.z + d.dz + bd.width / 2, 0.5)));
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

  protected up(e: PointerEvent): void {
    const d = this.drag();
    this.drag.set(null);
    (e.currentTarget as Element | null)?.releasePointerCapture?.(e.pointerId);
    if (!d) return;
    const bd = this.b();
    if (d.t === 'bridgeDraw') {
      const len = Math.hypot(d.b.x - d.a.x, d.b.z - d.a.z);
      if (len >= 6) this.placeStructure('bridge', { x: (d.a.x + d.b.x) / 2, z: (d.a.z + d.b.z) / 2 }, { length: Math.round(len), rotDeg: Math.round((Math.atan2(d.b.z - d.a.z, d.b.x - d.a.x) * 180) / Math.PI) });
    } else if (d.t === 'fenceDraw') {
      if (Math.hypot(d.b.x - d.a.x, d.b.z - d.a.z) >= 0.5) {
        this.ed.commitSite((s) => {
          (s.walls ??= []).push({ a: d.a, b: d.b, height: 2.2, thick: 0.3 });
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
      if (w >= 3 && h >= 3 && this.ed.draft().buildings.some((o) => buildingsOverlap(ghost, o))) this.toast.show('Buildings cannot overlap: draw it on free ground (use Merge to join them).');
      else if (w >= 3 && h >= 3) {
        const preset: Partial<BuildingSpec> = this.buildKind() === 'greenhouse'
          ? { name: 'Greenhouse', frame: 'greenhouse', color: '#9ec1b6', levels: [{ baseY: 0, height: 2.4, sides: { n: false, s: false, e: false, w: false }, doors: {}, partitions: [], roof: 'vault', roofRise: 0, vaultK: 0.7 }] }
          : { name: `Building ${this.ed.draft().buildings.length + 1}` };
        const gh = this.buildKind() === 'greenhouse'; // a greenhouse tunnel always runs along its long side
        this.ed.addBuilding({ pos: { x: (d.x0 + d.x1) / 2, z: (d.z0 + d.z1) / 2 }, length: gh ? Math.max(w, h) : w, width: gh ? Math.min(w, h) : h, rotDeg: gh && h > w ? 90 : 0, ...preset });
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
    } else if (d.t !== 'frame' && this.gestureStarted) this.applyNow();
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

  protected key(e: KeyboardEvent): void {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.deleteSel();
    } else if (e.key === 'Escape') {
      this.tool.set('select');
      this.scene.pin.set(null);
      this.drag.set(null);
      this.meas.set({ a: null, b: null });
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
    if (p?.t === 'tree') this.ed.removeTree(p.i);
    else if (p?.t === 'structure') this.ed.commitSite((s) => void s.structures?.splice(p.i, 1));
    else if (p?.t === 'fence') this.ed.commitSite((s) => void s.walls?.splice(p.i, 1));
    else if (p?.t === 'void' && bd) this.ed.commitSite((s) => void this.index(s, bd.id)?.levels[li]?.voids?.splice(p.i, 1));
    else if (p?.t === 'column' && bd) this.ed.commitSite((s) => void this.index(s, bd.id)?.levels[li]?.columns?.splice(p.i, 1));
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

  protected readonly setName = (b: BuildingSpec, v: string): void => { b.name = v; };
  protected readonly setLength = (b: BuildingSpec, v: number): void => { b.length = Math.max(2, v); };
  protected readonly setWidth = (b: BuildingSpec, v: number): void => { b.width = Math.max(2, v); };
  protected readonly setRot = (b: BuildingSpec, v: number): void => { b.rotDeg = v; };
  protected readonly toRectangle = (b: BuildingSpec): void => resetToRect(b);

  protected setOpening(patch: Partial<{ kind: 'door' | 'window'; w: number; h: number; sill: number; c: number }>): void {
    const id = this.openId();
    if (!id) return;
    this.mutate((b) => patchOpening(b, Math.min(this.level(), b.levels.length - 1), id, patch), 0);
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

  protected fenceLen(w: { a: Pt; b: Pt }): number {
    return Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
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

  protected setColumn(patch: Partial<{ size: number; round: boolean }>): void {
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
  protected treeKind = (e: Event): 'd' | 'c' => (selectedFrom(e) === 'c' ? 'c' : 'd');
  protected roofOf = (e: Event): LevelSpec['roof'] => selectedFrom(e) as LevelSpec['roof'];
}
