import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BLACKBOX_SIZE, createBlackboxState, drawBlackbox, inDroneDragArea } from '../../core/drawing/blackbox';
import { FlightService } from '../../services/flight.service';
import { PlaybackService } from '../../services/playback.service';
import { CanvasWidget } from '../panel/canvas-widget';
import { Panel } from '../panel/panel';

const DRAG_YAW_PER_PX = 0.012;

@Component({
  selector: 'app-blackbox-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Panel, CanvasWidget],
  template: `
    <app-panel id="blackbox">
      <div class="keep box" (pointerdown)="down($event)" (pointermove)="move($event)" (pointerup)="up()" (pointercancel)="up()">
        <app-canvas panel="blackbox" [width]="size.w" [height]="size.h" [draw]="draw" />
      </div>
      @if (!hasTelemetry()) {
        <div class="dim small">Load a Betaflight Blackbox CSV with motor, gyro and RC columns to see sticks, motors and attitude here.</div>
      }
    </app-panel>
  `,
  styles: `
    .box {
      touch-action: none;
    }
  `,
})
export class BlackboxPanel {
  private readonly flights = inject(FlightService);
  private readonly playback = inject(PlaybackService);
  protected readonly size = BLACKBOX_SIZE;
  private readonly state = createBlackboxState();
  private drag: number | null = null;

  protected hasTelemetry(): boolean {
    return !!this.flights.active?.tel;
  }

  protected readonly draw = (g: CanvasRenderingContext2D, w: number, h: number): void => {
    const tel = this.flights.active?.tel;
    if (!tel) {
      g.clearRect(0, 0, w, h);
      return;
    }
    drawBlackbox(g, tel, this.playback.time, this.state);
  };

  /** Drag the 3D drone sideways to turn it about the vertical axis. */
  protected down(e: PointerEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (!inDroneDragArea(e.clientX - r.left, e.clientY - r.top)) return;
    this.drag = e.clientX;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  protected move(e: PointerEvent): void {
    if (this.drag === null) return;
    this.state.view.yaw += (e.clientX - this.drag) * DRAG_YAW_PER_PX;
    this.drag = e.clientX;
  }
  protected up(): void {
    this.drag = null;
  }
}
