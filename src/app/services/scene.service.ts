import { Injectable, effect, inject, signal, untracked, type WritableSignal } from '@angular/core';
import * as THREE from 'three';
import type { CameraView } from '../core/models';
import { takeoffSpot } from '../core/takeoff';
import type { SiteModel } from '../three/site-model';
import { CalibrationStore } from '../state/calibration.store';
import { FlightStore } from '../state/flight.store';
import { LayoutStore } from '../state/layout.store';
import { ViewStore } from '../state/view.store';
import type { PanelId } from '../ui/panel-defs';
import { createOrbitState, fovFor, placeCamera, type FollowSubject, type OrbitState, type PlaceOptions } from '../three/camera-rig';
import type { RigContext } from '../three/drone-rig';
import { SceneHost } from '../three/scene-host';
import { XRay } from '../three/xray';
import { FlightService } from './flight.service';
import { FrameLoopService, FrameOrder } from './frame-loop.service';
import { PlaybackService } from './playback.service';
import { SimulatorService } from './simulator.service';
import { ToastService } from './toast.service';

export type ViewportType = 'orbit' | 'chase' | 'fpv' | 'top';

/** A floating camera panel: its own camera and orbit state, drawing into its own canvas. */
export interface Viewport {
  type: ViewportType;
  panel: PanelId;
  camera: THREE.PerspectiveCamera;
  state: OrbitState;
  canvas: HTMLCanvasElement | null;
}

const VIEWPORT_PANELS: Record<ViewportType, PanelId> = { orbit: 'vpOrbit', chase: 'vpChase', fpv: 'vpFpv', top: 'vpTop' };
const PANEL_MAX_PIXELS = 650_000;

/** A surface that can receive "pick the ground / a building" clicks while an editor tool is armed. */
export interface PickSurface {
  id: string;
  /** Called with client coordinates on a finished click (no drag). */
  onClick(clientX: number, clientY: number): void;
}

/**
 * The 3D world as the rest of the app sees it: creates the {@link SceneHost}, keeps it in step with the stores
 * (roof, model scale, paths, north), places the main camera and every floating view each frame, runs the x-ray and
 * renders. Other services and components never touch three.js directly.
 */
@Injectable({ providedIn: 'root' })
export class SceneService {
  private readonly view = inject(ViewStore);
  private readonly calibration = inject(CalibrationStore);
  private readonly layout = inject(LayoutStore);
  private readonly flightStore = inject(FlightStore);
  private readonly flights = inject(FlightService);
  private readonly playback = inject(PlaybackService);
  private readonly sim = inject(SimulatorService);
  private readonly toast = inject(ToastService);
  private readonly loop = inject(FrameLoopService);

  host: SceneHost | null = null;
  readonly ready = signal(false);
  readonly mainOrbit: OrbitState = createOrbitState();
  readonly viewports: Record<ViewportType, Viewport> = {
    orbit: this.makeViewport('orbit'),
    chase: this.makeViewport('chase'),
    fpv: this.makeViewport('fpv'),
    top: this.makeViewport('top'),
  };
  /** Armed ground pin: the next click on the ground moves the flight's start ('s') or end ('e') there. */
  readonly pin = signal<'s' | 'e' | null>(null);
  /**
   * Optional extra pick surface (the Map panel's model overlay). The stage registers itself here; when another
   * surface arms a pick mode it takes over the clicks, so a click inside the map panel selects / draws on the model
   * instead of editing through the full-page scene behind it.
   */
  readonly pickSurface: WritableSignal<PickSurface | null> = signal(null);
  private xray: XRay | null = null;
  private resizeHandler: (() => void) | null = null;
  private stopTasks: (() => void)[] = [];

  constructor() {
    effect(() => {
      if (!this.ready()) return;
      const k = this.calibration.modelScale();
      this.host?.site.setScale(k);
    });
    effect(() => {
      if (this.ready()) this.host?.site.setRoofHidden(this.view.roofHidden());
    });
    effect(() => {
      if (!this.ready()) return;
      const rot = this.calibration.rot();
      this.host?.setNorth(rot);
    });
    effect(() => {
      if (!this.ready()) return;
      this.flightStore.revision();
      untracked(() => this.host?.paths.rebuild(this.flights.all, this.flights.speedMax));
    });
    effect(() => {
      const v = this.view.cameraView();
      if (!this.ready() || !this.host) return;
      this.host.mainCamera.fov = fovFor(v);
      this.host.mainCamera.updateProjectionMatrix();
    });
    effect(() => {
      const on = this.view.xray();
      if (!this.xray) return;
      this.xray.enabled = on;
      if (!on) this.xray.reset();
    });
    effect(() => {
      const req = this.flights.frameRequest();
      if (!req) return;
      untracked(() => {
        this.mainOrbit.tg.set(req.center.x, req.center.y, req.center.z);
        this.mainOrbit.rad = req.radius;
        this.mainOrbit.ph = 1.0;
        this.view.setCameraView('orbit');
      });
    });
  }

