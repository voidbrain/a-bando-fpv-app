import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { contains, edgesOf, type Pt, type Rect } from '../../core/footprint';
import { addOpening, listOpenings, moveOpening, outlineOf, patchOpening, removeOpening, reshapeBuilding, resetToRect, resizeOpening, type OpenSeg } from '../../core/openings';
import { cloneSpec, type BuildingSpec, type LevelSpec, type LocationInfo, type SiteSpec } from '../../core/site-spec';
import { AiService } from '../../services/ai.service';
import { FlightService } from '../../services/flight.service';
import { GeoService } from '../../services/geo.service';
import { SceneService } from '../../services/scene.service';
import { MAX_HALF_EXTENT, SiteService } from '../../services/site.service';
import { StudioService } from '../../services/studio.service';
import { ToastService } from '../../services/toast.service';
import { ViewStore } from '../../state/view.store';
import { numberFrom, selectedFrom, textFrom } from '../dom';
import { FloatBox } from '../float-box';
import { AssistantBox } from './assistant-box';

type Tool = 'select' | 'building' | 'cut' | 'wing' | 'tree' | 'door' | 'window' | 'wall' | 'measure';
type Pick = { t: 'building' } | { t: 'tree'; i: number } | { t: 'opening'; id: string } | { t: 'wall'; i: number } | null;
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
  imports: [FormsModule, FloatBox, AssistantBox],
  host: { class: 'be' },
  template: `
    <div class="bar">
      <div class="seg">
        <button [class.on]="mode() === 'area'" (click)="setMode('area')">1 · Area</button>
        <button [class.on]="mode() === 'model'" [disabled]="!hasModel()" (click)="setMode('model')" [title]="hasModel() ? '' : 'Generate the model first'">2 · Model</button>
      </div>
      @if (mode() === 'model') {
        @for (t of tools; track t.id) {
          <button class="btn" [class.on]="tool() === t.id" (click)="setTool(t.id)" [title]="t.hint">{{ t.label }}</button>
        }
        <button class="btn" [class.on]="indoor()" [disabled]="!b()" (click)="toggleIndoor()" title="Take the roof off and edit walls, doors and windows inside the selected building">{{ indoor() ? '✓ Indoors' : 'Edit indoors' }}</button>
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
          @for (t of ed.draft().trees; track $index) {
            <circle class="hit" [attr.cx]="t.x" [attr.cy]="t.z" [attr.r]="t.r" [attr.fill]="t.kind === 'c' ? '#2f6b3c' : '#4f9a4a'" fill-opacity="0.85" [attr.stroke]="treeI() === $index ? '#ffd166' : '#1d3d22'" stroke-width="1.5" vector-effect="non-scaling-stroke" (pointerdown)="treeDown($event, $index)" />
          }
          @for (bd of ed.draft().buildings; track bd.id) {
            <g [attr.transform]="tf(bd)" [attr.opacity]="indoor() && bd.id !== ed.selectedId() ? 0.35 : 1">
              <polygon class="hit" [attr.points]="outline(bd)" [attr.fill]="bd.color ?? '#d7d0bd'" [attr.fill-opacity]="indoor() && bd.id === ed.selectedId() ? 0.2 : 0.8" [attr.stroke]="bd.id === ed.selectedId() ? '#b7ed83' : '#2d3a33'" [attr.stroke-width]="bd.id === ed.selectedId() ? 3 : 1.5" vector-effect="non-scaling-stroke" (pointerdown)="bldDown($event, bd)" />
            </g>
            <text [attr.x]="bd.pos.x" [attr.y]="bd.pos.z" text-anchor="middle" dominant-baseline="middle" [attr.font-size]="labelSize(bd)" fill="#1b231e" stroke="#fff" stroke-width="0.35" paint-order="stroke" pointer-events="none">{{ bd.name }}</text>
          }
          @if (b(); as bd) {
            <g [attr.transform]="tf(bd)">
              @if (indoor()) {
                @for (pt of lvl()?.partitions ?? []; track $index) {
                  <line class="hit" [attr.x1]="pt[0].x - bd.length / 2" [attr.y1]="pt[0].z - bd.width / 2" [attr.x2]="pt[1].x - bd.length / 2" [attr.y2]="pt[1].z - bd.width / 2" [attr.stroke]="wallI() === $index ? '#ffd166' : '#f1f4f2'" stroke-width="5" stroke-linecap="round" vector-effect="non-scaling-stroke" (pointerdown)="wallDown($event, $index)" />
                }
                @if (drag()?.t === 'wallDraw') {
                  <line [attr.x1]="wd().a.x - bd.length / 2" [attr.y1]="wd().a.z - bd.width / 2" [attr.x2]="wd().b.x - bd.length / 2" [attr.y2]="wd().b.z - bd.width / 2" stroke="#ffd166" stroke-width="4" stroke-dasharray="6 4" vector-effect="non-scaling-stroke" pointer-events="none" />
                }
              }
              @for (o of openings(); track o.id) {
                <line class="hit" [attr.x1]="seg(o).x1" [attr.y1]="seg(o).y1" [attr.x2]="seg(o).x2" [attr.y2]="seg(o).y2" [attr.stroke]="o.kind === 'door' ? '#ff9a2e' : '#4fc3f7'" [attr.stroke-width]="openId() === o.id ? 10 : 7" vector-effect="non-scaling-stroke" (pointerdown)="openDown($event, o.id)" />
                @if (openId() === o.id) {
                  <circle class="hit" [attr.cx]="seg(o).x1" [attr.cy]="seg(o).y1" [attr.r]="hr()" fill="#fff" stroke="#12200b" vector-effect="non-scaling-stroke" (pointerdown)="openEndDown($event, o.id, 0)" />
                  <circle class="hit" [attr.cx]="seg(o).x2" [attr.cy]="seg(o).y2" [attr.r]="hr()" fill="#fff" stroke="#12200b" vector-effect="non-scaling-stroke" (pointerdown)="openEndDown($event, o.id, 1)" />
                }
              }
              @if (tool() === 'select' && !indoor() && !bd.frame) {
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
        <app-float-box fid="inspector" title="Inspector" [x]="8" [y]="40" [w]="280" [h]="250">
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
                @if (!bd.frame) {
                  <div class="f levels">
                    @for (l of bd.levels; track $index) {
                      <button class="btn" [class.on]="$index === level()" (click)="level.set($index)">L{{ $index + 1 }}</button>
                    }
                    <button class="btn" (click)="addLevel()" title="Add a floor">＋ floor</button>
                  </div>
                  @if (lvl(); as l) {
                    <div class="f"><label>wall height <input type="number" min="1" step="0.5" [value]="l.height" (change)="editLevel(setHeight, num($event))" /></label>
                    @if (!bd.footprint) {
                      <label>roof <select (change)="editLevel(setRoof, roofOf($event))"><option value="gable" [selected]="l.roof === 'gable'">gable</option><option value="vault" [selected]="l.roof === 'vault'">vault</option><option value="flat" [selected]="l.roof === 'flat'">flat</option></select></label>
                    }</div>
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
  protected readonly text = textFrom;
  protected readonly round = Math.round;
  protected readonly edgesOf = edgesOf;
  protected readonly handles: readonly Handle[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
  protected readonly corners: readonly [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  protected readonly tools: readonly { id: Tool; label: string; hint: string }[] = [
    { id: 'select', label: '↖', hint: 'Select · move · resize · rotate' },
    { id: 'building', label: '＋ Building', hint: 'Drag a rectangle on the map' },
    { id: 'cut', label: '✂ Cut', hint: 'Cut a notch out of the selected building (U, H, L shapes)' },
    { id: 'wing', label: '⊕ Wing', hint: 'Add a wing to the selected building' },
    { id: 'tree', label: '＋ Tree', hint: 'Click the map to plant a tree' },
    { id: 'door', label: '＋ Door', hint: 'Click a wall of the selected building' },
    { id: 'window', label: '＋ Window', hint: 'Click a wall of the selected building' },
    { id: 'wall', label: '＋ Wall', hint: 'Draw an interior wall (indoors)' },
    { id: 'measure', label: 'Measure', hint: 'Click point A, then point B · click the line to remove it' },
  ];

  protected readonly mode = signal<'area' | 'model'>('area');
  protected readonly tool = signal<Tool>('select');
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
    return bd ? listOpenings(bd, Math.min(this.level(), bd.levels.length - 1)) : [];
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
    if (t === 'building') return 'Drag a rectangle to add a building.';
    if (t === 'cut' || t === 'wing') return this.b() ? `Drag a rectangle over the selected building to ${t === 'cut' ? 'cut it out' : 'add it as a wing'}.` : 'Select a building first.';
    if (t === 'tree') return 'Click to plant trees; switch to ↖ to move or delete them.';
    if (t === 'door' || t === 'window') return this.b() ? `Click a wall of “${this.b()!.name}” to add a ${t}.` : 'Select a building first.';
    if (t === 'wall') return this.b() ? 'Drag inside the building to draw an interior wall.' : 'Select a building first.';
    if (t === 'measure') return 'Click point A, then point B. Click the line to remove it.';
    if (this.indoor()) return 'Indoors: roof off in 3D. Drag walls, doors and windows (white ends resize). Delete removes the selection.';
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
    if (this.tool() === 'wall') this.tool.set('select');
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
    if (t === 'building') this.drag.set({ t: 'draw', x0: snap(p.x, 1), z0: snap(p.z, 1), x1: snap(p.x, 1), z1: snap(p.z, 1) });
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
    if (this.pinMode() || t === 'building' || t === 'tree' || t === 'measure') return this.bgDown(e);
    e.stopPropagation();
    const p = this.toWorld(e);
    this.capture(e);
    const isSel = this.ed.selectedId() === bd.id;
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
    if (this.pinMode() || t === 'building' || t === 'tree' || t === 'measure') return this.bgDown(e);
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
        });
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
        });
        break;
      }
      case 'rotate': {
        if (!bd) break;
        const ang = (Math.atan2(p.z - bd.pos.z, p.x - bd.pos.x) * 180) / Math.PI + 90;
        const rot = ((snap(ang, e.shiftKey ? 15 : 1) % 360) + 360) % 360;
        this.gesture((s) => {
          const x = this.index(s, bd.id);
          if (x) x.rotDeg = rot;
        });
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
        });
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
  private gesture(fn: (s: SiteSpec) => void): void {
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
    if (d.t === 'draw') {
      const w = Math.abs(d.x1 - d.x0), h = Math.abs(d.z1 - d.z0);
      if (w >= 3 && h >= 3) {
        this.ed.addBuilding({ pos: { x: (d.x0 + d.x1) / 2, z: (d.z0 + d.z1) / 2 }, length: w, width: h, rotDeg: 0, name: `Building ${this.ed.draft().buildings.length + 1}` });
        this.pick.set({ t: 'building' });
        this.tool.set('select');
        this.applyNow();
      }
    } else if (d.t === 'shape' && bd) {
      const rect: Rect = { x0: d.a.x, z0: d.a.z, x1: d.b.x, z1: d.b.z };
      if (Math.abs(rect.x1 - rect.x0) >= 0.5 && Math.abs(rect.z1 - rect.z0) >= 0.5) {
        const probe = cloneSpec({ ...this.ed.draft(), buildings: [bd] }).buildings[0]!;
        if (!reshapeBuilding(probe, rect, d.op)) this.toast.show(d.op === 'cut' ? 'That cut would split the building or leave a hole.' : 'The wing has to touch the building.');
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
