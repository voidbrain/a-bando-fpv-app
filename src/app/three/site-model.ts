import { cutRect, edgesOf, slabs } from '../core/footprint';
import * as THREE from 'three';
import { type BuildingSpec, type LevelSpec, type OpeningSpec, type SiteSpec, type TreeSpec, createRandom } from '../core/site-spec';
import { SiteCollider, type SolidBox, type TreeCylinder } from '../core/sim/collider';

export type TreeKind = 'd' | 'c';

/** Everything built for the site: the scalable group, collision data and the pieces other systems manipulate. */
export interface SiteModel {
  /** All site geometry. Scaled as one when the user resizes the model. */
  group: THREE.Group;
  /** Roofs (hidden together by the "Hide roof" toggle). */
  roof: THREE.Group;
  collider: SiteCollider;
  trees: TreeField;
  /** Meshes the x-ray may fade when they hide the drone. */
  occluders: THREE.Mesh[];
  setScale(k: number): void;
  setRoofHidden(hidden: boolean): void;
}

/** Instanced trees (trunks + crowns) with per-tree hide, used by the x-ray. */
export class TreeField {
  private readonly tmp = new THREE.Object3D();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  constructor(
    readonly dec: readonly TreeSpec[],
    readonly con: readonly TreeSpec[],
    readonly trunks: THREE.InstancedMesh,
    readonly crownsDec: THREE.InstancedMesh,
    readonly crownsCon: THREE.InstancedMesh,
  ) {}

  matrix(kind: TreeKind, i: number, trunk: boolean): THREE.Matrix4 {
    const t = (kind === 'd' ? this.dec : this.con)[i] as TreeSpec;
    const o = this.tmp;
    if (trunk) {
      o.position.set(t.x, t.h * 0.2, t.z);
      o.scale.set(1, t.h * 0.4, 1);
    } else if (kind === 'd') {
      o.position.set(t.x, t.h * 0.4 + t.r * 0.7, t.z);
      o.scale.set(t.r, t.r * 1.15, t.r);
    } else {
      o.position.set(t.x, t.h * 0.65, t.z);
      o.scale.set(t.r * 0.9, t.h * 0.8, t.r * 0.9);
    }
    o.rotation.set(0, 0, 0);
    o.updateMatrix();
    return o.matrix.clone();
  }

  setHidden(kind: TreeKind, i: number, hide: boolean): void {
    (kind === 'd' ? this.crownsDec : this.crownsCon).setMatrixAt(i, hide ? this.zero : this.matrix(kind, i, false));
    this.trunks.setMatrixAt(kind === 'd' ? i : this.dec.length + i, hide ? this.zero : this.matrix(kind, i, true));
    this.crownsDec.instanceMatrix.needsUpdate = true;
    this.crownsCon.instanceMatrix.needsUpdate = true;
    this.trunks.instanceMatrix.needsUpdate = true;
  }
}

/** Draw order of the ground (first) and of the meadow patches (after it, one step per patch). */
const GROUND_ORDER = -2000;
const DECAL_ORDER = -1000;

const material = (color: string, o: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.95, ...o });

/**
 * Builder context while one spec is turned into geometry. Mesh coordinates are building-local (the building group
 * carries position + rotation); collider boxes are registered directly in site space through `at` / `rot`.
 */
interface Ctx {
  /** Centre of the building currently being built, in site coordinates. */
  at: [number, number];
  /** Rotation of that building (degrees about Y), baked conservatively into the collider AABBs. */
  rot: number;
  solids: SolidBox[];
  occluders: THREE.Mesh[];
  mat: { wall: THREE.MeshStandardMaterial; white: THREE.MeshStandardMaterial; pier: THREE.MeshStandardMaterial; steel: THREE.MeshStandardMaterial; conc: THREE.MeshStandardMaterial; dirt: THREE.MeshStandardMaterial };
  matFor(c?: string): THREE.MeshStandardMaterial;
  seed: number;
  addBox(target: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, m: THREE.Material, solid: boolean, cast: boolean): THREE.Mesh;
  addMesh(target: THREE.Object3D, m: THREE.Mesh, x: number, y: number, z: number, solidBox?: SolidBox): void;
}