  /** Create the renderer inside `container` and start rendering. Safe to call once per page. */
  attach(container: HTMLElement): void {
    if (this.host) return;
    const host = new SceneHost(container);
    this.host = host;
    // The canvas must fill its container: three.js' default style is "display:block" without width/height, so on
    // HiDPI screens it renders at device pixels and covers only a top-left part of the page — the rest stays black.
    Object.assign(host.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' } as CSSStyleDeclaration);
    this.xray = new XRay(host.site);
    this.xray.enabled = this.view.xray();
    this.sim.world = host.site.collider;
    host.resizeMain(innerWidth, innerHeight);
    this.resizeHandler = () => host.resizeMain(innerWidth, innerHeight);
    addEventListener('resize', this.resizeHandler);

    this.stopTasks = [
      this.loop.add(FrameOrder.camera, (dt) => this.updateCameras(dt)),
      this.loop.add(FrameOrder.xray, (dt) => this.updateXray(dt)),
      this.loop.add(FrameOrder.render, (dt) => this.renderAll(dt)),
    ];
    this.ready.set(true);
  }

  /**
   * Re-arm everything that holds a reference to the site object graph after {@link SceneHost.setSite} swapped it:
   * the x-ray fades the new meshes, the simulator collides with the new geometry, the parked drone moves to the
   * new take-off pad and the paths are rebuilt for the new scale.
   */
  rebindSite(site: SiteModel): void {
    if (this.xray) {
      this.xray.reset();
      this.xray.site = site;
      this.xray.enabled = this.view.xray();
    }
    this.sim.world = site.collider;
    const t = takeoffSpot();
    this.sim.reposition(t.x, t.z);
    untracked(() => this.host?.paths.rebuild(this.flights.all, this.flights.speedMax));
  }

  detach(): void {
    this.stopTasks.forEach((s) => s());
    this.stopTasks = [];
    if (this.resizeHandler) removeEventListener('resize', this.resizeHandler);
    this.xray?.reset();
    this.host?.dispose();
    this.host = null;
    this.xray = null;
    this.sim.world = null;
    this.ready.set(false);
  }

  /** True when chase / FPV / orbit-follow track the replayed drone instead of the simulator drone. */
  followingReplay(): boolean {
    return this.view.replayFollow() && !!this.flights.active && !this.sim.state.armed;
  }

  subject(): FollowSubject {
    return this.followingReplay() ? { p: this.playback.pose.p, q: this.playback.pose.q } : { p: this.sim.state.p, q: this.sim.state.q };
  }

  rigContext(): RigContext {
    return { followingReplay: this.followingReplay(), flight: this.flights.active, simPosition: this.sim.state.p, replayPosition: this.playback.pose.p };
  }

  private placeOptions(): PlaceOptions {
    const f = this.flights.active;
    return {
      orbitFollow: this.view.orbitFollow(),
      calRotDeg: this.calibration.rot(),
      // the sim drone and replays with attitude data use the camera tilt; GPS-only replays do not
      fpvTiltDeg: !this.followingReplay() || !!(f && (f.tel || f.att)) ? this.view.fpvTiltDeg() : 0,
    };
  }

  /** Back to the default overview and park the drone. */
  resetCamera(): void {
    this.sim.reset();
    this.mainOrbit.tg.set(-10, 2, 0);
    this.mainOrbit.th = -1.1;
    this.mainOrbit.ph = 1;
    this.mainOrbit.rad = this.view.orbitFollow() ? 110 : 330;
    this.view.setCameraView('orbit');
  }

  registerViewportCanvas(type: ViewportType, canvas: HTMLCanvasElement | null): void {
    this.viewports[type].canvas = canvas;
  }

  /**
   * Render an orthographic top-down overlay (no fog) for the Map panel into `canvas`. The map has its own camera:
   * the caller positions it.
   */
  renderOverlay(camera: THREE.OrthographicCamera, canvas: HTMLCanvasElement, cssW: number, cssH: number, maxPixels: number): void {
    const host = this.host;
    if (!host) return;
    const fog = host.scene.fog;
    host.scene.fog = null;
    try {
      host.renderToCanvas(camera, 'top', this.rigContext(), canvas, cssW, cssH, maxPixels);
    } finally {
      host.scene.fog = fog;
    }
  }

  // ---- ground pin ----
  armPin(which: 's' | 'e'): void {
    if (!this.flights.active) {
      this.toast.show('Load a log first');
      return;
    }
    if (this.pin() === which) {
      this.endPin();
      return;
    }
    this.pin.set(which);
    this.toast.show(`Click the ground where the flight ${which === 's' ? 'started' : 'ended'} — in any 3D view or panel. Esc cancels; your view is not changed.`);
  }
  endPin(): void {
    this.pin.set(null);
  }
  /** Move the active flight so its start / end lands where the user clicked on the ground. */
  placePin(clientX: number, clientY: number, camera: THREE.PerspectiveCamera, rect: { left: number; top: number; width: number; height: number }): void {
    const which = this.pin();
    const f = this.flights.active;
    if (!which || !f || !this.host) return;
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    const hit = this.host.groundPoint(camera, nx, ny);
    const anchor = which === 's' ? f.loc[0] : f.loc[f.loc.length - 1];
    if (hit && anchor) {
      this.calibration.shift(hit.x - anchor.x, hit.z - anchor.z);
      this.toast.show('Path placed. Use the compass to rotate it if needed.');
    }
    this.endPin();
  }

  // ---- per frame ----
  private updateCameras(dt: number): void {
    const host = this.host;
    if (!host) return;
    host.drones.syncSim(this.sim.state, dt);
    host.drones.syncGhost(this.playback.pose.p, this.playback.pose.q, this.flights.active);
    placeCamera(host.mainCamera, this.view.cameraView(), this.mainOrbit, this.subject(), this.placeOptions(), dt);
  }

  private updateXray(dt: number): void {
    const host = this.host;
    if (!host || !this.xray || !this.view.xray()) return;
    const view = this.view.cameraView();
    const targets: THREE.Vector3[] = [];
    if (view !== 'fpv') targets.push(new THREE.Vector3(this.sim.state.p.x, this.sim.state.p.y, this.sim.state.p.z));
    const f = this.flights.active;
    if (f && !(view === 'fpv' && this.followingReplay())) {
      const p = this.playback.pose.p;
      targets.push(new THREE.Vector3(p.x, p.y, p.z));
    }
    this.xray.step(dt, host.mainCamera, targets, this.calibration.modelScale());
  }

  /** Panels first, then the main page last (it stays in the shared canvas, which exports read from). */
  private renderAll(dt: number): void {
    const host = this.host;
    if (!host) return;
    const ctx = this.rigContext();
    const subject = this.subject();
    const opts = this.placeOptions();
    const panels = this.layout.panels();
    for (const vp of Object.values(this.viewports)) {
      const p = panels[vp.panel];
      if (!p.visible || p.minimized || !vp.canvas) continue;
      const w = vp.canvas.clientWidth;
      const h = vp.canvas.clientHeight;
      if (w < 16 || h < 16) continue;
      placeCamera(vp.camera, vp.type, vp.state, subject, opts, dt);
      host.renderToCanvas(vp.camera, vp.type, ctx, vp.canvas, w, h, PANEL_MAX_PIXELS);
    }
    if (this.view.mainSource() === '3d') {
      // The panels above drew into *corners* of the shared canvas and copied out; the full-page view must then be
      // redrawn at full size, or whatever was in the corner last frame stays stretched over the page (black screen).
      host.resizeMain(innerWidth, innerHeight);
      host.renderMain(this.view.cameraView(), ctx);
    }
  }

  private makeViewport(type: ViewportType): Viewport {
    const panel = VIEWPORT_PANELS[type];
    return { type, panel, camera: new THREE.PerspectiveCamera(fovFor(type), 1, 0.05, 1200), state: createOrbitState(type === 'top' ? 'top' : 'default'), canvas: null };
  }
}

/** The camera modes, in the order they are offered. */
export const CAMERA_VIEWS: readonly CameraView[] = ['orbit', 'chase', 'fpv', 'top'];
