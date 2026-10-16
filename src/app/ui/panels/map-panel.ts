import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import * as THREE from 'three';
import { FrameLoopService, FrameOrder } from '../../services/frame-loop.service';
import { MapService } from '../../services/map.service';
import { SceneService } from '../../services/scene.service';
import { ToastService } from '../../services/toast.service';
import { CalibrationStore } from '../../state/calibration.store';
import { LayoutStore } from '../../state/layout.store';
import { MapStore, OSM_URL, parseGoogleEmbed, type MapBackground } from '../../state/map.store';
import { checkedFrom, numberFrom, selectedFrom } from '../dom';
import { Panel } from '../panel/panel';

const NOTES: Record<'img' | 'live' | 'none', string> = {
  img: 'Map = a satellite screenshot. Overlay scale = metres per map pixel: tick “align” and drag / wheel / Shift+wheel until the buildings line up. New screenshot: paste it with Ctrl+V, drop it on the page, or Load map.',
  live: 'Live map: pan/zoom it with “align” off, then tick “align” to move (drag), scale (wheel) and rotate (shift+wheel) the 3D overlay. Needs the page to be served over http(s); some hosts block embedded sites.',
  none: '3D model only (north up).',
};
const OVERLAY_MAX_PIXELS = 800_000;

@Component({
  selector: 'app-map-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Panel],
  template: `
    <app-panel id="map">
      <div class="row">
        <select (change)="map.setBackground(bg($event))">
          <option value="img" [selected]="map.background() === 'img'">Satellite image</option>
          <option value="goog" [selected]="map.background() === 'goog'">Google live</option>
          <option value="osm" [selected]="map.background() === 'osm'">OpenStreetMap (no key)</option>
          <option value="none" [selected]="map.background() === 'none'">3D only</option>
        </select>
        <label>3D opacity <input type="range" min="0" max="100" [value]="map.overlayOpacity() * 100" (input)="map.setOverlayOpacity(num($event) / 100)" /></label>
        <label class="check"><input type="checkbox" [checked]="map.align()" (change)="map.setAlign(checked($event))" /> align</label>
        <label class="btn">Load map<input type="file" accept="image/*" hidden (change)="loadFile($event)" /></label>
      </div>
      <div class="row">
        <label>scale m/px <input type="number" step="0.005" [value]="scale()" (change)="map.setScale(num($event))" /></label>
        <label>rot° <input type="number" step="0.5" [value]="map.rotation()" (change)="map.setRotation(num($event))" /></label>
        <label>dx <input type="number" step="1" [value]="map.dx().toFixed(1)" (change)="map.setOffset(num($event), map.dz())" /></label>
        <label>dz <input type="number" step="1" [value]="map.dz().toFixed(1)" (change)="map.setOffset(map.dx(), num($event))" /></label>
        <button class="btn" (click)="map.resetAlignment()">Reset</button>
        <a class="dim small" target="_blank" rel="noopener" href="https://www.google.com/maps/@45.528698,12.133305,18z/data=!3m1!1e3">Open in Google Maps ↗</a>
      </div>
      @if (map.background() === 'goog') {
        <div class="row">
          <input type="text" class="grow" placeholder="Optional: paste a Google Maps embed URL (Share → Embed a map) or the iframe code" #url />
          <button class="btn" (click)="loadGoogle(url.value)">Load</button>
        </div>
      }
      <div class="keep stage" #stage>
        @if (map.background() === 'img') {
          <img [src]="mapImage().url" alt="satellite map" />
        }
        @if (live()) {
          <iframe title="Live map" referrerpolicy="no-referrer" allowfullscreen [src]="frameUrl()"></iframe>
        }
        <canvas
          #overlay
          [style.opacity]="map.background() === 'none' ? 1 : map.overlayOpacity()"
          [style.pointerEvents]="map.align() ? 'auto' : 'none'"
          [style.cursor]="map.align() ? 'move' : 'default'"
        ></canvas>
      </div>
      <div class="dim small note">{{ note() }}</div>
    </app-panel>
  `,
  styles: `
    .stage {
      position: relative;
      flex: 1;
      min-height: 120px;
      overflow: hidden;
      background: #0a0f0c;
      border-radius: 6px;
      touch-action: none;
    }
    .stage > * {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }
    img {
      object-fit: contain;
    }
    iframe {
      border: 0;
    }
    .note {
      margin-top: 4px;
    }
  `,
})
export class MapPanel {
  protected readonly map = inject(MapStore);
  protected readonly mapService = inject(MapService);
  private readonly scene = inject(SceneService);
  private readonly cal = inject(CalibrationStore);
  private readonly layout = inject(LayoutStore);
  private readonly toast = inject(ToastService);
  private readonly loop = inject(FrameLoopService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  private readonly overlay = viewChild.required<ElementRef<HTMLCanvasElement>>('overlay');
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  protected readonly mapImage = this.mapService.image;
  protected readonly live = computed(() => this.map.background() === 'goog' || this.map.background() === 'osm');
  protected readonly frameUrl = computed<SafeResourceUrl>(() => this.sanitizer.bypassSecurityTrustResourceUrl(this.map.background() === 'goog' ? this.map.googleUrl() : OSM_URL));
  protected readonly note = signal(NOTES.img);
  protected readonly bg = (e: Event): MapBackground => selectedFrom(e) as MapBackground;
  protected readonly num = numberFrom;
  protected readonly checked = checkedFrom;

  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 800);
  /** Last render parameters: metres per CSS pixel and the angle of screen-up, for the align drag. */
  private metresPerPixel = 0.1;
  private up = 0;
  private dirty = true;
  private frame = 0;