/** Barrel vault / half cylinder along local Z. */
function vault(len: number, r: number, k: number, mat: THREE.Material, seg = 8): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true, Math.PI / 2, Math.PI);
  g.rotateX(Math.PI / 2);
  g.scale(1, k, 1);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Three-prism gable roof spanning `w` along X, `d` deep, ridge over the long axis. */
function gable(w: number, d: number, rise: number, mat: THREE.Material): THREE.Mesh {
  const R = d * 0.577;
  const g = new THREE.CylinderGeometry(R, R, w + 0.8, 3);
  g.rotateX(Math.PI / 2);
  g.rotateZ(Math.PI);
  g.rotateY(Math.PI / 2);
  g.scale(1, (rise * 2) / (1.5 * R), 1);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Wall strips of one side with openings punched out (doors from the floor, windows on a high sill). */
function buildSide(ctx: Ctx, b: BuildingSpec, l: LevelSpec, side: 'n' | 's' | 'e' | 'w', target: THREE.Object3D): void {
  const runLen = side === 'n' || side === 'w' ? b.length : b.width;
  const acrossPos = side === 'w' ? -b.length / 2 : side === 'e' ? b.length / 2 : side === 'n' ? -b.width / 2 : b.width / 2;
  const th = 0.5;
  const wall = (from: number, len: number, y: number, hh: number): void => {
    if (len < 0.01 || hh < 0.01) return;
    const m = from + len / 2 - runLen / 2;
    if (side === 'w' || side === 'e') ctx.addBox(target, acrossPos, y, m, th, hh, len, ctx.mat.wall, true, true);
    else ctx.addBox(target, m, y, acrossPos, len, hh, th, ctx.mat.wall, true, true);
  };
  let p = 0;
  for (const o of (l.doors[side] ?? []).slice().sort((x, y) => x.c - y.c)) {
    wall(p, o.c - o.w / 2, l.height / 2, l.height);
    const gy0 = o.kind === 'door' ? 0 : Math.min(l.height - 0.2, o.sill ?? Math.max(0.4, l.height * 0.75));
    const gy1 = Math.min(l.height, gy0 + o.h);
    if (gy0 > 0) wall(o.c - o.w / 2, o.w, gy0 / 2, gy0);
    if (gy1 < l.height) wall(o.c - o.w / 2, o.w, (gy1 + l.height) / 2, l.height - gy1);
    p = o.c + o.w / 2;
  }
  wall(p, runLen - p, l.height / 2, l.height);
}

/** Walls of a shaped building: one wall per footprint edge, openings (door / window centres) punched out of them. */
function buildPolyWalls(ctx: Ctx, b: BuildingSpec, l: LevelSpec, target: THREE.Object3D): void {
  const th = 0.5;
  for (const e of edgesOf(b.footprint ?? [])) {
    const ops = (l.wallOpenings ?? [])
      .filter((o) => (e.axis === 'x' ? Math.abs(o.z - e.at) < 0.08 && o.x >= e.from - 0.08 && o.x <= e.to + 0.08 : Math.abs(o.x - e.at) < 0.08 && o.z >= e.from - 0.08 && o.z <= e.to + 0.08))
      .map((o) => ({ o, c: e.axis === 'x' ? o.x : o.z }))
      .sort((p, q) => p.c - q.c);
    const wall = (from: number, to: number, y: number, hh: number): void => {
      const len = to - from;
      if (len < 0.01 || hh < 0.01) return;
      const m = (from + to) / 2;
      if (e.axis === 'x') ctx.addBox(target, m, y, e.at, len, hh, th, ctx.mat.wall, true, true);
      else ctx.addBox(target, e.at, y, m, th, hh, len, ctx.mat.wall, true, true);
    };
    let p = e.from - th / 2;
    for (const { o, c } of ops) {
      const a = Math.max(p, c - o.w / 2), z = Math.min(e.to + th / 2, c + o.w / 2);
      wall(p, a, l.height / 2, l.height);
      const gy0 = o.kind === 'door' ? 0 : Math.min(l.height - 0.2, o.sill ?? Math.max(0.4, l.height * 0.75));
      const gy1 = Math.min(l.height, gy0 + o.h);
      if (gy0 > 0) wall(a, z, gy0 / 2, gy0);
      if (gy1 < l.height) wall(a, z, (gy1 + l.height) / 2, l.height - gy1);
      p = z;
    }
    wall(p, e.to + th / 2, l.height / 2, l.height);
  }
}

/** Four walls of one level plus interior partitions (thin solid walls between their endpoints). */
function buildWalls(ctx: Ctx, b: BuildingSpec, l: LevelSpec, target: THREE.Object3D): void {
  if (b.footprint) buildPolyWalls(ctx, b, l, target);
  else {
    for (const side of ['n', 's', 'e', 'w'] as const) {
      if (l.sides[side]) buildSide(ctx, b, l, side, target);
    }
  }
  for (const [a, c] of l.partitions) {
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    if (len < 0.3) continue;
    const mx = (a.x + c.x) / 2 - b.length / 2, mz = (a.z + c.z) / 2 - b.width / 2;
    if (Math.abs(a.x - c.x) < 0.01) ctx.addBox(target, mx, l.height / 2, mz, 0.3, l.height, len, ctx.mat.wall, true, true);
    else ctx.addBox(target, mx, l.height / 2, mz, len, l.height, 0.3, ctx.mat.wall, true, true);
  }
}

function buildRoof(ctx: Ctx, b: BuildingSpec, l: LevelSpec, target: THREE.Object3D): void {
  if (l.roof === 'none') return; // a floor above covers this level
  const top = l.baseY + l.height;
  const rise = Math.max(0.5, l.roofRise);
  const rc = ctx.matFor(l.roofColor);
  if (b.footprint) {
    // shaped buildings: a flat roof, one slab per rectangle of the outline (each is also a collider)
    for (const r of slabs(b.footprint)) ctx.addBox(target, (r.x0 + r.x1) / 2, top + 0.15, (r.z0 + r.z1) / 2, r.x1 - r.x0, 0.3, r.z1 - r.z0, rc, true, true);
    return;
  }
  if (l.roof === 'flat') {
    ctx.addBox(target, 0, top + 0.15, 0, b.length + 0.6, 0.3, b.width + 0.6, rc, false, true);
    ctx.solids.push(rotBoxLocal(ctx.at[0], ctx.at[1], b.length, b.width, ctx.rot, top, top + 0.3, true));
    return;
  }
  // gable / vault: `n` identical modules side by side. By default a gable ridge runs along the length (modules split
  // the width) and barrels run along the width (modules split the length); `roofTurn` swaps the two.
  const n = Math.max(1, Math.round(l.roofCount ?? l.vaultCount ?? 1));
  const turn = !!l.roofTurn;
  if (l.roof === 'gable') {
    const run = turn ? b.width : b.length; // ridge length
    const across = turn ? b.length : b.width; // split into n modules
    const span = across / n;
    for (let i = 0; i < n; i++) {
      const m = gable(run, span, rise, rc);
      const c = -across / 2 + span / 2 + i * span;
      if (turn) {
        m.rotation.y = Math.PI / 2;
        ctx.addMesh(target, m, c, top + rise * 0.45, 0);
      } else ctx.addMesh(target, m, 0, top + rise * 0.45, c);
    }
    ctx.solids.push(rotBoxLocal(ctx.at[0], ctx.at[1], b.length, b.width, ctx.rot, top, top + rise, true));
    return;
  }
  const run = turn ? b.length : b.width; // barrel length
  const across = turn ? b.width : b.length;
  const VW = across / n, VR = VW / 2, VK = l.vaultK ?? 0.58;
  for (let i = 0; i < n; i++) {
    const m = vault(run, VR, VK, rc);
    const c = -across / 2 + VW / 2 + i * VW;
    if (turn) {
      m.rotation.y = Math.PI / 2;
      ctx.addMesh(target, m, 0, top, c);
    } else ctx.addMesh(target, m, c, top, 0);
  }
  ctx.solids.push(rotBoxLocal(ctx.at[0], ctx.at[1], b.length, b.width, ctx.rot, top + 0.4, top + VR * VK + 0.2, true));
}

/** Floor slab of a level (minus its voids), plus the water basin of a ground-floor void, plus its columns. */
function buildFloorAndColumns(ctx: Ctx, b: BuildingSpec, l: LevelSpec, inner: THREE.Object3D, floorMat: THREE.Material): void {
  const L = b.length, W = b.width;
  const voids = (l.voids ?? []).map((v) => ({ x0: v.x0 - L / 2, x1: v.x1 - L / 2, z0: v.z0 - W / 2, z1: v.z1 - W / 2, water: !!v.water }));
  let rects = b.footprint ? slabs(b.footprint) : [{ x0: -L / 2, x1: L / 2, z0: -W / 2, z1: W / 2 }];
  for (const v of voids) rects = rects.flatMap((r) => cutRect(r, v));
  for (const r of rects) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, w = r.x1 - r.x0, d = r.z1 - r.z0;
    if (l.baseY === 0) ctx.addBox(inner, cx, 0.05, cz, w, 0.1, d, floorMat, false, false);
    else ctx.addBox(inner, cx, l.baseY, cz, w, 0.2, d, floorMat, false, false);
  }
  if (l.baseY === 0) {
    const water = material('#3d86b6', { transparent: true, opacity: 0.78, roughness: 0.15 });
    for (const v of voids) if (v.water) ctx.addBox(inner, (v.x0 + v.x1) / 2, 0.03, (v.z0 + v.z1) / 2, v.x1 - v.x0, 0.06, v.z1 - v.z0, water, false, false);
  }
  const colMat = material('#b8b4a8');
  for (const c of l.columns ?? []) {
    const cx = c.x - L / 2, cz = c.z - W / 2, y = l.baseY + l.height / 2;
    if (c.round) {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(c.size / 2, c.size / 2, l.height, 14), colMat);
      cyl.castShadow = true;
      cyl.receiveShadow = true;
      ctx.addMesh(inner, cyl, cx, y, cz);
      ctx.addBox(inner, cx, y, cz, c.size, l.height, c.size, colMat, true, false).visible = false; // the collision box
    } else ctx.addBox(inner, cx, y, cz, c.size, l.height, c.size, colMat, true, true);
  }
}

