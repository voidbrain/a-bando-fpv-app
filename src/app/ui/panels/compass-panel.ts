import { Component, inject } from '@angular/core';
import { COMPASS_SIZE, cameraUpAngle, drawCompass } from '../../core/drawing/compass';
import { eulerYXZ } from '../../core/math3d';
import { FlightService } from '../../services/flight.service';
import { PlaybackService } from '../../services/playback.service';
import { SceneService } from '../../services/scene.service';
import { SimulatorService } from '../../services/simulator.service';
import { CalibrationStore } from '../../state/calibration.store';
import { ViewStore } from '../../state/view.store';
import { CanvasWidget } from '../panel/canvas-widget';
import { Panel } from '../panel/panel';

@Component({
  selector: 'app-compass-panel',
  imports: [Panel, CanvasWidget],
  template: `<app-panel id="compass"><div class="keep"><app-canvas panel="compass" [width]="size" [height]="size" [draw]="draw" /></div></app-panel>`,
})
export class CompassPanel {
  private readonly scene = inject(SceneService);
  private readonly view = inject(ViewStore);
  private readonly flights = inject(FlightService);
  private readonly playback = inject(PlaybackService);
  private readonly sim = inject(SimulatorService);
  private readonly cal = inject(CalibrationStore);
  protected readonly size = COMPASS_SIZE;

  protected readonly draw = (g: CanvasRenderingContext2D): void => {
    const cam = this.scene.host?.mainCamera;
    if (!cam) return;
    const up = { x: cam.up.x, z: cam.up.z };
    // direction the camera looks along, in the ground plane: the camera's forward = -Z in its own frame
    const fx = -2 * (cam.quaternion.x * cam.quaternion.z + cam.quaternion.w * cam.quaternion.y);
    const fz = -(1 - 2 * (cam.quaternion.x * cam.quaternion.x + cam.quaternion.y * cam.quaternion.y));
    const useSim = this.sim.state.armed || !this.flights.active;
    const yaw = eulerYXZ(useSim ? this.sim.state.q : this.playback.pose.q).y;
    drawCompass(g, {
      calRot: this.cal.rot(),
      cameraUp: cameraUpAngle(this.view.cameraView(), up, { x: fx, z: fz }),
      droneHeading: -yaw - (this.cal.rot() * Math.PI) / 180,
    });
  };
}
