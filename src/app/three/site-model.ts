import { cutRect, edgesOf, slabs } from '../core/footprint';
import { buildStructure } from './structures';
import * as THREE from 'three';
import { type BuildingSpec, type LevelSpec, type SiteSpec, type TreeSpec, createRandom } from '../core/site-spec';
import { SiteCollider, type SolidBox, type TreeCylinder } from '../core/sim/collider';
import { siteGround, type SiteGround } from '../core/site-ground';
import type { HeightGrid } from '../core/terrain';

export type TreeKind = 'd' | 'c';

/** Everything built for the site: the scalable group, collision data and the pieces other systems manipulate. */
export interface SiteModel {
  /** All site geometry. Scaled as one when the user resizes the model. */
  group: THREE.Group;
  /** Roofs (hidden together by the "Hide roof" toggle). */
  roof: THREE.Group;
  collider: SiteCollider;
  /** The ground everything stands on (flat when the spec has no terrain). */
  ground: SiteGround;
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
    /** Ground height under each tree (same order as `dec` / `con`). */
    readonly decY: readonly number[] = [],
    readonly conY: readonly number[] = [],
  ) {}

  matrix(kind: TreeKind, i: number, trunk: boolean): THREE.Matrix4 {
    const t = (kind === 'd' ? this.dec : this.con)[i] as TreeSpec;
    const y = (kind === 'd' ? this.decY : this.conY)[i] ?? 0;
    const o = this.tmp;
    if (trunk) {
      o.position.set(t.x, y + t.h * 0.2, t.z);
      o.scale.set(1, t.h * 0.4, 1);
    } else if (kind === 'd') {
      o.position.set(t.x, y + t.h * 0.4 + t.r * 0.7, t.z);
      o.scale.set(t.r, t.r * 1.15, t.r);
    } else {
      o.position.set(t.x, y + t.h * 0.65, t.z);
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
/**
 * A gable roof: a triangular prism whose ridge runs along local x (length `w`), spanning `d` across z. Its base is at
 * y = 0 (the top of the walls, 30 cm overhang each side) and its apex at y = `rise`, so place it at the wall top.
 */
function gable(w: number, d: number, rise: number, mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2 - 0.3, 0);
  shape.lineTo(d / 2 + 0.3, 0);
  shape.lineTo(0, rise);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: w + 0.8, bevelEnabled: false });
  g.translate(0, 0, -(w + 0.8) / 2); // centred along the ridge
  g.rotateY(Math.PI / 2); // the extrusion (z) becomes the ridge direction (x)
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Wall strips of one side with openings punched out (doors from the floor, windows on a high sill). */
/** The leaf of a closed door / the pane of a closed window, solid for the drone. Open ones are just the hole. */
function openingLeaf(ctx: Ctx, target: THREE.Object3D, l: LevelSpec, o: { kind: 'door' | 'window'; w: number; h: number; sill?: number }, along: number, across: number, alongX: boolean): void {
  const gy0 = o.kind === 'door' ? 0 : Math.min(l.height - 0.2, o.sill ?? Math.max(0.4, l.height * 0.75));
  const h = Math.min(l.height - gy0, o.h);
  const mat = o.kind === 'door' ? material('#7a5a3d') : material('#9ec7d8', { transparent: true, opacity: 0.4, roughness: 0.1 });
  const y = l.baseY + gy0 + h / 2;
  if (alongX) ctx.addBox(target, along, y, across, o.w, h, 0.12, mat, true, o.kind === 'door');
  else ctx.addBox(target, across, y, along, 0.12, h, o.w, mat, true, o.kind === 'door');
}