/** Greenhouse tunnel: elliptical glass vault (middle third torn away), steel ribs every ~2.5 m, bar-only ends. */
function buildGreenhouse(ctx: Ctx, b: BuildingSpec, target: THREE.Object3D, roofTarget: THREE.Object3D): void {
  const l = b.levels[0];
  const GS = l.baseY, GW = b.width / 2, GK = l.vaultK ?? 0.7, GHT = GS + GW * GK;
  const glassMat = material('#9ec1b6', { transparent: true, opacity: 0.3, side: THREE.DoubleSide, roughness: 0.3, depthWrite: false });
  const TZ0 = -b.length / 2 + 0.66 * b.length, TZ1 = -b.length / 2 + 0.92 * b.length;
  for (const [f0, f1] of [[0, 0.37], [0.37, 0.66], [0.92, 1]] as const) {
    const x0 = -b.length / 2 + f0 * b.length, x1 = -b.length / 2 + f1 * b.length;
    const v = vault(x1 - x0, GW, GK, glassMat, 14);
    v.castShadow = false;
    v.rotation.y = Math.PI / 2;
    ctx.addMesh(roofTarget, v, (x0 + x1) / 2, GS, 0);
  }
  const lp: number[] = [];
  for (let a = 22.5; a < 180; a += 22.5) {
    const r = (a * Math.PI) / 180, y = GS + GW * GK * Math.sin(r), z = GW * Math.cos(r);
    lp.push(-b.length / 2, y, z, b.length / 2, y, z);
  }
  const rnd = createRandom(ctx.seed);
  const nRibs = Math.max(2, Math.round(b.length / 2.5));
  for (let i = 0; i <= nRibs; i++) {
    const x = -b.length / 2 + (i * b.length) / nRibs;
    const torn = x > TZ0 && x < TZ1;
    const t = new THREE.Mesh(new THREE.TorusGeometry(GW, 0.08, 4, 14, Math.PI), ctx.mat.steel);
    t.rotation.y = Math.PI / 2;
    t.scale.y = GK * (torn ? 1 - rnd() * 0.2 : 1);
    if (torn) t.rotation.x = (rnd() - 0.5) * 0.05;
    ctx.addMesh(target, t, x, GS, 0);
    lp.push(x, 0, -GW, x, GS, -GW, x, 0, GW, x, GS, GW);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  target.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x56655f })));
  ctx.solids.push(rotBoxLocal((-b.length / 2 + TZ0) / 2 + ctx.at[0], ctx.at[1], TZ0 + b.length / 2, 8, ctx.rot, GHT - 1.5, GHT, false));
  ctx.solids.push(rotBoxLocal((TZ1 + b.length / 2) / 2 + ctx.at[0], ctx.at[1], b.length / 2 - TZ1, 8, ctx.rot, GHT - 1.5, GHT, false));
}

