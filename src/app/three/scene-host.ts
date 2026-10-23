import * as THREE from 'three';
import { DroneRig, type RigContext } from './drone-rig';
import { PathRenderer } from './path-renderer';
import { buildSiteFromSpec, type SiteModel } from './site-model';
import { rayGround } from '../core/terrain';
import type { SiteSpec } from '../core/site-spec';
import { emptySpec } from '../core/site-spec';
import type { CameraView } from '../core/models';

const SKY = '#b8d0c5';

/** A spec with nothing built yet (the empty bando a first visit opens on). */
export function isVoidSpec(spec: SiteSpec): boolean {
  return !spec.buildings.length && !spec.trees.length && !spec.structures?.length && !spec.terrain && !spec.walls?.length;
}

/** The floor of the empty world: a fine and a coarse grid fading into the fog. */
function voidFloor(): THREE.Group {
  const g = new THREE.Group();
  const fine = new THREE.GridHelper(2400, 240, '#7fa58f', '#7fa58f');
  const coarse = new THREE.GridHelper(2400, 24, '#2f6b4a', '#2f6b4a');
  for (const [h, op] of [[fine, 0.35], [coarse, 0.7]] as const) {
    const m = h.material as THREE.LineBasicMaterial;
    m.transparent = true;
    m.opacity = op;
    h.position.y = 0.02;
    g.add(h);
  }
  return g;
}

/** The badge at the tip of the north arrow: a round "N" (a sprite, so it always faces the camera). */
function makeNorthBadge(): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    g.beginPath();
    g.arc(64, 64, 58, 0, Math.PI * 2);
    g.fillStyle = 'rgba(20,34,28,.85)';
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = '#ff3b30';
    g.stroke();
    g.fillStyle = '#eff7e8';
    g.font = 'bold 72px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', 64, 68);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.scale.set(5, 5, 1);
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
  private readonly northLabel = makeNorthBadge();
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

    this.site = buildSiteFromSpec(emptySpec());
    this.scene.add(this.site.group);
    this.drones = new DroneRig(this.scene);
    this.paths = new PathRenderer(this.scene);
    this.scene.add(this.northArrow, this.northLabel, this.voidGrid);
    this.setVoid(true);
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
    this.site = buildSiteFromSpec(spec, { merge: true });
    this.scene.add(this.site.group);
    this.setVoid(isVoidSpec(spec));
    return this.site;
  }

  /** No bando yet: a wireframe floor to the horizon instead of a meadow, no north arrow. */
  private readonly voidGrid = voidFloor();
  private setVoid(on: boolean): void {
    this.voidGrid.visible = on;
    this.site.group.visible = !on;
    this.northArrow.visible = this.northLabel.visible = !on;
  }

  /** Point the north arrow (a landmark on the west apron) at true north for a model rotated by `rotDeg`. */
  setNorth(rotDeg: number): void {
    const a = (rotDeg * Math.PI) / 180;
    const d = new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
    this.northArrow.setDirection(d);
    this.northLabel.position.set(-130 + d.x * 24, 3, 40 + d.z * 24);
  }

  /** Where a click at (nx, ny) in normalised device coordinates (-1..1) lands on the ground plane, or null. */
  groundPoint(camera: THREE.Camera, nx: number, ny: number): { x: number; z: number } | null {
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
    const grid = this.site.ground.grid;
    if (grid) {
      // the terrain is built unscaled: march the ray in model metres, answer in world metres
      const k = this.site.collider.scale || 1, o = this.raycaster.ray.origin, d = this.raycaster.ray.direction;
      const p = rayGround(grid, { x: o.x / k, y: o.y / k, z: o.z / k }, d);
      return p ? { x: p.x * k, z: p.z * k } : null;
    }
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
