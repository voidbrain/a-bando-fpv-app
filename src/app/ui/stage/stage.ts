import { Component, DestroyRef, ElementRef, afterNextRender, effect, inject, viewChild } from '@angular/core';
import { attachOrbitControls } from '../../three/orbit-controls';
import { FlightService } from '../../services/flight.service';
import { SceneService } from '../../services/scene.service';
import { SimulatorService } from '../../services/simulator.service';
import { SiteService } from '../../services/site.service';
import { VideoService } from '../../services/video.service';
import { CalibrationStore } from '../../state/calibration.store';
import { ViewStore } from '../../state/view.store';

/**
 * The full-page background: the WebGL canvas (3D model) or the flight video, the FPV overlay. Also the
 * page-wide drop target for flight logs.
 */
@Component({
  selector: 'app-stage',
  template: `
    <div #gl class="gl" [hidden]="view.mainSource() !== '3d'" [style.cursor]="scene.pin() ? 'crosshair' : null"></div>
    <div #videoSlot class="vmain" [hidden]="view.mainSource() !== 'video'">
      @if (!video.loaded()) {
        <div class="dim">Main page: video — open the Video panel and load a file</div>
      }
    </div>
    @if (view.mainSource() === '3d' && view.cameraView() === 'fpv') {
      <div class="osd">{{ osd() }}</div>
      <div class="ret"></div>
    }
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      display: block;
    }
    .gl {
      position: fixed;
      inset: 0;
      touch-action: none;
    }
  `,
})
export class Stage {
  protected readonly view = inject(ViewStore);
  protected readonly scene = inject(SceneService);
  protected readonly video = inject(VideoService);
  private readonly sim = inject(SimulatorService);
  private readonly flights = inject(FlightService);
  private readonly cal = inject(CalibrationStore);
  private readonly site = inject(SiteService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly gl = viewChild.required<ElementRef<HTMLElement>>('gl');
  private readonly videoSlot = viewChild<ElementRef<HTMLElement>>('videoSlot');

  constructor() {
    afterNextRender(() => {
      const host = this.gl().nativeElement;
      this.scene.attach(host);
      const detach = attachOrbitControls(host, {
        view: () => this.view.cameraView(),
        state: () => this.scene.mainOrbit,
        calRot: () => this.cal.rot(),
        onInput: () => {
          this.scene.autoOrbit.set(false);
          this.scene.noteInput();
        },
        takeOver: () => this.scene.lookAround(),
        onClick: (x, y, alt) => {
          const cam = this.scene.host?.mainCamera;
          if (!cam) return;
          // while the map panel's editor tools are armed, its surface owns the picking — never edit through the page
          if (this.scene.pickSurface()) return;
          if (this.scene.pin()) this.scene.placePin(x, y, cam, { left: 0, top: 0, width: innerWidth, height: innerHeight });
          else if (alt) void this.site.altClick(x, y);
        },
      });
      const onDragOver = (e: DragEvent): void => e.preventDefault();
      const onDrop = (e: DragEvent): void => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer?.files ?? []);
        void this.flights.loadFiles(files.filter((f) => !f.type.startsWith('image/')));
      };
      addEventListener('dragover', onDragOver);
      addEventListener('drop', onDrop);
      this.destroyRef.onDestroy(() => {
        detach();
        removeEventListener('dragover', onDragOver);
        removeEventListener('drop', onDrop);
        this.scene.detach();
      });
    });

    // The one <video> element lives on the main page when it is selected as the main source.
    effect(() => {
      if (this.view.mainSource() !== 'video') return;
      const el = this.video.element;
      const slot = this.videoSlot()?.nativeElement;
      if (!slot) return;
      if (el.parentElement !== slot) slot.appendChild(el);
      el.classList.add('vbig');
    });
  }

  protected osd(): string {
    const h = this.sim.hud();
    const s = this.sim;
    return `${h.speedKmh} km/h · ${h.altitude.toFixed(1)} m · ${s.mode().toUpperCase()} · ${s.armed() ? '● ' + h.status : 'DISARMED — ENTER'}`;
  }
}
