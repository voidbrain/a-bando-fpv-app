import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, viewChild } from '@angular/core';
import { attachOrbitControls } from '../../three/orbit-controls';
import { SceneService, type ViewportType } from '../../services/scene.service';
import { CalibrationStore } from '../../state/calibration.store';
import type { PanelId } from '../panel-defs';
import { Panel } from '../panel/panel';

const PANEL_IDS: Record<ViewportType, PanelId> = { orbit: 'vpOrbit', chase: 'vpChase', fpv: 'vpFpv', top: 'vpTop' };

/**
 * A floating 3D camera: orbit (drag / wheel), top (north-up, pan / wheel), chase or FPV (they follow the drone).
 * The scene service renders the view into this canvas whenever the panel is visible.
 */
@Component({
  selector: 'app-viewport-panel',
  imports: [Panel],
  template: `
    <app-panel [id]="panelId()">
      <div class="keep fill"><canvas #cv data-capture [style.cursor]="scene.pin() ? 'crosshair' : null"></canvas></div>
    </app-panel>
  `,
  styles: `
    .fill {
      flex: 1;
      min-height: 0;
      position: relative;
    }
    canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
      touch-action: none;
      border-radius: 6px;
    }
  `,
})
export class ViewportPanel {
  readonly type = input.required<ViewportType>();
  protected readonly scene = inject(SceneService);
  private readonly cal = inject(CalibrationStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');
  protected readonly panelId = computed(() => PANEL_IDS[this.type()]);

  constructor() {
    afterNextRender(() => {
      const vp = this.scene.viewports[this.type()];
      const canvas = this.cv().nativeElement;
      this.scene.registerViewportCanvas(this.type(), canvas);
      const detach = attachOrbitControls(canvas, {
        view: () => vp.type,
        state: () => vp.state,
        calRot: () => this.cal.rot(),
        onClick: (x, y) => {
          if (this.scene.pin()) this.scene.placePin(x, y, vp.camera, canvas.getBoundingClientRect());
        },
      });
      this.destroyRef.onDestroy(() => {
        detach();
        this.scene.registerViewportCanvas(this.type(), null);
      });
    });
  }
}
