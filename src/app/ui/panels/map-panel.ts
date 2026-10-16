import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import * as THREE from 'three';
import { FrameLoopService, FrameOrder } from '../../services/frame-loop.service';
import { FlightService } from '../../services/flight.service';
import { SceneService } from '../../services/scene.service';
import { SiteService } from '../../services/site.service';
import { ToastService } from '../../services/toast.service';
import { CalibrationStore } from '../../state/calibration.store';
import { LayoutStore } from '../../state/layout.store';
import { MapStore, type MapBackground } from '../../state/map.store';
import { siteOrigin } from '../../core/constants';
import { toLocal } from '../../core/geo';
import { checkedFrom, numberFrom, selectedFrom } from '../dom';
import { Panel } from '../panel/panel';

const NOTES: Record<'live' | 'none', string> = {
  live: 'Live OpenStreetMap of the active site. Tick “align” and drag (move), wheel (scale) or Shift+wheel (rotate) until the 3D model lines up with the map — then use “Point north” / “Set north from map” in the Sites panel to bake the rotation into the model. Needs the page served over http(s); some hosts block embedded sites.',
  none: '3D model only (north up).',
};
const OVERLAY_MAX_PIXELS = 800_000;

/**
 * The Map panel: the live OpenStreetMap backdrop of the *active* site with the 3D model rendered on top of it.
 * This is also where GPS alignment happens (the old standalone Alignment panel was folded in here): the align mode
 * moves / scales / rotates the overlay, the shift X/Z + rot° fields and ↺90 / ↻90 / 180 buttons nudge the same
 * calibration the logged flights are projected through, and "Calibrate from corners" solves everything at once from
 * two real landmarks matching the model's calibration corners.
 */
@Component({
  selector: 'app-map-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Panel, FormsModule],
  template: `
    <app-panel id="map">
      <div class="row">
        <select (change)="setBackground(bg($event))">
          <option value="osm" [selected]="map.background() === 'osm'">OpenStreetMap</option>
          <option value="none" [selected]="map.background() === 'none'">3D only</option>
        </select>
        <label>3D opacity <input type="range" min="0" max="100" [value]="map.overlayOpacity() * 100" (input)="map.setOverlayOpacity(num($event) / 100)" /></label>
        <label class="check"><input type="checkbox" [checked]="map.align()" (change)="map.setAlign(checked($event))" /> align</label>
        <span class="dim small mono" title="The live map follows the active site's location">{{ originLabel() }}</span>
      </div>
      <div class="row">
        <label>scale m/px <input type="number" step="0.005" [value]="scale()" (change)="map.setScale(num($event))" /></label>
        <label>rot° <input type="number" step="0.5" [value]="map.rotation()" (change)="map.setRotation(num($event))" /></label>
        <label>dx <input type="number" step="1" [value]="map.dx().toFixed(1)" (change)="map.setOffset(num($event), map.dz())" /></label>
        <label>dz <input type="number" step="1" [value]="map.dz().toFixed(1)" (change)="map.setOffset(map.dx(), num($event))" /></label>
        <button class="btn" (click)="map.resetAlignment()">Reset</button>
      </div>

      <!-- GPS alignment (from the old Alignment panel): the calibration the logged flights are projected through -->
      <h4>GPS alignment</h4>
      <div class="row">
        <label>shift X <input type="number" step="1" [value]="cal.dx().toFixed(1)" (change)="setRotPivot(num($event), cal.dz(), cal.rot())" /></label>
        <label>Z <input type="number" step="1" [value]="cal.dz().toFixed(1)" (change)="setRotPivot(cal.dx(), num($event), cal.rot())" /></label>
        <label>rot° <input type="number" step="0.5" [value]="cal.rot().toFixed(1)" (change)="setRotation(num($event))" /></label>
      </div>
      <div class="row">
        <button class="btn" (click)="rotateBy(-90)">↺ 90°</button>
        <button class="btn" (click)="rotateBy(90)">↻ 90°</button>
        <button class="btn" (click)="rotateBy(180)">180°</button>
        <button class="btn" [class.on]="scene.pin() === 's'" (click)="scene.armPin('s')" title="Click the ground where the flight started">Pin start</button>
        <button class="btn" [class.on]="scene.pin() === 'e'" (click)="scene.armPin('e')" title="Click the ground where the flight ended">Pin end</button>
      </div>
      <div class="row">
        <label>corner A lat,lon <input type="text" class="grow" [(ngModel)]="cornerA" placeholder="45.5287, 12.1333" /></label>
        <label>corner B lat,lon <input type="text" class="grow" [(ngModel)]="cornerB" placeholder="45.5279, 12.1346" /></label>
        <button class="btn primary" (click)="calibrateFromCorners()">Calibrate</button>
      </div>
      <div class="dim small">
        Corner A / B are two real points that match the model’s calibration corners (its opposite ends — see the Sites panel). Calibrate solves rotation +
        shift in one shot. “Shift model size by ratio” scales the buildings so the model matches the real distance between the two corners.
      </div>
      <div class="row">
        <button class="btn" (click)="applyRatio()">Shift model size by ratio</button>
        <span class="dim small mono">{{ ratioHint() }}</span>
      </div>

      <div class="keep stage" #stage>
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
    iframe {
      border: 0;
    }
    h4 {
      margin: 8px 0 2px;
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--dim);
    }
    .note {
      margin-top: 4px;
    }
  `,
})
export class MapPanel {
  protected readonly map = inject(MapStore);
  protected readonly cal = inject(CalibrationStore);
  protected readonly scene = inject(SceneService);
  private readonly flights = inject(FlightService);
  private readonly site = inject(SiteService);
  private readonly layout = inject(LayoutStore);
  private readonly toast = inject(ToastService);
  private readonly loop = inject(FrameLoopService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  private readonly overlay = viewChild.required<ElementRef<HTMLCanvasElement>>('overlay');
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  protected readonly live = computed(() => this.map.background() === 'osm');
  protected readonly frameUrl = computed<SafeResourceUrl>(() => this.sanitizer.bypassSecurityTrustResourceUrl(this.map.osmUrl()));
  protected readonly note = signal(NOTES.live);
  /** Two free-text corner fields (lat,lon) for the one-shot calibration — pre-filled from the active spec. */
  protected cornerA = '';
  protected cornerB = '';
  /** The last solved model/real distance ratio, applied by "Shift model size by ratio". */
  private lastRatio: number | null = null;

  /** The live OSM backdrop follows the *active* site, so show where it points. */
  protected readonly originLabel = computed(() => {
    const o = siteOrigin();
    return `${o.lat.toFixed(5)}, ${o.lon.toFixed(5)}`;
  });
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
    // pre-fill the corner fields whenever the active site changes (they are its calibration landmarks)
    effect(() => {
      const s = this.site.active();
      const c = s.calibCorners;
      this.cornerA = `${c.p1.x.toFixed(1)}, ${c.p1.z.toFixed(1)}`;
      this.cornerB = `${c.p2.x.toFixed(1)}, ${c.p2.z.toFixed(1)}`;
      // if the spec carries the real coordinates of those corners, use them directly
      if (s.geoCorners) {
        this.cornerA = `${s.geoCorners.p1.lat}, ${s.geoCorners.p1.lon}`;
        this.cornerB = `${s.geoCorners.p2.lat}, ${s.geoCorners.p2.lon}`;
      }
      this.lastRatio = null;
    });
    effect(() => {
      this.map.background();
      this.map.scale();
      this.map.rotation();
      this.map.dx();
      this.map.dz();
      this.cal.rot();
      this.cal.modelScale();
      this.dirty = true;
    });
    effect(() => {
      this.note.set(this.map.background() === 'osm' ? NOTES.live : NOTES.none);
    });
    const stop = this.loop.add(FrameOrder.render + 1, () => this.render());
    this.destroyRef.onDestroy(stop);
    const onViolation = (e: SecurityPolicyViolationEvent): void => {
      if (/frame-src/.test(e.violatedDirective) && this.live()) this.note.set(`This host blocks embedded sites (${e.violatedDirective}). Serve the app over http(s) for the live map.`);
    };
    document.addEventListener('securitypolicyviolation', onViolation);
    this.destroyRef.onDestroy(() => document.removeEventListener('securitypolicyviolation', onViolation));
    afterNextRender(() => this.bindPointer());
  }

