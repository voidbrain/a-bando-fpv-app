import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import type { FlightMode } from '../core/models';
import { SwitchTracker } from '../core/radio/radio-input';
import type { CollisionWorld } from '../core/sim/collider';
import { DRONE_REST_HEIGHT } from '../core/constants';
import { takeoffSpot } from '../core/takeoff';
import { createDroneState, resetDroneState, stepDrone, toggleMode } from '../core/sim/drone-physics';
import { SimRecorder } from '../core/sim/recorder';
import { eulerYXZ } from '../core/math3d';
import { CalibrationStore } from '../state/calibration.store';
import { RadioStore } from '../state/radio.store';
import { ViewStore } from '../state/view.store';
import { DownloadService } from './download.service';
import { FlightService } from './flight.service';
import { FrameLoopService, FrameOrder } from './frame-loop.service';
import { RadioService } from './radio.service';
import { ToastService } from './toast.service';

export interface SimHud {
  speedKmh: number;
  altitude: number;
  status: string;
}

/**
 * The flight simulator: drone state and physics stepping, arming (which records a GPS blackbox at 10 Hz and turns it
 * into a flight on disarm), flight mode and altitude hold, crashes, and the CSV / JSON export of the last recording.
 */
@Injectable({ providedIn: 'root' })
export class SimulatorService {
  private readonly radio = inject(RadioService);
  private readonly radioSettings = inject(RadioStore);
  private readonly calibration = inject(CalibrationStore);
  private readonly view = inject(ViewStore);
  private readonly flights = inject(FlightService);
  private readonly downloads = inject(DownloadService);
  private readonly toast = inject(ToastService);

  readonly state = createDroneState(this.calibration.modelScale(), takeoffSpot());
  readonly recorder = new SimRecorder();
  /** Collision geometry, provided by the scene once the 3D site exists. */
  world: CollisionWorld | null = null;

  readonly armed = signal(false);
  readonly mode = signal<FlightMode>('angle');
  readonly altitudeHold = signal(true);
  readonly hasRecording = signal(false);
  readonly hud = signal<SimHud>({ speedKmh: 0, altitude: 0, status: 'Disarmed' });

  private readonly switches = new SwitchTracker();
  private frame = 0;

  constructor() {
    inject(FrameLoopService).add(FrameOrder.simulation, (dt) => this.step(dt));
    // Resizing the model moves the take-off spot: put the parked drone back on it.
    effect(() => {
      this.calibration.modelScale();
      untracked(() => {
        if (!this.state.armed && this.state.p.y < 0.2) this.reset();
      });
    });
  }

  setArmed(on: boolean): void {
    if (on === this.state.armed) return;
    this.state.armed = on;
    this.armed.set(on);
    if (on) {
      this.recorder.start();
      this.toast.show('Armed · recording GPS blackbox @10 Hz');
    } else if (this.recorder.length > 5) {
      this.hasRecording.set(true);
      this.flights.add(this.flights.nextSimulatedName(), this.recorder.toGeoSamples());
      this.toast.show(`Disarmed · log saved (${this.recorder.length} pts)`);
    }
  }
  toggleArmed(): void {
    this.setArmed(!this.state.armed);
  }

  toggleMode(): void {
    this.mode.set(toggleMode(this.state));
  }

  toggleHold(): void {
    this.state.hold = !this.state.hold;
    this.altitudeHold.set(this.state.hold);
    this.toast.show(`Altitude hold ${this.state.hold ? 'on' : 'off'}`);
  }

  reset(): void {
    this.setArmed(false);
    resetDroneState(this.state, this.calibration.modelScale(), takeoffSpot());
  }

  /** Move the parked drone to a new take-off pad (scaled world coords), keeping it disarmed. */
  reposition(x: number, z: number, y = 0): void {
    const scale = this.calibration.modelScale();
    this.setArmed(false);
    this.state.p.set(x * scale, y * scale + DRONE_REST_HEIGHT, z * scale);
    this.state.v.set(0, 0, 0);
  }

  downloadCsv(): void {
    if (this.hasRecording()) this.downloads.save('fpv-blackbox-gps.csv', this.recorder.toCsv(), 'text/csv');
  }
  downloadJson(): void {
    if (this.hasRecording()) this.downloads.save('fpv-blackbox-gps.json', this.recorder.toJson(), 'application/json');
  }

  /** Heading of the simulator drone in the geographic frame (degrees, [0, 360)). */
  headingDegrees(): number {
    const yaw = eulerYXZ(this.state.q).y;
    return ((((-yaw - (this.calibration.rot() * Math.PI) / 180) * 180) / Math.PI) % 360 + 360) % 360;
  }

  private step(dt: number): void {
    const s = this.state;
    const input = this.radio.read();
    const actions = this.switches.update(input);
    if (actions.arm !== undefined) this.setArmed(actions.arm);
    if (actions.armRefused) this.toast.show('Arm switch ignored: lower the throttle first');
    if (actions.mode && s.mode !== actions.mode) this.toggleMode();

    const result = stepDrone(s, dt, input, { rate: this.radioSettings.rate(), expo: this.radioSettings.expo() }, this.view.collisions() ? this.world : null);
    if (result.crashed && s.armed) {
      this.toast.show('Crash — motors off');
      this.setArmed(false);
    } else if (s.armed) {
      this.recorder.tick(dt, s, result.throttle, this.calibration.calibration());
    }

    if (this.frame++ % 2 === 0) {
      const next: SimHud = {
        speedKmh: Math.round(s.v.length() * 3.6),
        altitude: Math.round(s.p.y * 10) / 10,
        status: s.armed ? `REC ${(this.recorder.length / 10).toFixed(0)}s` : 'Disarmed',
      };
      const cur = this.hud();
      if (cur.speedKmh !== next.speedKmh || cur.altitude !== next.altitude || cur.status !== next.status) this.hud.set(next);
    }
  }
}