function buildSide(ctx: Ctx, b: BuildingSpec, l: LevelSpec, side: 'n' | 's' | 'e' | 'w', target: THREE.Object3D): void {
  const runLen = side === 'n' || side === 's' ? b.length : b.width; // n and s run along the length, e and w along the width
  const acrossPos = side === 'w' ? -b.length / 2 : side === 'e' ? b.length / 2 : side === 'n' ? -b.width / 2 : b.width / 2;
  const th = 0.5;
  const wall = (from: number, len: number, y: number, hh: number): void => {
    if (len < 0.01 || hh < 0.01) return;
    const m = from + len / 2 - runLen / 2;
    const yy = l.baseY + y; // y is measured from this floor's slab
    if (side === 'w' || side === 'e') ctx.addBox(target, acrossPos, yy, m, th, hh, len, ctx.mat.wall, true, true);
    else ctx.addBox(target, m, yy, acrossPos, len, hh, th, ctx.mat.wall, true, true);
  };
  let p = 0;
  for (const o of (l.doors[side] ?? []).slice().sort((x, y) => x.c - y.c)) {
    wall(p, o.c - o.w / 2 - p, l.height / 2, l.height);
    const gy0 = o.kind === 'door' ? 0 : Math.min(l.height - 0.2, o.sill ?? Math.max(0.4, l.height * 0.75));
    const gy1 = Math.min(l.height, gy0 + o.h);
    if (gy0 > 0) wall(o.c - o.w / 2, o.w, gy0 / 2, gy0);
    if (gy1 < l.height) wall(o.c - o.w / 2, o.w, (gy1 + l.height) / 2, l.height - gy1);
    if (o.closed) openingLeaf(ctx, target, l, o, o.c - runLen / 2, acrossPos, side === 'n' || side === 's');
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
      const yy = l.baseY + y;
      if (e.axis === 'x') ctx.addBox(target, m, yy, e.at, len, hh, th, ctx.mat.wall, true, true);
      else ctx.addBox(target, e.at, yy, m, th, hh, len, ctx.mat.wall, true, true);
    };
    let p = e.from - th / 2;
    for (const { o, c } of ops) {
      const a = Math.max(p, c - o.w / 2), z = Math.min(e.to + th / 2, c + o.w / 2);
      wall(p, a, l.height / 2, l.height);
      const gy0 = o.kind === 'door' ? 0 : Math.min(l.height - 0.2, o.sill ?? Math.max(0.4, l.height * 0.75));
      const gy1 = Math.min(l.height, gy0 + o.h);
      if (gy0 > 0) wall(a, z, gy0 / 2, gy0);
      if (gy1 < l.height) wall(a, z, (gy1 + l.height) / 2, l.height - gy1);
      if (o.closed) openingLeaf(ctx, target, l, o, c, e.at, e.axis === 'x');
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
  const li = Math.max(0, b.levels.indexOf(l));
  l.partitions.forEach(([a, c], pi) => {
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    if (len < 0.3) return;
    const mx = (a.x + c.x) / 2 - b.length / 2, mz = (a.z + c.z) / 2 - b.width / 2;
    const my = l.baseY + l.height / 2;
    const m = Math.abs(a.x - c.x) < 0.01 ? ctx.addBox(target, mx, my, mz, 0.3, l.height, len, ctx.mat.wall, true, true) : ctx.addBox(target, mx, my, mz, len, l.height, 0.3, ctx.mat.wall, true, true);
    m.userData['pick'] = { kind: 'wall', id: b.id, li, i: pi };
  });
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
        ctx.addMesh(target, m, c, top, 0);
      } else ctx.addMesh(target, m, 0, top, c);
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
  const li = Math.max(0, b.levels.indexOf(l));
  (l.columns ?? []).forEach((c, ci) => {
    const cx = c.x - L / 2, cz = c.z - W / 2, y = l.baseY + l.height / 2;
    const tag = { kind: 'column', id: b.id, li, i: ci }; // what a click on it in the editor selects
    if (c.round) {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(c.size / 2, c.size / 2, l.height, 14), colMat);
      cyl.castShadow = true;
      cyl.receiveShadow = true;
      cyl.userData['pick'] = tag;
      ctx.addMesh(inner, cyl, cx, y, cz);
      ctx.addBox(inner, cx, y, cz, c.size, l.height, c.size, colMat, true, false).visible = false; // the collision box
    } else ctx.addBox(inner, cx, y, cz, c.size, l.height, c.size, colMat, true, true).userData['pick'] = tag;
  });
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

/** Raise collider boxes / cylinders added from index `from` on by `dy` (an element standing on the terrain). */
function liftSolids(solids: SolidBox[], from: number, dy: number): void {
  if (!dy) return;
  for (let i = from; i < solids.length; i++) {
    const b = solids[i]!;
    solids[i] = [b[0], b[1], b[2] + dy, b[3] + dy, b[4], b[5], b[6]];
  }
}
const liftCylinder = (c: TreeCylinder, dy: number): TreeCylinder => (dy ? [c[0], c[1], c[2], c[3] + dy, (c[4] ?? 0) + dy] : c);

const PATCH_COLORS = ['#6f9350', '#86a35a', '#8a8656', '#7d7a52', '#98a262', '#9a8a5c'];

/**
 * The terrain as one mesh (a vertex per grid point, or every other one on a big grid), coloured like the old meadow:
 * the ground colour with the same seeded patches baked into the vertex colours, so they follow the slopes.
 */
