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
  /** One floor of a building being edited: that floor opaque, every other floor and the roof ghosted. */
  | { kind: 'floor'; b: BuildingSpec; li: number }
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
export function ghost(root: THREE.Object3D, opacity = 0.13): void {
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

/** The same building with only floor `li` in it (roof only if that is the top floor). */
export function levelOnly(b: BuildingSpec, li: number): BuildingSpec {
  const c = JSON.parse(JSON.stringify(b)) as BuildingSpec;
  const lv = c.levels[Math.min(li, c.levels.length - 1)]!;
  if (li < b.levels.length - 1) lv.roof = 'none';
  c.levels = [lv];
  return c;
}

/** Rotation of the thing as it stands on the site: where north is, seen from the thing's own axes. */
export function targetRotationDeg(t: PreviewTarget): number {
  if (t.kind === 'building' || t.kind === 'part' || t.kind === 'floor') return t.b.rotDeg;
  if (t.kind === 'structure') return t.s.rotDeg;
  if (t.kind === 'fence') return (Math.atan2(t.w.b.z - t.w.a.z, t.w.b.x - t.w.a.x) * 180) / Math.PI;
  return 0;
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
  else if (target.kind === 'floor') {
    const all = buildingGroup(target.b);
    ghost(all);
    root.add(all, buildingGroup(levelOnly(target.b, target.li)));
  }
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
  private readonly compass = new THREE.Group();
  private yaw = -0.7;
  private pitch = 0.5;
  private dist = 30;
  private centre = new THREE.Vector3();
  private lastInput = 0;
  /** Turn slowly when left alone (can be stopped). */
  spin = true;
  /** Called when a column or interior wall is clicked (not dragged). */
  onPick: ((p: { kind: 'column' | 'wall'; i: number }) => void) | null = null;
  private readonly ray = new THREE.Raycaster();
  private downAt: { x: number; y: number } | null = null;
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
    this.compass.add(makeCompass());
    this.scene.add(this.compass);
    const on = <K extends keyof HTMLElementEventMap>(t: K, f: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions): void => {
      canvas.addEventListener(t, f as EventListener, o);
      this.off.push(() => canvas.removeEventListener(t, f as EventListener));
    };
    on('pointerdown', (e) => {
      this.downAt = { x: e.clientX, y: e.clientY };
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
    on('pointerup', (e) => {
      this.dragging = null;
      const d = this.downAt;
      this.downAt = null;
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) this.pickAt(e);
    });
    on('pointercancel', () => (this.dragging = null));
    on('wheel', (e) => {
      e.preventDefault();
      this.dist = Math.min(this.maxDist, Math.max(this.minDist, this.dist * (1 + e.deltaY * 0.001)));
      this.lastInput = performance.now();
    }, { passive: false });
    this.raf = requestAnimationFrame(this.tick);
  }

  /** Click on a column / interior wall of the previewed floor: report which one. */
  private pickAt(e: PointerEvent): void {
    if (!this.content || !this.onPick) return;
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    for (const hit of this.ray.intersectObject(this.content, true)) {
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
        const p = o.userData['pick'] as { kind?: string; i?: number } | undefined;
        if (p && (p.kind === 'column' || p.kind === 'wall') && typeof p.i === 'number') {
          this.onPick?.({ kind: p.kind, i: p.i });
          return;
        }
      }
    }
  }

  private minDist = 2;
  private maxDist = 400;

  /** Point the camera at a box, from far enough to see all of it (`keepRange`: zooming out stays as far as before). */
  private frame(box: THREE.Box3, keepRange = false): void {
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(1, size.length() / 2);
    box.getCenter(this.centre);
    this.dist = (r / Math.sin((this.camera.fov * Math.PI) / 360)) * 1.05;
    this.minDist = r * 0.6;
    this.maxDist = keepRange ? Math.max(this.maxDist, r * 12) : r * 12;
  }

  /** Zoom to one of the building's fixtures (a roof ladder, a chimney), or back to the whole thing (null). */
  zoomTo(fixture: number | null): void {
    if (!this.content) return;
    let target: THREE.Object3D = this.content;
    if (fixture !== null) this.content.traverse((o) => void (o.userData['fixture'] === fixture && (target = o)));
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return;
    this.frame(box, target !== this.content);
  }

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
    if (reframe || this.dist === 30) this.frame(box);
    // the compass ring lies around the thing; its red arrow points to the real north
    const half = box.getSize(new THREE.Vector3()).length() / 2;
    this.compass.position.set(this.centre.x, 0.06, this.centre.z);
    this.compass.scale.setScalar(Math.max(3, half * 0.95 + 1.5));
    this.compass.rotation.y = (targetRotationDeg(target) * Math.PI) / 180;
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
    if (this.spin && !this.dragging && now - this.lastInput > 1500) this.yaw += dt * 0.35; // slow turntable once you let go
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

/** A flat ring (unit radius) with a red arrow and an "N" at north (= -z before the group is turned). */
function makeCompass(): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 64), new THREE.MeshBasicMaterial({ color: '#9fb5a6', side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
  ring.rotation.x = -Math.PI / 2;
  g.add(ring);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 10), new THREE.MeshBasicMaterial({ color: '#ff5a4d' }));
  arrow.rotation.x = -Math.PI / 2; // the cone points along -z
  arrow.position.set(0, 0.02, -1.0);
  g.add(arrow);
  for (const [x, z] of [[1, 0], [0, 1], [-1, 0]] as const) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.1), new THREE.MeshBasicMaterial({ color: '#9fb5a6' }));
    tick.position.set(x * 0.97, 0.01, z * 0.97);
    tick.rotation.y = Math.atan2(x, z);
    g.add(tick);
  }
  const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const ctx = cv?.getContext('2d');
  if (cv && ctx) {
    cv.width = cv.height = 64;
    ctx.fillStyle = '#ff5a4d';
    ctx.font = 'bold 46px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 32, 34);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
    sp.scale.setScalar(0.3);
    sp.position.set(0, 0.1, -1.22);
    g.add(sp);
  }
  return g;
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
