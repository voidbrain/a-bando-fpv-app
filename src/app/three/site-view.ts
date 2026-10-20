import * as THREE from 'three';
import type { SiteSpec } from '../core/site-spec';
import { buildSiteFromSpec, type SiteModel } from './site-model';

/**
 * The whole bando in 3D inside the editor: the same model the main view builds, with a mouse-orbit camera.
 * Drag = orbit, right-drag / Shift-drag = pan, wheel = zoom. Rebuild with {@link show} whenever the spec changes.
 */
export class SiteViewRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.5, 6000);
  private model: SiteModel | null = null;
  private yaw = 0.6;
  private pitch = 0.75;
  private dist = 120;
  private readonly target = new THREE.Vector3();
  private drag: { x: number; y: number; pan: boolean } | null = null;
  private raf = 0;
  private framed = '';
  private readonly off: (() => void)[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(0x9fc3d8);
    this.renderer.shadowMap.enabled = true;
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4a5a40, 1.1));
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    sun.position.set(120, 220, 90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -200, right: 200, top: 200, bottom: -200, near: 10, far: 700 });
    this.scene.add(sun);
    const on = <K extends keyof HTMLElementEventMap>(t: K, f: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions): void => {
      canvas.addEventListener(t, f as EventListener, o);
      this.off.push(() => canvas.removeEventListener(t, f as EventListener));
    };
    on('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
      canvas.setPointerCapture(e.pointerId);
    });
    on('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (d.pan) {
        const k = this.dist * 0.0016;
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        this.target.addScaledVector(right, -dx * k).addScaledVector(fwd, dy * k);
      } else {
        this.yaw -= dx * 0.008;
        this.pitch = Math.min(1.5, Math.max(0.05, this.pitch + dy * 0.006));
      }
      this.drag = { ...d, x: e.clientX, y: e.clientY };
    });
    on('pointerup', () => (this.drag = null));
    on('pointercancel', () => (this.drag = null));
    on('contextmenu', (e) => e.preventDefault());
    on('wheel', (e) => {
      e.preventDefault();
      this.dist = Math.min(2500, Math.max(4, this.dist * (1 + e.deltaY * 0.001)));
    }, { passive: false });
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Rebuild from the spec. The camera re-frames only when `frameKey` changes (a different bando). */
  show(spec: SiteSpec, roofHidden: boolean, frameKey: string): void {
    if (this.model) {
      this.scene.remove(this.model.group);
      dispose(this.model.group);
    }
    this.model = buildSiteFromSpec(spec);
    this.model.setRoofHidden?.(roofHidden);
    this.scene.add(this.model.group);
    if (frameKey !== this.framed) {
      this.framed = frameKey;
      this.target.set(0, 0, 0);
      this.dist = Math.max(60, Math.min(900, spec.extent * 0.9));
    }
  }

  private readonly tick = (): void => {
    this.raf = requestAnimationFrame(this.tick);
    const c = this.canvas;
    if (!c.isConnected || c.clientWidth < 8 || c.clientHeight < 8 || document.hidden || !c.offsetParent) return;
    const w = c.clientWidth, h = c.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    const cp = Math.cos(this.pitch);
    this.camera.position.set(this.target.x + this.dist * cp * Math.sin(this.yaw), this.target.y + this.dist * Math.sin(this.pitch), this.target.z + this.dist * cp * Math.cos(this.yaw));
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    for (const f of this.off) f();
    if (this.model) dispose(this.model.group);
    this.renderer.dispose();
  }
}

function dispose(o: THREE.Object3D): void {
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((q) => q.dispose());
    else mat?.dispose();
  });
}