/** Collider AABB of an element at site coordinates (x, z), rotated `deg` about Y (conservative envelope). */
function rotBoxLocal(x: number, z: number, w: number, d: number, deg: number, y0: number, y1: number, roof: boolean): SolidBox {
  if (Math.abs(deg) < 0.01) return [x - w / 2, x + w / 2, y0, y1, z - d / 2, z + d / 2, roof];
  const a = (-deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
  return [x - hw, x + hw, y0, y1, z - hd, z + hd, roof];
}

/** Build the whole site from a {@link SiteSpec}. Deterministic: the same spec always produces the same scene. */
export function buildSiteFromSpec(spec: SiteSpec): SiteModel {
  const group = new THREE.Group();
  const roof = new THREE.Group();
  group.add(roof);
  const solids: SolidBox[] = [];
  const treeSolids: TreeCylinder[] = [];
  const occluders: THREE.Mesh[] = [];
  const rnd = createRandom(spec.seed);

  const mats: Record<string, THREE.MeshStandardMaterial> = {};
  const ctx: Ctx = {
    at: [0, 0],
    rot: 0,
    solids,
    occluders,
    mat: {
      wall: material('#d7d0bd'),
      white: material('#e8e6dc'),
      pier: material('#c4c1b2'),
      steel: material('#899792', { metalness: 0.6, roughness: 0.4 }),
      conc: material('#a9aaa0'),
      dirt: material('#b49b73'),
    },
    matFor: (c?: string) => (mats[c ?? '#b5683f'] ??= material(c ?? '#b5683f')),
    seed: spec.seed,
    addBox: (target, x, y, z, w, h, d, m, solid, cast) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      o.position.set(x, y, z);
      o.castShadow = cast;
      o.receiveShadow = true;
      target.add(o);
      if (solid) {
        solids.push(rotBoxLocal(x + ctx.at[0], z + ctx.at[1], w, d, ctx.rot, y - h / 2, y + h / 2, false));
        occluders.push(o);
      }
      return o;
    },
    addMesh: (target, m, x, y, z, solidBox) => {
      m.position.set(x, y, z);
      target.add(m);
      if (solidBox) solids.push(solidBox);
      occluders.push(m);
    },
  };

  // ---- ground + meadow patches (patches ignore depth; everything drawn after them covers them)
  const grass = material(spec.groundColor);
  const ground = new THREE.Mesh(new THREE.BoxGeometry(spec.extent * 2.2, 1, spec.extent * 2.2), grass);
  ground.position.set(0, -0.5, 0);
  ground.receiveShadow = true;
  ground.renderOrder = GROUND_ORDER;
  group.add(ground);
  const patchMats = ['#6f9350', '#86a35a', '#8a8656', '#7d7a52', '#98a262', '#9a8a5c'].map((c) => material(c, { depthWrite: false, depthTest: false }));
  for (let i = 0; i < 300; i++) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(3 + rnd() * 13, 6), patchMats[i % 6]);
    p.rotation.set(-Math.PI / 2, 0, rnd() * 6);
    p.position.set((rnd() - 0.5) * spec.extent * 2.1, 0.01, (rnd() - 0.5) * spec.extent * 1.9);
    p.renderOrder = DECAL_ORDER + i;
    p.receiveShadow = true;
    group.add(p);
  }

  // ---- pads / roads / take-off pad
  let order = DECAL_ORDER + 300;
  for (const pd of spec.pads) {
    const o = new THREE.Mesh(new THREE.BoxGeometry(pd.w, 0.16, pd.d), material(pd.color ?? '#a9aaa0'));
    o.position.set(pd.x, 0.08, pd.z);
    o.rotation.y = (-(pd.rotDeg ?? 0) * Math.PI) / 180;
    o.receiveShadow = true;
    o.renderOrder = order++;
    group.add(o);
  }
  const start = new THREE.Mesh(new THREE.BoxGeometry(4, 0.04, 4), material('#e8c65a'));
  start.position.set(spec.droneStart.x, 0.2, spec.droneStart.z);
  start.receiveShadow = true;
  group.add(start);

  // ---- buildings
  for (const b of spec.buildings) {
    const inner = new THREE.Group();
    inner.position.set(b.pos.x, 0, b.pos.z);
    inner.rotation.y = (-b.rotDeg * Math.PI) / 180;
    group.add(inner);
    const localRoof = new THREE.Group();
    inner.add(localRoof);
    ctx.at = [b.pos.x, b.pos.z];
    ctx.rot = b.rotDeg;
    const floorMat = material(b.floorColor ?? '#a9aaa0');
    for (const l of b.levels) {
      buildFloorAndColumns(ctx, b, l, inner, floorMat);
      if (b.frame === 'greenhouse') {
        buildGreenhouse(ctx, b, inner, localRoof);
        break;
      }
      buildWalls(ctx, b, l, inner);
      buildRoof(ctx, b, l, localRoof);
    }
    // roofs live under the building but belong to the global roof group for hide/show
    roof.attach(localRoof);
  }

  // ---- free-standing walls / fences
  for (const w of spec.walls ?? []) {
    const dx = w.b.x - w.a.x, dz = w.b.z - w.a.z, len = Math.hypot(dx, dz);
    if (len < 0.3) continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, w.height, w.thick), material(w.color ?? '#b9b2a2'));
    m.position.set((w.a.x + w.b.x) / 2, w.height / 2, (w.a.z + w.b.z) / 2);
    m.rotation.y = -Math.atan2(dz, dx);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    // collision: a staircase of small boxes along the wall (the collider only knows axis-aligned boxes)
    const n = Math.max(1, Math.ceil(len / 1.0));
    const seg = len / n, ca = Math.abs(dx / len), sa = Math.abs(dz / len);
    const hw = (seg * ca + w.thick * sa) / 2, hd = (seg * sa + w.thick * ca) / 2;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const cx = w.a.x + dx * t, cz = w.a.z + dz * t;
      solids.push([cx - hw, cx + hw, 0, w.height, cz - hd, cz + hd, false]);
    }
  }

  // ---- trees (instanced, fixed layout from the spec)
  const dec = spec.trees.filter((t) => t.kind === 'd');
  const con = spec.trees.filter((t) => t.kind === 'c');
  const dm = new THREE.Object3D();
  const palette = ['#2f6a46', '#3f7a4c', '#4d8150', '#6b9154', '#7a9a58'].map((c) => new THREE.Color(c));
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.32, 1, 5), material('#70533a'), dec.length + con.length);
  const crownsDec = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), material('#ffffff'), dec.length);
  const crownsCon = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6), material('#ffffff'), con.length);
  const field = new TreeField(dec, con, trunks, crownsDec, crownsCon);
  let j = 0;
  const place = (t: TreeSpec, i: number, kind: TreeKind): void => {
    dm.rotation.set(0, 0, 0);
    dm.position.set(t.x, t.h * 0.2, t.z);
    dm.scale.set(1, t.h * 0.4, 1);
    dm.updateMatrix();
    trunks.setMatrixAt(j++, dm.matrix);
    treeSolids.push([t.x, t.z, t.r * 0.75, t.h]);
    if (kind === 'd') {
      crownsDec.setMatrixAt(i, field.matrix('d', i, false));
      crownsDec.setColorAt(i, palette[i % 5] as THREE.Color);
    } else {
      crownsCon.setMatrixAt(i, field.matrix('c', i, false));
      crownsCon.setColorAt(i, palette[i % 3] as THREE.Color);
    }
  };
  dec.forEach((t, i) => place(t, i, 'd'));
  con.forEach((t, i) => place(t, i, 'c'));
  for (const m of [trunks, crownsDec, crownsCon]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  const collider = new SiteCollider(solids, treeSolids);
  return {
    group,
    roof,
    collider,
    trees: field,
    occluders,
    setScale(k: number): void {
      group.scale.setScalar(k);
      collider.scale = k;
    },
    setRoofHidden(hidden: boolean): void {
      roof.visible = !hidden;
      collider.roofHidden = hidden;
    },
  };
}
