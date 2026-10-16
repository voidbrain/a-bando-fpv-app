import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { createPathView, dragPathView, drawFlightPath, resetPathView, zoomPathView, type PathViewMode } from '../../core/drawing/flight-path';
import { FlightService } from '../../services/flight.service';
import { PlaybackService } from '../../services/playback.service';
import { CalibrationStore } from '../../state/calibration.store';
import { CanvasWidget } from '../panel/canvas-widget';
import { Panel } from '../panel/panel';

@Component({
  selector: 'app-path-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
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
        <div class="keep canvas" (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up()" (pointercancel)="up()" (wheel)="wheel($event)">
          <app-canvas panel="path" [draw]="draw" />
        </div>
        <div class="dim small">{{ caption() }}</div>
      </div>
    </app-panel>
  `,
  styles: `
    .fill {
      height: 100%;
    }
    .canvas {
      flex: 1;
      min-height: 80px;
      touch-action: none;
      cursor: grab;
    }
  `,
})
export class PathPanel {
  private readonly flights = inject(FlightService);
  private readonly playback = inject(PlaybackService);
  private readonly cal = inject(CalibrationStore);
  protected readonly modes: readonly { mode: PathViewMode; label: string }[] = [
    { mode: 'top', label: 'Top' },
    { mode: 'side', label: 'Side' },
    { mode: 'front', label: 'Front' },
    { mode: '3d', label: '3D' },
  ];
  protected readonly mode = signal<PathViewMode>('top');
  protected readonly caption = signal('');
  private readonly view = createPathView();
  private last: { x: number; y: number } | null = null;

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
    const label = drawFlightPath(g, w, h, all, this.view, this.cal.calibration(), this.flights.speedMax, active ? this.playback.pose.p : null);
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
