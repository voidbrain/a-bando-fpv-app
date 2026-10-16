import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { INSTRUMENTS_SIZE, drawInstruments } from '../../core/drawing/instruments';
import { DEG } from '../../core/math';
import { eulerYXZ } from '../../core/math3d';
import { FlightService } from '../../services/flight.service';
import { PlaybackService } from '../../services/playback.service';
import { SimulatorService } from '../../services/simulator.service';
import { CalibrationStore } from '../../state/calibration.store';
import { CanvasWidget } from '../panel/canvas-widget';
import { Panel } from '../panel/panel';

@Component({
  selector: 'app-attitude-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Panel, CanvasWidget],
  template: `<app-panel id="attitude"><div class="keep"><app-canvas panel="attitude" [width]="size.w" [height]="size.h" [draw]="draw" /></div></app-panel>`,
})
export class AttitudePanel {
  private readonly flights = inject(FlightService);
  private readonly playback = inject(PlaybackService);
  private readonly sim = inject(SimulatorService);
  private readonly cal = inject(CalibrationStore);
  protected readonly size = INSTRUMENTS_SIZE;

  protected readonly draw = (g: CanvasRenderingContext2D): void => {
    const useSim = this.sim.state.armed || !this.flights.active;
    const q = useSim ? this.sim.state.q : this.playback.pose.q;
    const e = eulerYXZ(q);
    const heading = (((-e.y - (this.cal.rot() * Math.PI) / 180) * DEG) % 360 + 360) % 360;
    drawInstruments(g, { pitch: e.x * DEG, roll: -e.z * DEG, heading });
  };
}
