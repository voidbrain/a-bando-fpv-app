import * as THREE from 'three';
import type { OpenSeg } from '../core/openings';
import { emptySpec, type BuildingSpec, type ColumnSpec, type StructureSpec, type TreeSpec, type VoidSpec, type WallSpec, type Vec2 } from '../core/site-spec';
import { buildStructure } from './structures';
import { buildSiteFromSpec } from './site-model';

/** What the inspector's 3D preview shows. A part of a building is shown in place, the rest of the building ghosted. */
export type PreviewTarget =
  | { kind: 'building'; b: BuildingSpec }
  | { kind: 'tree'; t: TreeSpec }
  | { kind: 'fence'; w: WallSpec }
  | { kind: 'structure'; s: StructureSpec }
  | { kind: 'part'; b: BuildingSpec; li: number; part: PartHighlight };

export type PartHighlight =
  | { t: 'opening'; seg: OpenSeg }
  | { t: 'wall'; a: Vec2; c: Vec2 }
  | { t: 'void'; v: VoidSpec }
  | { t: 'column'; c: ColumnSpec };

const HILITE = '#ffd166';

const stdMat = (color: string, emissive = 0): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: 0.7, emissive: new THREE.Color(color), emissiveIntensity: emissive });

/** An opaque box with a bright outline, so it reads clearly through the ghosted building. */
function marker(w: number, h: number, d: number, color: string, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(Math.max(0.05, w), Math.max(0.05, h), Math.max(0.05, d));
  const m = new THREE.Mesh(geo, stdMat(color, 0.35));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: '#ffffff' }));
  g.add(m, edges);
  g.position.set(x, y, z);
  return g;
}

/** The building alone (no ground), built by the same code as the real scene, centred and unrotated. */
function buildingGroup(b: BuildingSpec): THREE.Group {
  const mini = emptySpec({ lat: 0, lon: 0 }, 'preview');
  mini.buildings = [{ ...JSON.parse(JSON.stringify(b)), pos: { x: 0, z: 0 }, rotDeg: 0 } as BuildingSpec];
  mini.trees = [];
  mini.pads = [];
  mini.walls = [];
  mini.extent = 10;
  return buildSiteFromSpec(mini, { bare: true }).group;
}

/** Make every material of a group see-through (cloned, so the shared ones are untouched). */
function ghost(root: THREE.Object3D, opacity = 0.13): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (m.material as THREE.Material).clone() as THREE.MeshStandardMaterial;
    mat.transparent = true;
    mat.opacity = opacity;
    mat.depthWrite = false;
    m.material = mat;
    m.castShadow = false;
  });
}

function partGroup(b: BuildingSpec, li: number, p: PartHighlight): THREE.Group {
  const L = b.length, W = b.width;
  const lev = b.levels[Math.min(li, b.levels.length - 1)]!;
  const out = new THREE.Group();
  if (p.t === 'opening') {
    const o = p.seg;
    const y0 = lev.baseY + (o.kind === 'door' ? 0 : Math.min(lev.height - 0.2, o.sill));
    const color = o.kind === 'door' ? '#ff9a2e' : '#4fc3f7';
    out.add(o.axis === 'x' ? marker(o.w, o.h, 0.8, color, o.c, y0 + o.h / 2, o.at) : marker(0.8, o.h, o.w, color, o.at, y0 + o.h / 2, o.c));
  } else if (p.t === 'wall') {
    const len = Math.hypot(p.c.x - p.a.x, p.c.z - p.a.z);
    const mx = (p.a.x + p.c.x) / 2 - L / 2, mz = (p.a.z + p.c.z) / 2 - W / 2;
    const y = lev.baseY + lev.height / 2;
    out.add(Math.abs(p.a.x - p.c.x) < 0.01 ? marker(0.45, lev.height, len, HILITE, mx, y, mz) : marker(len, lev.height, 0.45, HILITE, mx, y, mz));
  } else if (p.t === 'void') {
    const v = p.v;
    out.add(marker(v.x1 - v.x0, 0.3, v.z1 - v.z0, v.water ? '#3d86b6' : '#111111', (v.x0 + v.x1) / 2 - L / 2, lev.baseY + 0.1, (v.z0 + v.z1) / 2 - W / 2));
  } else {
    const c = p.c;
    out.add(marker(c.size, lev.height, c.size, HILITE, c.x - L / 2, lev.baseY + lev.height / 2, c.z - W / 2));
  }
  return out;
}

function treeGroup(t: TreeSpec): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, t.h * 0.45, 8), stdMat('#70533a'));
  trunk.position.y = t.h * 0.225;
  const crown = new THREE.Mesh(t.kind === 'c' ? new THREE.ConeGeometry(t.r, t.h * 0.75, 8) : new THREE.IcosahedronGeometry(t.r, 1), stdMat(t.kind === 'c' ? '#2f6b3c' : '#4f9a4a'));
  crown.position.y = t.kind === 'c' ? t.h * 0.6 : t.h * 0.62;
  g.add(trunk, crown);
  return g;
}