  protected scale(): number {
    return this.map.scale()[this.map.background()];
  }

  protected setBackground(b: MapBackground): void {
    this.map.setBackground(b === 'none' ? 'none' : 'osm');
  }

  // ---- GPS alignment (integrated from the old Alignment panel) ----

  /** Set the rotation, pivoting the active flight about its own midpoint so it does not swing away. */
  protected setRotation(deg: number): void {
    const rot = (((deg + 540) % 360) + 360) % 360 - 180;
    const mid = this.flights.active?.pts[(this.flights.active.pts.length / 2) | 0];
    const before = mid ? toLocal(mid.lat, mid.lon, this.cal.calibration()) : null;
    this.cal.setRot(rot);
    if (mid && before) {
      const after = toLocal(mid.lat, mid.lon, this.cal.calibration());
      this.cal.shift(before[0] - after[0], before[1] - after[1]);
    }
  }

  protected setRotPivot(dx: number, dz: number, rot: number): void {
    this.cal.setDx(dx);
    this.cal.setDz(dz);
    if (rot !== this.cal.rot()) this.setRotation(rot);
  }

  protected rotateBy(deg: number): void {
    this.setRotation(this.cal.rot() + deg);
  }

  /** Solve rotation + shift from two real corners matched to the active spec's model corners. */
  protected calibrateFromCorners(): void {
    const a = parseLatLngText(this.cornerA);
    const b = parseLatLngText(this.cornerB);
    if (!a || !b) {
      this.toast.show('Enter both corners as “lat, lon” in decimal degrees');
      return;
    }
    if (!this.site.calibrateFromCorners(a, b)) return;
    const r = this.site.lastCalibrationRatio();
    this.lastRatio = r;
    this.toast.show(`Calibrated: rotation ${this.cal.rot().toFixed(2)}°, shift ${this.cal.dx().toFixed(1)} / ${this.cal.dz().toFixed(1)} m${r ? ` · model/real distance ${r.toFixed(3)} — press “Shift model size by ratio” to resize the model` : ''}`);
  }

  /** Resize the model so it matches the real distance between the calibrated corners. */
  protected applyRatio(): void {
    if (!this.lastRatio || !isFinite(this.lastRatio) || Math.abs(this.lastRatio - 1) < 0.002) {
      this.toast.show('Calibrate from two corners first');
      return;
    }
    this.cal.setModelScale(this.cal.modelScale() / this.lastRatio);
    this.toast.show(`Model scaled × ${(1 / this.lastRatio).toFixed(3)}.`);
  }

  protected ratioHint(): string {
    return this.lastRatio ? `ratio ${this.lastRatio.toFixed(3)}` : '—';
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
    const bg = this.map.background();
    const mpp = this.map.scale()[bg];
    const cx = this.map.dx();
    const cz = this.map.dz();
    const up = A + (this.map.rotation() * Math.PI) / 180;
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

/** "45.52, 12.13" -> {lat, lon}; anything else -> null. */
function parseLatLngText(text: string): { lat: number; lon: number } | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text ?? '');
  if (!m) return null;
  const lat = +m[1]!, lon = +m[2]!;
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}