function terrainMesh(g: HeightGrid, color: string, rnd: () => number): THREE.Mesh {
  const step = g.nx * g.nz > 250_000 ? 2 : 1;
  const nx = Math.floor((g.nx - 1) / step) + 1, nz = Math.floor((g.nz - 1) / step) + 1;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const base = new THREE.Color(color);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i, gi = (j * step) * g.nx + i * step;
      pos[k * 3] = g.x0 + i * step * g.cell;
      pos[k * 3 + 1] = g.h[gi]!;
      pos[k * 3 + 2] = g.z0 + j * step * g.cell;
      col[k * 3] = base.r;
      col[k * 3 + 1] = base.g;
      col[k * 3 + 2] = base.b;
    }
  }
  const w = (nx - 1) * step * g.cell, d = (nz - 1) * step * g.cell;
  const pc = PATCH_COLORS.map((c) => new THREE.Color(c));
  for (let p = 0; p < 300; p++) {
    const r = 3 + rnd() * 13;
    rnd(); // the old decal's rotation: keeps the patch layout of the flat ground
    const cx = g.x0 + rnd() * w, cz = g.z0 + rnd() * d;
    const c = pc[p % 6]!;
    const i0 = Math.max(0, Math.floor((cx - r - g.x0) / (step * g.cell))), i1 = Math.min(nx - 1, Math.ceil((cx + r - g.x0) / (step * g.cell)));
    const j0 = Math.max(0, Math.floor((cz - r - g.z0) / (step * g.cell))), j1 = Math.min(nz - 1, Math.ceil((cz + r - g.z0) / (step * g.cell)));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (Math.hypot(g.x0 + i * step * g.cell - cx, g.z0 + j * step * g.cell - cz) > r) continue;
        const k = (j * nx + i) * 3;
        col[k] = c.r;
        col[k + 1] = c.g;
        col[k + 2] = c.b;
      }
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let n = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, e = c + 1;
      idx[n++] = a; idx[n++] = c; idx[n++] = b;
      idx[n++] = b; idx[n++] = c; idx[n++] = e;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  m.receiveShadow = true;
  return m;
}

