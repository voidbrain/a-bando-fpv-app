import { Component, inject } from '@angular/core';
import { GAUGE_SIZE, SIM_SCALE_MAX, drawGauge, replayScaleMax } from '../../core/drawing/gauge';
import { flightSpeedMax } from '../../core/flight/flight';
import { FlightService } from '../../services/flight.service';
import { SimulatorService } from '../../services/simulator.service';
import { CanvasWidget } from '../panel/canvas-widget';
import { Panel } from '../panel/panel';

@Component({
  selector: 'app-speed-panel',
  imports: [Panel, CanvasWidget],
  template: `<app-panel id="speed"><div class="keep"><app-canvas panel="speed" [width]="size.w" [height]="size.h" [draw]="draw" /></div></app-panel>`,
})
export class SpeedPanel {
  private readonly flights = inject(FlightService);
  private readonly sim = inject(SimulatorService);
  protected readonly size = GAUGE_SIZE;

  /** The simulator drone's speed while flying it (or with nothing loaded); otherwise the replayed GPS speed. */
  protected readonly draw = (g: CanvasRenderingContext2D): void => {
    const f = this.flights.active;
    if (this.sim.state.armed || !f) {
      drawGauge(g, { speed: this.sim.state.v.length(), scaleMax: SIM_SCALE_MAX, source: 'SIM' });
    } else {
      const speed = f.spd[Math.min(f.cursor, f.spd.length - 1)] ?? 0;
      drawGauge(g, { speed, scaleMax: replayScaleMax(flightSpeedMax(f)), source: 'REPLAY' });
    }
  };
}
