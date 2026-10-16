import { Injectable, inject } from '@angular/core';
import type { CameraView } from '../core/models';
import { ViewStore } from '../state/view.store';
import { FlightService } from './flight.service';
import { PlaybackService } from './playback.service';
import { RadioService } from './radio.service';
import { SceneService } from './scene.service';
import { SimulatorService } from './simulator.service';
import { ToastService } from './toast.service';

const NEXT_VIEW: Record<Exclude<CameraView, 'top'>, CameraView> = { orbit: 'chase', chase: 'fpv', fpv: 'orbit' };

/** Global keyboard shortcuts. (WASD / QE / arrows / space are flight controls and are read by RadioService.) */
@Injectable({ providedIn: 'root' })
export class ShortcutsService {
  private readonly sim = inject(SimulatorService);
  private readonly playback = inject(PlaybackService);
  private readonly flights = inject(FlightService);
  private readonly view = inject(ViewStore);
  private readonly radio = inject(RadioService);
  private readonly scene = inject(SceneService);
  private readonly toast = inject(ToastService);
  private bound = false;

  bind(): void {
    if (this.bound) return;
    this.bound = true;
    addEventListener('keydown', (e) => {
      if (this.radio.isTyping(e) || e.repeat) return;
      switch (e.code) {
        case 'Escape':
          if (this.scene.pin()) {
            this.scene.endPin();
            this.toast.show('Pin cancelled');
          }
          break;
        case 'Enter':
          this.sim.toggleArmed();
          break;
        case 'KeyV': {
          const v = this.view.cameraView();
          this.view.setCameraView(v === 'top' ? 'orbit' : NEXT_VIEW[v]);
          break;
        }
        case 'KeyM':
          this.sim.toggleMode();
          break;
        case 'KeyH':
          this.sim.toggleHold();
          break;
        case 'KeyR':
          this.sim.reset();
          break;
        case 'KeyP':
          this.playback.toggle();
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
          if (this.flights.active) this.playback.seekBy((e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1));
          break;
      }
    });
  }
}