/** A flat rectangle laid on the terrain (a road pad), subdivided every ~2 m so it follows the slopes. */
function drapedPad(ground: SiteGround, x: number, z: number, w: number, d: number, rotDeg: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(w, d, Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(d / 2)));
  geo.rotateX(-Math.PI / 2);
  const a = (-rotDeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const p = geo.attributes['position'] as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const lx = p.getX(i), lz = p.getZ(i);
    const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
    p.setXYZ(i, wx, ground.at(wx, wz) + 0.08, wz);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

/** Build the whole site from a {@link SiteSpec}. Deterministic: the same spec always produces the same scene. */
export function buildSiteFromSpec(spec: SiteSpec, opts: { bare?: boolean } = {}): SiteModel {
  const group = new THREE.Group();
  const roof = new THREE.Group();
  group.add(roof);
  const solids: SolidBox[] = [];
  const treeSolids: TreeCylinder[] = [];
  const occluders: THREE.Mesh[] = [];
  const rnd = createRandom(spec.seed);
  const ground = opts.bare ? siteGround({ ...spec, terrain: undefined }) : siteGround(spec);

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

  if (!opts.bare && ground.grid) {
    // ---- terrain: the height grid, flat ground around it, roads laid on it
    const g = ground.grid;
    group.add(terrainMesh(g, spec.groundColor, rnd));
    const outer = spec.extent * 1.1, gx = -g.x0, gz = -g.z0;
    const grass = material(spec.groundColor);
    if (outer > Math.min(gx, gz)) {
      const ring: [number, number, number, number][] = [
        [0, -(outer + gz) / 2, outer * 2, outer - gz],
        [0, (outer + gz) / 2, outer * 2, outer - gz],
        [-(outer + gx) / 2, 0, outer - gx, gz * 2],
        [(outer + gx) / 2, 0, outer - gx, gz * 2],
      ];
      for (const [x, z, w, d] of ring) {
        if (w <= 0 || d <= 0) continue;
        const o = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), grass);
        o.position.set(x, -0.5, z);
        o.receiveShadow = true;
        group.add(o);
      }
    }
    for (const pd of spec.pads) group.add(drapedPad(ground, pd.x, pd.z, pd.w, pd.d, pd.rotDeg ?? 0, material(pd.color ?? '#a9aaa0')));
    const start = new THREE.Mesh(new THREE.BoxGeometry(4, 0.04, 4), material('#e8c65a'));
    start.position.set(spec.droneStart.x, ground.start + 0.2, spec.droneStart.z);
    start.receiveShadow = true;
    group.add(start);
  } else if (!opts.bare) {
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
  }

  // ---- buildings
  for (const b of spec.buildings) {
    const inner = new THREE.Group();
    inner.userData['pick'] = { kind: 'building', id: b.id }; // what a click on it in the 3D editor selects
    const by = ground.building.get(b.id) ?? 0;
    const firstSolid = solids.length;
    inner.position.set(b.pos.x, by, b.pos.z);
    inner.rotation.y = (-b.rotDeg * Math.PI) / 180;
    group.add(inner);
    const localRoof = new THREE.Group();
    localRoof.userData['pick'] = { kind: 'building', id: b.id };
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
    liftSolids(solids, firstSolid, by);
  }

  // ---- free-standing walls / fences
  for (const w of spec.walls ?? []) {
    const dx = w.b.x - w.a.x, dz = w.b.z - w.a.z, len = Math.hypot(dx, dz);
    if (len < 0.3) continue;
    // on a slope the wall starts at the lowest ground along it and keeps its height above the highest
    const ys = [0, 0.25, 0.5, 0.75, 1].map((t) => ground.at(w.a.x + dx * t, w.a.z + dz * t));
    const y0 = Math.min(...ys), wh = w.height + Math.max(...ys) - y0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, wh, w.thick), material(w.color ?? '#b9b2a2'));
    m.position.set((w.a.x + w.b.x) / 2, y0 + wh / 2, (w.a.z + w.b.z) / 2);
    m.rotation.y = -Math.atan2(dz, dx);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData['pick'] = { kind: 'fence', i: spec.walls?.indexOf(w) ?? 0 };
    group.add(m);
    // collision: a staircase of small boxes along the wall (the collider only knows axis-aligned boxes)
    const n = Math.max(1, Math.ceil(len / 1.0));
    const seg = len / n, ca = Math.abs(dx / len), sa = Math.abs(dz / len);
    const hw = (seg * ca + w.thick * sa) / 2, hd = (seg * sa + w.thick * ca) / 2;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const cx = w.a.x + dx * t, cz = w.a.z + dz * t;
      solids.push([cx - hw, cx + hw, y0, y0 + wh, cz - hd, cz + hd, false]);
    }
  }

  // ---- towers and bridges
  for (const st of spec.structures ?? []) {
    const built = buildStructure(st);
    const sy = ground.at(st.x, st.z);
    built.object.userData['pick'] = { kind: 'structure', id: st.id };
    built.object.position.y += sy;
    group.add(built.object);
    const firstSolid = solids.length;
    solids.push(...built.solids);
    liftSolids(solids, firstSolid, sy);
    treeSolids.push(...built.cylinders.map((c) => liftCylinder(c, sy)));
  }

  // ---- trees (instanced, fixed layout from the spec)
  const dec = spec.trees.filter((t) => t.kind === 'd');
  const con = spec.trees.filter((t) => t.kind === 'c');
  const dm = new THREE.Object3D();
  const palette = ['#2f6a46', '#3f7a4c', '#4d8150', '#6b9154', '#7a9a58'].map((c) => new THREE.Color(c));
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.32, 1, 5), material('#70533a'), dec.length + con.length);
  const crownsDec = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), material('#ffffff'), dec.length);
  const crownsCon = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6), material('#ffffff'), con.length);
  const decY = dec.map((t) => ground.at(t.x, t.z)), conY = con.map((t) => ground.at(t.x, t.z));
  const field = new TreeField(dec, con, trunks, crownsDec, crownsCon, decY, conY);
  let j = 0;
  const place = (t: TreeSpec, i: number, kind: TreeKind): void => {
    const ty = (kind === 'd' ? decY : conY)[i] ?? 0;
    dm.rotation.set(0, 0, 0);
    dm.position.set(t.x, ty + t.h * 0.2, t.z);
    dm.scale.set(1, t.h * 0.4, 1);
    dm.updateMatrix();
    trunks.setMatrixAt(j++, dm.matrix);
    treeSolids.push(ty ? [t.x, t.z, t.r * 0.75, ty + t.h, ty] : [t.x, t.z, t.r * 0.75, t.h]);
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

  const collider = new SiteCollider(solids, treeSolids, ground.grid);
  return {
    group,
    roof,
    collider,
    ground,
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