  constructor() {
    effect(() => {
      this.map.background();
      this.map.scale();
      this.map.rotation();
      this.map.dx();
      this.map.dz();
      this.cal.rot();
      this.cal.modelScale();
      this.mapImage();
      this.dirty = true;
    });
    effect(() => {
      const b = this.map.background();
      this.note.set(b === 'goog' || b === 'osm' ? NOTES.live : b === 'img' ? NOTES.img : NOTES.none);
    });
    const stop = this.loop.add(FrameOrder.render + 1, () => this.render());
    this.destroyRef.onDestroy(stop);
    const onViolation = (e: SecurityPolicyViolationEvent): void => {
      if (/frame-src/.test(e.violatedDirective) && this.live()) this.note.set(`This host blocks embedded sites (${e.violatedDirective}). Serve the app over http(s) for live maps; the satellite image works everywhere.`);
    };
    document.addEventListener('securitypolicyviolation', onViolation);
    this.destroyRef.onDestroy(() => document.removeEventListener('securitypolicyviolation', onViolation));
    afterNextRender(() => this.bindPointer());
  }

  protected scale(): number {
    return this.map.scale()[this.map.background()];
  }

  protected loadFile(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.mapService.loadFile(input.files?.[0]);
    input.value = '';
  }

  protected loadGoogle(value: string): void {
    const url = parseGoogleEmbed(value);
    if (!url) {
      this.toast.show('Paste the embed URL from Google Maps → Share → Embed a map');
      return;
    }
    this.map.setGoogleUrl(url);
    this.map.setBackground('goog');
  }

  /** Aim the orthographic camera at the model so it lines up with whatever is behind it, then render into the overlay. */
  private render(): void {
    const p = this.layout.panels()['map'];
    if (!p.visible || p.minimized || !this.scene.host) return;
    const st = this.stage().nativeElement;
    const w = st.clientWidth, h = st.clientHeight;
    if (w < 40 || h < 40) return;
    if (!this.dirty && this.frame++ % 3 !== 0) return;
    this.dirty = false;
    const A = (this.cal.rot() * Math.PI) / 180;
    const k = this.cal.modelScale();
    const img = this.mapImage();
    const bg = this.map.background();
    let mpp: number, cx: number, cz: number, up: number;
    if (bg === 'img') {
      const fit = Math.min(w / img.width, h / img.height);
      const builtin = img.base === 'builtin';
      mpp = (this.map.scale().img * (builtin ? k : 1)) / fit;
      cx = img.centreX * (builtin ? k : 1) + this.map.dx();
      cz = img.centreZ * (builtin ? k : 1) + this.map.dz();
      up = (builtin ? (this.mapService.builtinUpDeg * Math.PI) / 180 : A) + (this.map.rotation() * Math.PI) / 180;
    } else {
      mpp = this.map.scale()[bg];
      cx = this.map.dx();
      cz = this.map.dz();
      up = A + (this.map.rotation() * Math.PI) / 180;
    }
    this.metresPerPixel = mpp;
    this.up = up;
    const cam = this.camera;
    cam.left = (-w * mpp) / 2;
    cam.right = (w * mpp) / 2;
    cam.top = (h * mpp) / 2;
    cam.bottom = (-h * mpp) / 2;
    cam.updateProjectionMatrix();
    cam.up.set(Math.sin(up), 0, -Math.cos(up));
    cam.position.set(cx, 300, cz);
    cam.lookAt(cx, 0, cz);
    this.scene.renderOverlay(cam, this.overlay().nativeElement, w, h, OVERLAY_MAX_PIXELS);
  }

  /** Align mode: drag moves the overlay, wheel scales it, shift+wheel rotates it. */
  private bindPointer(): void {
    const cv = this.overlay().nativeElement;
    let drag: { x: number; y: number } | null = null;
    cv.addEventListener('pointerdown', (e) => {
      if (!this.map.align()) return;
      drag = { x: e.clientX, y: e.clientY };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointerup', () => (drag = null));
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY };
      const u = this.up, m = this.metresPerPixel;
      const right = [Math.cos(u), Math.sin(u)] as const;
      const upv = [Math.sin(u), -Math.cos(u)] as const;
      this.map.nudge(-dx * m * right[0] + dy * m * upv[0], -dx * m * right[1] + dy * m * upv[1]);
    });
    cv.addEventListener(
      'wheel',
      (e) => {
        if (!this.map.align()) return;
        e.preventDefault();
        if (e.shiftKey) this.map.setRotation(this.map.rotation() + (e.deltaY > 0 ? 1 : -1));
        else this.map.scaleBy(1 + e.deltaY * 0.001);
      },
      { passive: false },
    );
  }
}
