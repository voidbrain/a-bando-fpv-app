import { Component, computed, inject, signal } from '@angular/core';
import { wrapDeg } from '../../core/math';
import { latLonText, parseLatLon, siteFromLatLon } from '../../core/geo';
import { SiteService } from '../../services/site.service';
import { ToastService } from '../../services/toast.service';
import { createPathView, dragPathView, drawFlightPath, resetPathView, zoomPathView, type PathViewMode } from '../../core/drawing/flight-path';
import { FlightService } from '../../services/flight.service';
import { PlaybackService } from '../../services/playback.service';
import { SceneService } from '../../services/scene.service';
import { CalibrationStore } from '../../state/calibration.store';
import { CanvasWidget } from '../panel/canvas-widget';
import { Panel } from '../panel/panel';

@Component({
  selector: 'app-path-panel',
  imports: [Panel, CanvasWidget],
  template: `
    <app-panel id="path">
      <div class="col fill">
        <div class="row">
          @for (m of modes; track m.mode) {
            <button class="ico" [class.on]="mode() === m.mode" (click)="setMode(m.mode)" [title]="m.label" [attr.aria-label]="m.label" [attr.aria-pressed]="mode() === m.mode">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path [attr.d]="m.icon" /></svg>
            </button>
          }
          <button class="ico" (click)="fit()" title="Fit the path in the view" aria-label="Fit the path in the view">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg>
          </button>
        </div>
        @if (hasFlight()) {
          <div class="row start">
            @if (placed()) {
              <label class="grow">start <input class="ll" type="text" [value]="startText()" (change)="typeStart($event)" title="Where the flight starts, latitude and longitude: type others to move the path there" /></label>
            } @else {
              <label>start x m <input class="mini" type="number" step="0.5" [value]="startX()" (change)="typeStartX($event)" title="Where the flight starts in the bando, metres east of its centre" /></label>
              <label>z m <input class="mini" type="number" step="0.5" [value]="startZ()" (change)="typeStartZ($event)" title="Where the flight starts in the bando, metres south of its centre" /></label>
            }
          </div>
        }
        <div class="body">
          <div class="keep canvas" (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up()" (pointercancel)="up()" (wheel)="wheel($event)">
            <app-canvas panel="path" [draw]="draw" />
          </div>
          <div class="side">
            <button class="ico" [class.on]="scene.pin() === 's'" (click)="scene.armPin('s')" title="Pin start: click the ground where the flight started" aria-label="Pin start">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path class="s" d="M6 21V4h11l-2 4 2 4H6" /></svg>
            </button>
            <button class="ico" [class.on]="scene.pin() === 'e'" (click)="scene.armPin('e')" title="Pin end: click the ground where the flight ended" aria-label="Pin end">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path class="e" d="M6 21V4h11v8H6" /><path class="e" d="M6 8h11M11.5 4v8" /></svg>
            </button>
            <div
              class="knob"
              role="slider"
              tabindex="0"
              aria-label="Turn the path about its start"
              title="Turn the path about its start: drag around, or use the arrow keys (Shift = 10°)"
              aria-valuemin="-180"
              aria-valuemax="180"
              [attr.aria-valuenow]="turn()"
              [attr.aria-valuetext]="turn() + '°'"
              (pointerdown)="knobDown($event)"
              (pointermove)="knobMove($event)"
              (pointerup)="knobUp($event)"
              (pointercancel)="knobUp($event)"
              (keydown)="knobKey($event)"
            >
              <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
                <circle cx="20" cy="20" r="17" />
                <line x1="20" y1="20" x2="20" y2="5" [attr.transform]="'rotate(' + turn() + ' 20 20)'" />
              </svg>
              <span class="deg">{{ turn() }}°</span>
            </div>
          </div>
        </div>
        <div class="dim small">{{ caption() }}</div>
      </div>
    </app-panel>
  `,
  styles: `
    .fill {
      height: 100%;
    }
    .body {
      flex: 1;
      display: flex;
      gap: 6px;
      min-height: 80px;
    }
    .canvas {
      flex: 1;
      min-height: 80px;
      touch-action: none;
      cursor: grab;
    }
    .row .ico {
      width: 30px;
      height: 28px;
    }
    .ico path {
      stroke: var(--text);
    }
    .start label {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .grow {
      flex: 1;
    }
    .ll {
      flex: 1;
      min-width: 0;
      font-family: var(--mono);
    }
    .mini {
      width: 64px;
    }
    .side {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }
    .ico {
      width: 32px;
      height: 32px;
      display: grid;
      place-items: center;
      background: transparent;
      border: 1px solid var(--line);
      border-radius: 8px;
      cursor: pointer;
    }
    .ico:hover {
      background: rgba(255, 255, 255, 0.06);
    }
    .ico.on {
      border-color: var(--accent);
      background: rgba(183, 237, 131, 0.14);
    }
    .ico path {
      fill: none;
      stroke-width: 1.8;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .ico.on path {
      stroke: var(--accent);
    }
    .ico .s {
      stroke: var(--accent);
    }
    .ico .e {
      stroke: var(--danger);
    }
    .knob {
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: grab;
      touch-action: none;
      border-radius: 50%;
    }
    .knob:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .knob circle {
      fill: var(--panel-solid);
      stroke: var(--line);
      stroke-width: 2;
    }
    .knob line {
      stroke: var(--accent);
      stroke-width: 3;
      stroke-linecap: round;
    }
    .deg {
      font: 10px var(--mono);
      color: var(--dim);
    }
  `,
})
export class PathPanel {
  private readonly flights = inject(FlightService);
  private readonly playback = inject(PlaybackService);
  private readonly cal = inject(CalibrationStore);
  private readonly toast = inject(ToastService);
  protected readonly scene = inject(SceneService);
  private readonly site = inject(SiteService);
  protected readonly modes: readonly { mode: PathViewMode; label: string; icon: string }[] = [
    { mode: 'top', label: 'Top view', icon: 'M5 5h14v14H5zM12 9v6M9 12h6' },
    { mode: 'side', label: 'Side view (looking north)', icon: 'M3 19h18M6 19v-6l4-4 4 3 4-5v12' },
    { mode: 'front', label: 'Front view (looking west)', icon: 'M3 19h18M6 19V9h12v10M9 19v-5h6v5' },
    { mode: '3d', label: '3D view', icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5' },
  ];
  /** The bando has its real place: the start is shown and typed as latitude, longitude (else as site metres). */
  protected readonly placed = computed(() => this.site.active().privacy !== 'hidden' && !(this.site.active().origin.lat === 0 && this.site.active().origin.lon === 0));
  protected readonly hasFlight = signal(false);
  protected readonly startText = signal('');
  protected readonly startX = signal(0);
  protected readonly startZ = signal(0);
  protected readonly mode = signal<PathViewMode>('3d');
  protected readonly caption = signal('');
  private readonly view = createPathView();
  private last: { x: number; y: number } | null = null;
  /** The path's turn against the map, degrees (-180..180), shown on the knob. */
  protected readonly turn = computed(() => Math.round(wrapDeg(this.cal.calibration().rot)));
  private knobAt: number | null = null;

  /** Angle of the pointer around the knob's centre, degrees clockwise from up. */
  private knobAngle(e: PointerEvent): number {
    const r = (e.currentTarget as HTMLElement).querySelector('svg')!.getBoundingClientRect();
    return (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
  }
  protected knobDown(e: PointerEvent): void {
    this.knobAt = this.knobAngle(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  protected knobMove(e: PointerEvent): void {
    if (this.knobAt == null) return;
    const a = this.knobAngle(e);
    this.scene.turnPath(wrapDeg(a - this.knobAt));
    this.knobAt = a;
  }
  protected knobUp(e: PointerEvent): void {
    this.knobAt = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }
  protected knobKey(e: KeyboardEvent): void {
    const step = e.shiftKey ? 10 : 1;
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? step : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -step : 0;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation(); // the arrow keys also seek the replay (ShortcutsService): not while turning the path
    this.scene.turnPath(d);
  }

  protected setMode(m: PathViewMode): void {
    this.view.mode = m;
    this.mode.set(m);
  }
  protected fit(): void {
    resetPathView(this.view);
  }

  protected readonly draw = (g: CanvasRenderingContext2D, w: number, h: number): void => {
    const all = this.flights.all;
    const active = this.flights.active;
    const label = drawFlightPath(g, w, h, all, this.view, this.cal.calibration(), this.flights.speedMax, active ? this.playback.pose.p : null, active);
    if (label !== this.caption()) this.caption.set(label);
    // the start fields follow pins, the knob and typed values (cheap: the signals only change when the start moves)
    const s = active?.loc[0];
    this.hasFlight.set(!!s);
    if (s) {
      this.startX.set(Math.round(s.x * 10) / 10);
      this.startZ.set(Math.round(s.z * 10) / 10);
      this.startText.set(latLonText(this.site.active().origin, s));
    }
  };

  protected typeStart(e: Event): void {
    const p = parseLatLon((e.target as HTMLInputElement).value);
    if (!p) {
      this.toast.show('Not a latitude, longitude: try 45.4642, 9.1900');
      (e.target as HTMLInputElement).value = this.startText();
      return;
    }
    const q = siteFromLatLon(this.site.active().origin, p);
    this.scene.placeStart(q.x, q.z);
  }
  protected typeStartX(e: Event): void {
    this.scene.placeStart(+(e.target as HTMLInputElement).value, this.startZ());
  }
  protected typeStartZ(e: Event): void {
    this.scene.placeStart(this.startX(), +(e.target as HTMLInputElement).value);
  }

  protected down(e: PointerEvent): void {
    this.last = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  protected move(e: PointerEvent): void {
    if (!this.last) return;
    dragPathView(this.view, e.clientX - this.last.x, e.clientY - this.last.y, e.shiftKey);
    this.last = { x: e.clientX, y: e.clientY };
  }
  protected up(): void {
    this.last = null;
  }
  protected wheel(e: WheelEvent): void {
    e.preventDefault();
    zoomPathView(this.view, e.deltaY);
  }
}
