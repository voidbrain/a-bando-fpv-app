import * as THREE from 'three';
import { DroneRig, type RigContext } from './drone-rig';
import { PathRenderer } from './path-renderer';
import { buildSiteFromSpec, builtinSpec, type SiteModel } from './site-model';
import type { SiteSpec } from '../core/site-spec';
import type { CameraView } from '../core/models';

const SKY = '#b8d0c5';

/** A text sprite (dark plate, light text) that always faces the camera. */
function makeLabel(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = 'rgba(20,34,28,.78)';
    g.fillRect(2, 2, 508, 92);
    g.fillStyle = '#eff7e8';
    g.font = 'bold 34px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 48);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.scale.set(18, 3.4, 1);
  return s;
}

/** Result of {@link fitResolution}. */
export interface FitResolution {
  /** Viewport size in CSS pixels (what the renderer is asked to draw). */
  vw: number;
  vh: number;
  /** Pixel size of the area to copy out of the renderer's canvas. */
  w: number;
  h: number;
}

/** Render big panels at a capped pixel count (keeps several live views affordable). */
export function fitResolution(w: number, h: number, maxPixels: number, pixelRatio: number, domWidth: number, domHeight: number): FitResolution {
  const rs = Math.min(pixelRatio, Math.sqrt(maxPixels / (w * h)));
  const vw = (w * rs) / pixelRatio;
  const vh = (h * rs) / pixelRatio;
  return { vw, vh, w: Math.min(Math.max(1, Math.floor(vw * pixelRatio)), domWidth), h: Math.min(Math.max(1, Math.floor(vh * pixelRatio)), domHeight) };
}

/**
 * Owns the WebGL renderer, the scene and everything in it (site model, drones, paths, lights). It renders any camera
 * into the shared canvas; the services copy that canvas into whichever panel asked for the view.
 */
export class SceneHost {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  /** The active site model. Replaced (rebuilt from a new {@link SiteSpec}) by {@link setSite}. */
  site!: SiteModel;
  readonly drones: DroneRig;
  readonly paths: PathRenderer;
  readonly mainCamera = new THREE.PerspectiveCamera(60, 1, 0.05, 1200);
  private readonly northArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-130, 0.4, 40), 20, 0xff3b30, 5, 3);
  private readonly northLabel = makeLabel('N');
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly raycaster = new THREE.Raycaster();

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 420, 1100);
    // three.js >= r155 uses physical light units: x PI keeps the look of the original (r128) intensities.
    this.scene.add(new THREE.HemisphereLight('#e6f5eb', '#5c6b4e', 0.95 * Math.PI));
    const sun = new THREE.DirectionalLight('#fff0d4', 0.95 * Math.PI);
    sun.position.set(-120, 220, 110);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -240, right: 240, top: 240, bottom: -240, far: 700 });
    this.scene.add(sun);

    this.site = buildSiteFromSpec(builtinSpec());
    this.scene.add(this.site.group);
    this.drones = new DroneRig(this.scene);
    this.paths = new PathRenderer(this.scene);
    this.northLabel.scale.set(7, 1.3, 1);
    this.scene.add(this.northArrow, this.northLabel);
  }

  /**
   * Swap the site for one built from `spec` (generated from a location, loaded from the library, or edited).
   * Everything that referenced the old model (x-ray, simulator collider) is re-armed by the caller.
   */
  setSite(spec: SiteSpec): SiteModel {
    this.scene.remove(this.site.group);
    this.site.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.site = buildSiteFromSpec(spec);
    this.scene.add(this.site.group);
    return this.site;
  }

  /** Point the north arrow (a landmark on the west apron) at true north for a model rotated by `rotDeg`. */
  setNorth(rotDeg: number): void {
    const a = (rotDeg * Math.PI) / 180;
    const d = new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
    this.northArrow.setDirection(d);
    this.northLabel.position.set(-130 + d.x * 24, 2, 40 + d.z * 24);
  }

  /** Where a click at (nx, ny) in normalised device coordinates (-1..1) lands on the ground plane, or null. */
  groundPoint(camera: THREE.Camera, nx: number, ny: number): { x: number; z: number } | null {
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const hit = this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3());
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Size the main (full page) view. */
  resizeMain(width: number, height: number): void {
    this.renderer.setSize(width, height);
    this.mainCamera.aspect = width / Math.max(1, height);
    this.mainCamera.updateProjectionMatrix();
  }

  /** Render the main page view. */
  renderMain(view: CameraView, ctx: RigContext): void {
    this.renderer.shadowMap.needsUpdate = true;
    const size = this.renderer.getSize(new THREE.Vector2());
    this.renderer.setViewport(0, 0, size.x, size.y);
    this.drones.prepare(this.mainCamera, view, ctx);
    this.renderer.render(this.scene, this.mainCamera);
  }

  /**
   * Render `camera` into the corner of the shared canvas and copy it into `target`. Used for floating view panels,
   * the map overlay and exports. `cssW` x `cssH` is the panel size, capped at `maxPixels` physical pixels.
   */
  renderToCanvas(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, view: CameraView | null, ctx: RigContext, target: HTMLCanvasElement, cssW: number, cssH: number, maxPixels = 650000): void {
    const dom = this.renderer.domElement;
    const fit = fitResolution(cssW, cssH, maxPixels, this.renderer.getPixelRatio(), dom.width, dom.height);
    if (target.width !== fit.w || target.height !== fit.h) {
      target.width = fit.w;
      target.height = fit.h;
    }
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = cssW / cssH;
      camera.updateProjectionMatrix();
    }
    if (view) this.drones.prepare(camera, view, ctx);
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.setViewport(0, 0, fit.vw, fit.vh);
    this.renderer.render(this.scene, camera);
    target.getContext('2d')?.drawImage(dom, 0, dom.height - fit.h, fit.w, fit.h, 0, 0, fit.w, fit.h);
  }

  dispose(): void {
    this.paths.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