/** The whole scene content for a target (without lights / camera): what the preview draws. Pure, no renderer needed. */
export function buildPreviewGroup(target: PreviewTarget): THREE.Group {
  const root = new THREE.Group();
  if (target.kind === 'building') root.add(buildingGroup(target.b));
  else if (target.kind === 'tree') root.add(treeGroup(target.t));
  else if (target.kind === 'structure') root.add(buildStructure({ ...target.s, x: 0, z: 0, rotDeg: 0 }).object);
  else if (target.kind === 'fence') {
    const w = target.w;
    const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
    root.add(marker(len, w.height, w.thick, w.color ?? '#d9c9a0', 0, w.height / 2, 0));
  } else {
    const b = buildingGroup(target.b);
    ghost(b);
    root.add(b, partGroup(target.b, target.li, target.part));
  }
  return root;
}

/** A small orbiting 3D view in a canvas. Create it once, call {@link show} whenever the target changes. */
export class PreviewRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000);
  private content: THREE.Object3D | null = null;
  private grid: THREE.GridHelper | null = null;
  private yaw = -0.7;
  private pitch = 0.5;
  private dist = 30;
  private centre = new THREE.Vector3();
  private lastInput = 0;
  private raf = 0;
  private last = 0;
  private dragging: { x: number; y: number } | null = null;
  private readonly off: (() => void)[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3b4a3f, 1.25));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(8, 14, 6);
    this.scene.add(sun);
    const on = <K extends keyof HTMLElementEventMap>(t: K, f: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions): void => {
      canvas.addEventListener(t, f as EventListener, o);
      this.off.push(() => canvas.removeEventListener(t, f as EventListener));
    };
    on('pointerdown', (e) => {
      this.dragging = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      this.lastInput = performance.now();
    });
    on('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw -= (e.clientX - this.dragging.x) * 0.01;
      this.pitch = Math.min(1.45, Math.max(-0.1, this.pitch + (e.clientY - this.dragging.y) * 0.008));
      this.dragging = { x: e.clientX, y: e.clientY };
      this.lastInput = performance.now();
    });
    on('pointerup', () => (this.dragging = null));
    on('pointercancel', () => (this.dragging = null));
    on('wheel', (e) => {
      e.preventDefault();
      this.dist = Math.min(this.maxDist, Math.max(this.minDist, this.dist * (1 + e.deltaY * 0.001)));
      this.lastInput = performance.now();
    }, { passive: false });
    this.raf = requestAnimationFrame(this.tick);
  }

  private minDist = 2;
  private maxDist = 400;

  /** Replace what is shown. `reframe` re-centres the camera (a different object); otherwise the view is kept. */
  show(target: PreviewTarget, reframe: boolean): void {
    if (this.content) {
      this.scene.remove(this.content);
      dispose(this.content);
    }
    this.content = buildPreviewGroup(target);
    this.scene.add(this.content);
    const box = new THREE.Box3().setFromObject(this.content);
    if (box.isEmpty()) return;
    if (reframe || this.dist === 30) {
      const size = box.getSize(new THREE.Vector3());
      const r = Math.max(1, size.length() / 2);
      box.getCenter(this.centre);
      this.dist = (r / Math.sin((this.camera.fov * Math.PI) / 360)) * 1.05;
      this.minDist = r * 0.6;
      this.maxDist = r * 12;
    }
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
    }
    const gs = Math.max(10, Math.ceil(box.getSize(new THREE.Vector3()).length() * 1.4));
    this.grid = new THREE.GridHelper(gs, 10, 0x56705f, 0x2f4136);
    this.grid.position.set(this.centre.x, 0, this.centre.z);
    this.scene.add(this.grid);
  }

  private readonly tick = (now: number): void => {
    this.raf = requestAnimationFrame(this.tick);
    const c = this.canvas;
    // invisible (collapsed / hidden panel, hidden tab): do no work
    if (!c.isConnected || c.clientWidth < 8 || c.clientHeight < 8 || document.hidden || !c.offsetParent) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const w = c.clientWidth, h = c.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (!this.dragging && now - this.lastInput > 2500) this.yaw += dt * 0.35; // slow turntable once you let go
    const cp = Math.cos(this.pitch);
    this.camera.position.set(this.centre.x + this.dist * cp * Math.sin(this.yaw), this.centre.y + this.dist * Math.sin(this.pitch), this.centre.z + this.dist * cp * Math.cos(this.yaw));
    this.camera.lookAt(this.centre);
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    for (const f of this.off) f();
    if (this.content) dispose(this.content);
    this.grid?.geometry.dispose();
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
