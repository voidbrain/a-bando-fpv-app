import * as THREE from 'three';
import type { Flight } from '../core/models';
import { emptySpec, type SiteSpec } from '../core/site-spec';
import { ghost, levelOnly } from './element-preview';
import { PathRenderer } from './path-renderer';
import { buildSiteFromSpec, type GroundStyle, type SiteModel } from './site-model';
import { rayGround } from '../core/terrain';

/** What a click on the 3D model selects. */
export type SitePick = { kind: 'building'; id: string } | { kind: 'column'; id: string; li: number; i: number } | { kind: 'wall'; id: string; li: number; i: number } | { kind: 'structure'; id: string } | { kind: 'fence'; i: number } | { kind: 'tree'; i: number };

/**
 * The whole bando in 3D inside the editor: the same model the main view builds, with a mouse-orbit camera.
 * Drag = orbit, right-drag / Shift-drag = pan, wheel = zoom, click = select. With a drawing tool active, left-drag
 * works on the ground instead (see {@link mode}). Rebuild with {@link show} whenever the spec changes.
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
  private spec: SiteSpec | null = null;
  private selection: SitePick | null = null;
  private box: THREE.Box3Helper | null = null;
  private readonly paths: PathRenderer;
  private readonly ray = new THREE.Raycaster();
  /** 'select': drag orbits and a click selects. 'draw': left-drag reports ground points instead (right-drag / Shift still orbit). */
  mode: 'select' | 'draw' = 'select';
  onPick: (p: SitePick | null) => void = () => undefined;
  onGround: (phase: 'down' | 'move' | 'up' | 'hover', x: number, z: number) => void = () => undefined;
  /** How the terrain is drawn (natural, height map, wireframe). */
  groundStyle: GroundStyle = 'natural';
  /** A ring on the ground under the pointer (a terrain brush), or none. */
  private cursor: THREE.LineLoop | null = null;
  private press: { x: number; y: number; moved: boolean; ground: boolean } | null = null;

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
    this.paths = new PathRenderer(this.scene);
    const on = <K extends keyof HTMLElementEventMap>(t: K, f: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions): void => {
      canvas.addEventListener(t, f as EventListener, o);
      this.off.push(() => canvas.removeEventListener(t, f as EventListener));
    };
    on('pointerdown', (e) => {
      const ground = this.mode === 'draw' && e.button === 0 && !e.shiftKey;
      this.press = { x: e.clientX, y: e.clientY, moved: false, ground };
      canvas.setPointerCapture(e.pointerId);
      if (ground) {
        const g = this.groundPoint(e);
        if (g) this.onGround('down', g.x, g.z);
      } else this.drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
    });
    on('pointermove', (e) => {
      if (this.press && Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > 4) this.press.moved = true;
      if (this.press?.ground) {
        const g = this.groundPoint(e);
        if (g) this.onGround('move', g.x, g.z);
        return;
      }
      if (!this.press && this.mode === 'draw') {
        // drawing tools: where the pointer is on the ground (the height readout, the brush ring)
        const g = this.groundPoint(e);
        if (g) this.onGround('hover', g.x, g.z);
      }
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
    const release = (e: PointerEvent): void => {
      const p = this.press;
      this.press = null;
      this.drag = null;
      if (!p) return;
      if (p.ground) {
        const g = this.groundPoint(e);
        if (g) this.onGround('up', g.x, g.z);
        else this.onGround('up', Number.NaN, Number.NaN);
      } else if (!p.moved && e.type === 'pointerup' && this.mode === 'select' && e.button === 0) this.onPick(this.pickAt(e));
    };
    on('pointerup', release);
    on('pointercancel', release);
    on('contextmenu', (e) => e.preventDefault());
    on('wheel', (e) => {
      e.preventDefault();
      this.dist = Math.min(2500, Math.max(4, this.dist * (1 + e.deltaY * 0.001)));
    }, { passive: false });
    this.raf = requestAnimationFrame(this.tick);
  }

  setGroundStyle(style: GroundStyle): void {
    this.groundStyle = style;
    this.model?.setGroundStyle(style);
  }

  /** A dashed ring of radius `r` lying on the ground at (x, z), or none (null). */
  setCursor(c: { x: number; z: number; r: number; color: string } | null): void {
    if (!c || !this.model) {
      if (this.cursor) this.cursor.visible = false;
      return;
    }
    if (!this.cursor) {
      this.cursor = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: c.color, depthTest: false, transparent: true }));
      this.cursor.renderOrder = 10;
      this.scene.add(this.cursor);
    }
    const pts: number[] = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2, x = c.x + Math.cos(a) * c.r, z = c.z + Math.sin(a) * c.r;
      pts.push(x, this.model.ground.at(x, z) + 0.3, z);
    }
    this.cursor.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    (this.cursor.material as THREE.LineBasicMaterial).color.set(c.color);
    this.cursor.visible = true;
  }

  /** Rebuild from the spec. The camera re-frames only when `frameKey` changes (a different bando). */
  show(spec: SiteSpec, roofHidden: boolean, frameKey: string, focus: { id: string; li: number } | null = null): void {
    if (this.model) {
      this.scene.remove(this.model.group);
      dispose(this.model.group);
    }
    this.spec = spec;
    this.model = buildSiteFromSpec(spec, { merge: true });
    this.model.setRoofHidden?.(roofHidden);
    this.model.setGroundStyle(this.groundStyle);
    if (focus) this.focusFloor(spec, focus);
    this.scene.add(this.model.group);
    this.refreshSelection();
    if (frameKey !== this.framed) {
      this.framed = frameKey;
      this.target.set(0, 0, 0);
      this.dist = Math.max(60, Math.min(900, spec.extent * 0.9));
    }
  }

  /** One floor of a building in focus: the building turns see-through and that floor is drawn solid in place. */
  private focusFloor(spec: SiteSpec, f: { id: string; li: number }): void {
    const b = spec.buildings.find((x) => x.id === f.id);
    if (!b || b.levels.length < 2 || !this.model) return;
    this.model.group.traverse((o) => {
      const p = o.userData['pick'] as SitePick | undefined;
      if (p && p.kind === 'building' && p.id === f.id) ghost(o);
    });
    const mini = emptySpec(spec.origin, 'focus');
    mini.buildings = [levelOnly(b, f.li)];
    mini.extent = spec.extent;
    this.model.group.add(buildSiteFromSpec(mini, { bare: true }).group);
  }

  /** The point on the ground (the terrain, or y = 0) under the pointer, in site coordinates. */
  private groundPoint(e: { clientX: number; clientY: number }): { x: number; z: number } | null {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const grid = this.model?.ground.grid;
    if (grid) return rayGround(grid, this.ray.ray.origin, this.ray.ray.direction);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? { x: p.x, z: p.z } : null;
  }

  /** What is under the pointer: a building / structure / fence by the tag on its meshes, a tree by distance on the ground. */
  private pickAt(e: { clientX: number; clientY: number }): SitePick | null {
    if (!this.model || !this.spec) return null;
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    for (const hit of this.ray.intersectObject(this.model.group, true)) {
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
        const p = o.userData['pick'] as SitePick | undefined;
        if (p) return p;
      }
    }
    const g = this.groundPoint(e);
    if (g) {
      let best = -1, bd = Infinity;
      this.spec.trees.forEach((t, i) => {
        const d = Math.hypot(t.x - g.x, t.z - g.z) - t.r;
        if (d < 1.5 && d < bd) { bd = d; best = i; }
      });
      if (best >= 0) return { kind: 'tree', i: best };
    }
    return null;
  }

  setSelection(sel: SitePick | null): void {
    this.selection = sel;
    this.refreshSelection();
  }

  /** A yellow box around the selected thing. */
  private refreshSelection(): void {
    if (this.box) {
      this.scene.remove(this.box);
      this.box.geometry.dispose();
      this.box = null;
    }
    const sel = this.selection;
    if (!sel || !this.model || !this.spec) return;
    const b = new THREE.Box3();
    if (sel.kind === 'tree') {
      const t = this.spec.trees[sel.i];
      if (!t) return;
      b.set(new THREE.Vector3(t.x - t.r, 0, t.z - t.r), new THREE.Vector3(t.x + t.r, t.h, t.z + t.r));
    } else {
      this.model.group.traverse((o) => {
        const p = o.userData['pick'] as SitePick | undefined;
        if (p && p.kind === sel.kind && (('id' in p && 'id' in sel && p.id === sel.id) || ('i' in p && 'i' in sel && p.i === sel.i))) b.expandByObject(o);
      });
    }
    if (b.isEmpty()) return;
    this.box = new THREE.Box3Helper(b, 0xffd166);
    this.scene.add(this.box);
  }

  setPaths(flights: Flight[], speedMax: number): void {
    this.paths.rebuild(flights, speedMax);
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
    this.paths.setProgress();
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
