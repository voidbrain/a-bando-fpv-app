import { Component, computed, inject, signal } from '@angular/core';
import { wrapDeg } from '../../core/math';
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
            <button class="btn" [class.on]="mode() === m.mode" (click)="setMode(m.mode)">{{ m.label }}</button>
          }
          <button class="btn" (click)="fit()">Fit</button>
        </div>
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
  protected readonly scene = inject(SceneService);
  protected readonly modes: readonly { mode: PathViewMode; label: string }[] = [
    { mode: 'top', label: 'Top' },
    { mode: 'side', label: 'Side' },
    { mode: 'front', label: 'Front' },
    { mode: '3d', label: '3D' },
  ];
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
  };

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
