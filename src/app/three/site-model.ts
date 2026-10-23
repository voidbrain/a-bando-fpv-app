import { cutRect, edgesOf, slabs } from '../core/footprint';
import { buildStructure } from './structures';
import { fenceDef, postsAlong } from '../core/fences';
import { WATER_COLOR, insidePolygon, roadDef, surfaceDef } from '../core/layers';
import { BASEMENT_WALL, tunnelAxis, volumeSolids } from '../core/underground';
import { NO_SLABS, ROOFLESS, roofCells, roofRuns, ruinPieces, ruinRandom, type RuinPiece } from '../core/ruin';
import * as THREE from 'three';
import { type BuildingSpec, type LevelSpec, type RoadSpec, type SiteSpec, type SurfaceSpec, type TreeSpec, type UndergroundSpec, createRandom } from '../core/site-spec';
import { SiteCollider, type SolidBox, type TreeCylinder } from '../core/sim/collider';
import { siteGround, type SiteGround } from '../core/site-ground';
import { heightColor, heightRange, type HeightGrid } from '../core/terrain';

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
  /** How the terrain is drawn: its natural colours, coloured by height, or as a wireframe. */
  setGroundStyle(style: GroundStyle): void;
}

export type GroundStyle = 'natural' | 'height' | 'wire';

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
  /** While a ruined building is built: its level, the floor being built, and its random source. */
  ruin: { level: number; li: number; floors: number; rnd: () => number } | null;
  /** The building being built has lost its upper floor slabs (a deep ruin, or an open shell). */
  noSlabs: boolean;
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

/** One wall run as built: whole, or broken into pieces with their tops cut when the building is ruined. */
function ruinedRun(ctx: Ctx, len: number, h: number): RuinPiece[] {
  const r = ctx.ruin;
  return (r ? ruinPieces(len, h, r.level, r.li, r.floors, r.rnd) : [{ from: 0, len, cut: 0 }]).filter((p) => h - p.cut > 0.05);
}

/** The solid parts of a (ruined) wall piece `hh` high: below and above its breach, up to its broken top. [bottom, top] */
function pieceParts(p: RuinPiece, hh: number): [number, number][] {
  const top = hh - p.cut;
  const parts: [number, number][] = p.hole ? [[0, p.hole.y0], [p.hole.y1, top]] : [[0, top]];
  return parts.filter(([a, z]) => z - a > 0.05);
}

/** A collider over part of a roof (building-local centre and size), like the boxes `addBox` registers. */
function roofSolid(ctx: Ctx, x: number, z: number, w: number, d: number, y0: number, y1: number): void {
  ctx.solids.push(rotBoxLocal(x + ctx.at[0], z + ctx.at[1], w, d, ctx.rot, y0, y1, true));
}

function buildSide(ctx: Ctx, b: BuildingSpec, l: LevelSpec, side: 'n' | 's' | 'e' | 'w', target: THREE.Object3D): void {
  const runLen = side === 'n' || side === 's' ? b.length : b.width; // n and s run along the length, e and w along the width
  const acrossPos = side === 'w' ? -b.length / 2 : side === 'e' ? b.length / 2 : side === 'n' ? -b.width / 2 : b.width / 2;
  const th = 0.5;
  const wall = (from: number, len: number, y: number, hh: number): void => {
    if (len < 0.01 || hh < 0.01) return;
    const bottom = l.baseY + y - hh / 2; // y is measured from this floor's slab
    for (const r of ruinedRun(ctx, len, hh)) {
      const m = from + r.from + r.len / 2 - runLen / 2;
      for (const [a, z] of pieceParts(r, hh)) {
        const yy = bottom + (a + z) / 2;
        if (side === 'w' || side === 'e') ctx.addBox(target, acrossPos, yy, m, th, z - a, r.len, ctx.mat.wall, true, true);
        else ctx.addBox(target, m, yy, acrossPos, r.len, z - a, th, ctx.mat.wall, true, true);
      }
    }
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
      const bottom = l.baseY + y - hh / 2;
      for (const r of ruinedRun(ctx, len, hh)) {
        const m = from + r.from + r.len / 2;
        for (const [a, z] of pieceParts(r, hh)) {
          const yy = bottom + (a + z) / 2;
          if (e.axis === 'x') ctx.addBox(target, m, yy, e.at, r.len, z - a, th, ctx.mat.wall, true, true);
          else ctx.addBox(target, e.at, yy, m, th, z - a, r.len, ctx.mat.wall, true, true);
        }
      }
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

/** Battlements on top of the outer walls: merlons 0.7 m wide every 1.4 m, 0.9 m high, corners always filled. */
function buildCrenels(ctx: Ctx, b: BuildingSpec, top: number, target: THREE.Object3D): void {
  const L = b.length / 2, W = b.width / 2;
  const edges = b.footprint
    ? edgesOf(b.footprint)
    : [
        { axis: 'x' as const, at: -W, from: -L, to: L },
        { axis: 'x' as const, at: W, from: -L, to: L },
        { axis: 'z' as const, at: -L, from: -W, to: W },
        { axis: 'z' as const, at: L, from: -W, to: W },
      ];
  const h = 0.9, y = top + h / 2, th = 0.55;
  for (const e of edges) {
    const len = e.to - e.from, n = Math.max(1, Math.round(len / 1.4));
    for (let i = 0; i <= n; i++) {
      const c = e.from + (len * i) / n;
      if (e.axis === 'x') ctx.addBox(target, c, y, e.at, 0.7, h, th, ctx.mat.wall, true, true);
      else ctx.addBox(target, e.at, y, c, th, h, 0.7, ctx.mat.wall, true, true);
    }
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
  // a ruin keeps only parts of its roof (each part its own collider, so the holes can be flown through)
  const ruin = ctx.ruin?.level ?? 0;
  const rnd = ruin > 0.01 ? ruinRandom(`${b.id}:roof:${ctx.ruin?.li ?? 0}`) : Math.random;
  const runs = (len: number): { from: number; len: number }[] => roofRuns(len, ruin, rnd);
  if (b.footprint) {
    // shaped buildings: a flat roof, one slab per rectangle of the outline (each is also a collider)
    for (const s of slabs(b.footprint)) for (const r of roofCells(s.x0, s.x1, s.z0, s.z1, ruin, rnd)) ctx.addBox(target, (r.x0 + r.x1) / 2, top + 0.15, (r.z0 + r.z1) / 2, r.x1 - r.x0, 0.3, r.z1 - r.z0, rc, true, true);
    return;
  }
  if (l.roof === 'flat') {
    if (ruin > 0.01) {
      for (const r of roofCells(-b.length / 2 - 0.3, b.length / 2 + 0.3, -b.width / 2 - 0.3, b.width / 2 + 0.3, ruin, rnd)) ctx.addBox(target, (r.x0 + r.x1) / 2, top + 0.15, (r.z0 + r.z1) / 2, r.x1 - r.x0, 0.3, r.z1 - r.z0, rc, true, true);
      return;
    }
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
      const c = -across / 2 + span / 2 + i * span;
      if (ruin > 0.01) {
        for (const r of runs(run)) {
          const m = gable(r.len, span, rise, rc), off = -run / 2 + r.from + r.len / 2;
          if (turn) {
            m.rotation.y = Math.PI / 2;
            ctx.addMesh(target, m, c, top, off);
            roofSolid(ctx, c, off, span, r.len, top, top + rise);
          } else {
            ctx.addMesh(target, m, off, top, c);
            roofSolid(ctx, off, c, r.len, span, top, top + rise);
          }
        }
        continue;
      }
      const m = gable(run, span, rise, rc);
      if (turn) {
        m.rotation.y = Math.PI / 2;
        ctx.addMesh(target, m, c, top, 0);
      } else ctx.addMesh(target, m, 0, top, c);
    }
    if (ruin <= 0.01) ctx.solids.push(rotBoxLocal(ctx.at[0], ctx.at[1], b.length, b.width, ctx.rot, top, top + rise, true));
    return;
  }
  const run = turn ? b.length : b.width; // barrel length
  const across = turn ? b.width : b.length;
  const VW = across / n, VR = VW / 2, VK = l.vaultK ?? 0.58;
  for (let i = 0; i < n; i++) {
    const c = -across / 2 + VW / 2 + i * VW;
    if (ruin > 0.01) {
      for (const r of runs(run)) {
        const m = vault(r.len, VR, VK, rc), off = -run / 2 + r.from + r.len / 2;
        if (turn) {
          m.rotation.y = Math.PI / 2;
          ctx.addMesh(target, m, off, top, c);
          roofSolid(ctx, off, c, r.len, VW, top + 0.4, top + VR * VK + 0.2);
        } else {
          ctx.addMesh(target, m, c, top, off);
          roofSolid(ctx, c, off, VW, r.len, top + 0.4, top + VR * VK + 0.2);
        }
      }
      continue;
    }
    const m = vault(run, VR, VK, rc);
    if (turn) {
      m.rotation.y = Math.PI / 2;
      ctx.addMesh(target, m, 0, top, c);
    } else ctx.addMesh(target, m, c, top, 0);
  }
  if (ruin <= 0.01) ctx.solids.push(rotBoxLocal(ctx.at[0], ctx.at[1], b.length, b.width, ctx.rot, top + 0.4, top + VR * VK + 0.2, true));
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
    else if (!ctx.noSlabs) ctx.addBox(inner, cx, l.baseY, cz, w, 0.2, d, floorMat, false, false); // a deep ruin has lost its upper floors
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
function terrainMesh(g: HeightGrid, color: string, rnd: () => number, surfaces: readonly SurfaceSpec[] = [], cut: Uint8Array | null = null): THREE.Mesh {
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
  // surfaces (asphalt, gravel, sand ...) paint the vertices inside their outline
  for (const sf of surfaces) {
    const c = new THREE.Color(surfaceDef(sf.kind).color);
    const xs = sf.pts.map((q) => q.x), zs = sf.pts.map((q) => q.z);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - g.x0) / (step * g.cell))), i1 = Math.min(nx - 1, Math.ceil((Math.max(...xs) - g.x0) / (step * g.cell)));
    const j0 = Math.max(0, Math.floor((Math.min(...zs) - g.z0) / (step * g.cell))), j1 = Math.min(nz - 1, Math.ceil((Math.max(...zs) - g.z0) / (step * g.cell)));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (!insidePolygon(sf.pts, g.x0 + i * step * g.cell, g.z0 + j * step * g.cell)) continue;
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
      // the ground is cut where an underground volume passes through it: drop the cells touching a cut vertex
      if (cut) {
        const gi = j * step * g.nx + i * step, s1 = step, s2 = step * g.nx;
        if (cut[gi] || cut[gi + s1] || cut[gi + s2] || cut[gi + s1 + s2]) continue;
      }
      const a = j * nx + i, b = a + 1, c = a + nx, e = c + 1;
      idx[n++] = a; idx[n++] = c; idx[n++] = b;
      idx[n++] = b; idx[n++] = c; idx[n++] = e;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx.subarray(0, n), 1));
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

/**
 * The ground around the terrain grid, out to ±`outer` metres: every edge vertex is carried straight outwards at its own
 * height, the corners at the corner's height, so a hillside does not end in a wall (the grid edge is not forced down).
 */
function skirtMesh(g: HeightGrid, outer: number, mat: THREE.Material): THREE.Mesh {
  const pos: number[] = [], idx: number[] = [];
  const x1 = g.x0 + (g.nx - 1) * g.cell, z1 = g.z0 + (g.nz - 1) * g.cell;
  const at = (i: number, j: number): number => g.h[j * g.nx + i]!;
  const step = Math.max(1, Math.round(4 / g.cell)); // a vertex every ~4 m is plenty out here
  /** A strip between `inner` points on the grid edge and the same points pushed out to the outer square. */
  const strip = (inner: [number, number, number][], push: (x: number, z: number) => [number, number]): void => {
    const base = pos.length / 3;
    for (const [x, y, z] of inner) {
      const [ox, oz] = push(x, z);
      pos.push(x, y - 0.02, z, ox, y - 0.02, oz);
    }
    for (let k = 0; k + 1 < inner.length; k++) {
      const a = base + k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  const along = (n: number): number[] => {
    const out: number[] = [];
    for (let k = 0; k < n - 1; k += step) out.push(k);
    out.push(n - 1);
    return out;
  };
  const xs = along(g.nx), zs = along(g.nz);
  strip(xs.map((i): [number, number, number] => [g.x0 + i * g.cell, at(i, 0), g.z0]), (x) => [x, -outer]); // north
  strip(xs.map((i): [number, number, number] => [g.x0 + i * g.cell, at(i, g.nz - 1), z1]).reverse(), (x) => [x, outer]); // south
  strip(zs.map((j): [number, number, number] => [g.x0, at(0, j), g.z0 + j * g.cell]).reverse(), (_x, z) => [-outer, z]); // west
  strip(zs.map((j): [number, number, number] => [x1, at(g.nx - 1, j), g.z0 + j * g.cell]), (_x, z) => [outer, z]); // east
  // the four corners: a flat square at the corner's height
  const corner = (x: number, z: number, y: number, ox: number, oz: number): void => {
    const b = pos.length / 3;
    pos.push(x, y - 0.02, z, ox, y - 0.02, z, ox, y - 0.02, oz, x, y - 0.02, oz);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  corner(g.x0, g.z0, at(0, 0), -outer, -outer);
  corner(x1, g.z0, at(g.nx - 1, 0), outer, -outer);
  corner(x1, z1, at(g.nx - 1, g.nz - 1), outer, outer);
  corner(g.x0, z1, at(0, g.nz - 1), -outer, outer);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  (m.material as THREE.Material).side = THREE.DoubleSide;
  m.receiveShadow = true;
  return m;
}

/** A flat polygon (site metres) as a horizontal mesh at y = 0. */
function flatShape(pts: readonly { x: number; z: number }[], mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape(pts.map((q) => new THREE.Vector2(q.x, -q.z)));
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2); // (x, y) -> (x, 0, -y): back to x east, z south
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

/** A road as a ribbon laid on the ground: a cross-section every ~2 m, 6 cm above the (levelled) ground. */
function roadMesh(ground: SiteGround, r: RoadSpec, order: number): THREE.Mesh {
  const pos: number[] = [], idx: number[] = [];
  const half = r.width / 2;
  const add = (x: number, z: number, nx: number, nz: number): void => {
    const y = ground.at(x, z) + 0.06;
    pos.push(x + nx * half, y, z + nz * half, x - nx * half, y, z - nz * half);
  };
  for (let i = 1; i < r.pts.length; i++) {
    const a = r.pts[i - 1]!, b = r.pts[i]!;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const nx = -dz / len, nz = dx / len;
    const n = Math.max(1, Math.ceil(len / 2));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) add(a.x + (dx * k) / n, a.z + (dz * k) / n, nx, nz);
  }
  for (let v = 0; v + 3 < pos.length / 3; v += 2) idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const color = r.surface ? surfaceDef(r.surface).color : roadDef(r.kind).color;
  const m = new THREE.Mesh(geo, material(color, { side: THREE.DoubleSide, ...(ground.grid ? {} : { depthWrite: false, depthTest: false }) }));
  m.receiveShadow = true;
  if (!ground.grid) m.renderOrder = order;
  return m;
}

const UNDER_MAT = new THREE.MeshStandardMaterial({ color: '#6b6d66', roughness: 0.95, side: THREE.DoubleSide });

/** One underground volume as meshes: a slab of its outline at the floor, then walls and a flat ceiling, a pipe or a vault. */
function buildUnderground(v: UndergroundSpec): THREE.Group {
  const out = new THREE.Group();
  const slab = (y: number): void => {
    const shape = new THREE.Shape(v.outline.map((q) => new THREE.Vector2(q.x, -q.z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: v.wall, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2); // extruded along +y from y = 0
    const m = new THREE.Mesh(geo, UNDER_MAT);
    m.position.y = y;
    m.receiveShadow = true;
    out.add(m);
  };
  slab(v.floor - v.wall);
  const axis = tunnelAxis(v);
  const h = v.ceiling - v.floor;
  if (axis && v.shape !== 'box') {
    const dx = axis.b.x - axis.a.x, dz = axis.b.z - axis.a.z, len = Math.hypot(dx, dz);
    const ang = -Math.atan2(dz, dx);
    if (v.shape === 'pipe') {
      const r = Math.min(axis.width, h) / 2 + v.wall / 2;
      const g = new THREE.CylinderGeometry(r, r, len, 20, 1, true);
      g.rotateZ(Math.PI / 2); // along x
      const m = new THREE.Mesh(g, UNDER_MAT);
      m.position.set((axis.a.x + axis.b.x) / 2, v.floor + r - v.wall / 2, (axis.a.z + axis.b.z) / 2);
      m.rotation.y = ang;
      out.add(m);
    } else {
      // vault: straight walls up to the springing line, a half cylinder over them
      const r = axis.width / 2, wallH = Math.max(0.3, h - r);
      for (const side of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(len, wallH, v.wall), UNDER_MAT);
        const off = side * (r + v.wall / 2); // along the tunnel's normal (-dz, dx) / len
        w.position.set((axis.a.x + axis.b.x) / 2 + (-dz / len) * off, v.floor + wallH / 2, (axis.a.z + axis.b.z) / 2 + (dx / len) * off);
        w.rotation.y = ang;
        out.add(w);
      }
      const g = new THREE.CylinderGeometry(r + v.wall / 2, r + v.wall / 2, len, 16, 1, true, 0, Math.PI);
      g.rotateZ(Math.PI / 2);
      g.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(g, UNDER_MAT);
      m.position.set((axis.a.x + axis.b.x) / 2, v.floor + wallH, (axis.a.z + axis.b.z) / 2);
      m.rotation.y = ang;
      out.add(m);
    }
  } else {
    for (let i = 0; i < v.outline.length; i++) {
      const a = v.outline[i]!, b = v.outline[(i + 1) % v.outline.length]!;
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const w = new THREE.Mesh(new THREE.BoxGeometry(len, h + 2 * v.wall, v.wall), UNDER_MAT);
      w.position.set((a.x + b.x) / 2, (v.floor + v.ceiling) / 2, (a.z + b.z) / 2);
      w.rotation.y = -Math.atan2(dz, dx);
      w.castShadow = true;
      out.add(w);
    }
    slab(v.ceiling);
  }
  if (v.water) {
    const shape = new THREE.Shape(v.outline.map((q) => new THREE.Vector2(q.x, -q.z)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: WATER_COLOR, transparent: true, opacity: 0.8 }));
    m.position.y = v.floor + v.water;
    out.add(m);
  }
  return out;
}

/**
 * A basement: walls along every edge of the outline from the ground floor slab down `height` metres, and a floor slab.
 * Building-local (the group carries the position, turn and pad height); the outline's edges are axis-aligned there.
 */
function buildBasement(ctx: Ctx, b: BuildingSpec, target: THREE.Object3D, floorMat: THREE.Material): void {
  const h = Math.min(12, Math.max(2, b.basement!.height)), t = BASEMENT_WALL;
  const poly = b.footprint ?? [{ x: -b.length / 2, z: -b.width / 2 }, { x: b.length / 2, z: -b.width / 2 }, { x: b.length / 2, z: b.width / 2 }, { x: -b.length / 2, z: b.width / 2 }];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const along = Math.abs(q.x - p.x) > Math.abs(q.z - p.z);
    const len = along ? Math.abs(q.x - p.x) : Math.abs(q.z - p.z);
    if (len < 0.05) continue;
    ctx.addBox(target, (p.x + q.x) / 2, -h / 2, (p.z + q.z) / 2, along ? len + t : t, h, along ? t : len + t, ctx.mat.conc, true, false);
  }
  for (const r of b.footprint ? slabs(b.footprint) : [{ x0: -b.length / 2, z0: -b.width / 2, x1: b.length / 2, z1: b.width / 2 }]) {
    ctx.addBox(target, (r.x0 + r.x1) / 2, -h - t / 2, (r.z0 + r.z1) / 2, r.x1 - r.x0, t, r.z1 - r.z0, floorMat, true, false);
  }
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
  let terrain: THREE.Mesh | null = null;

  const mats: Record<string, THREE.MeshStandardMaterial> = {};
  const ctx: Ctx = {
    ruin: null,
    noSlabs: false,
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
    terrain = terrainMesh(g, spec.groundColor, rnd, spec.surfaces, ground.cut);
    group.add(terrain);
    // around the grid the ground carries on at the height of its edge, out to the site's extent
    const outer = spec.extent * 1.1;
    if (outer > Math.min(-g.x0, -g.z0)) group.add(skirtMesh(g, outer, material(spec.groundColor)));
    for (const pd of spec.pads) group.add(drapedPad(ground, pd.x, pd.z, pd.w, pd.d, pd.rotDeg ?? 0, material(pd.color ?? '#a9aaa0')));
    for (const r of spec.roads ?? []) group.add(roadMesh(ground, r, 0));
    const start = new THREE.Mesh(new THREE.BoxGeometry(4, 0.04, 4), material('#e8c65a'));
    start.position.set(spec.droneStart.x, ground.start + 0.2, spec.droneStart.z);
    start.receiveShadow = true;
    group.add(start);
  } else if (!opts.bare) {
    // ---- ground + meadow patches (patches ignore depth; everything drawn after them covers them)
    const grass = material(spec.groundColor);
    const field = new THREE.Mesh(new THREE.BoxGeometry(spec.extent * 2.2, 1, spec.extent * 2.2), grass);
    field.position.set(0, -0.5, 0);
    field.receiveShadow = true;
    field.renderOrder = GROUND_ORDER;
    group.add(field);
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
    // flat ground: surfaces and roads are decals drawn after the meadow patches
    for (const sf of spec.surfaces ?? []) {
      const m = flatShape(sf.pts, material(surfaceDef(sf.kind).color, { depthWrite: false, depthTest: false }));
      m.position.y = 0.012;
      m.renderOrder = order++;
      group.add(m);
    }
    for (const r of spec.roads ?? []) group.add(roadMesh(ground, r, order++));
    const start = new THREE.Mesh(new THREE.BoxGeometry(4, 0.04, 4), material('#e8c65a'));
    start.position.set(spec.droneStart.x, 0.2, spec.droneStart.z);
    start.receiveShadow = true;
    group.add(start);
  }
  // ---- water: a flat, see-through surface at each basin's level (the ground under it is dug when there is a terrain)
  const waterMat = new THREE.MeshStandardMaterial({ color: WATER_COLOR, transparent: true, opacity: 0.78, roughness: 0.15, metalness: 0.1 });
  if (!opts.bare) {
    (spec.waters ?? []).forEach((w, i) => {
      const m = flatShape(w.pts, waterMat);
      m.position.y = ground.grid ? (ground.water[i] ?? 0) : 0.03;
      m.userData['pick'] = { kind: 'water', i };
      group.add(m);
    });
  }

  // ---- underground volumes: walls, floor and ceiling (a pipe or a vault for straight tunnels), solid for the drone
  for (const v of opts.bare ? [] : (spec.underground ?? [])) {
    const g = buildUnderground(v);
    g.userData['pick'] = { kind: 'underground', id: v.id };
    group.add(g);
    solids.push(...volumeSolids(v));
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
    const baseWall = ctx.mat.wall;
    if (b.color) ctx.mat.wall = ctx.matFor(b.color); // the building's own wall colour
    const ruin = Math.min(1, Math.max(0, b.ruin ?? 0));
    const open = !b.frame && (!!b.roofless || ruin >= ROOFLESS); // no roof left
    ctx.noSlabs = !b.frame && (!!b.roofless || ruin >= NO_SLABS);
    for (const [li, l] of b.levels.entries()) {
      ctx.ruin = ruin > 0.01 && !b.frame ? { level: ruin, li, floors: b.levels.length, rnd: ruinRandom(`${b.id}:${li}`) } : null;
      buildFloorAndColumns(ctx, b, l, inner, floorMat);
      if (b.frame === 'greenhouse') {
        buildGreenhouse(ctx, b, inner, localRoof);
        break;
      }
      buildWalls(ctx, b, l, inner);
      if (!open) buildRoof(ctx, b, l, localRoof); // a deep ruin or an open shell has lost its roof
    }
    const last = b.levels[b.levels.length - 1];
    if (b.crenels && last && !b.frame && (open || last.roof === 'flat' || last.roof === 'none' || !!b.footprint)) buildCrenels(ctx, b, last.baseY + last.height, inner);
    ctx.ruin = null;
    ctx.noSlabs = false;
    ctx.mat.wall = baseWall;
    if (b.basement && !b.frame) buildBasement(ctx, b, inner, floorMat);
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
    const def = fenceDef(w.material);
    const pick = { kind: 'fence', i: spec.walls?.indexOf(w) ?? 0 };
    const panel = def.mesh ? new THREE.MeshStandardMaterial({ color: w.color ?? def.color, transparent: true, opacity: 0.35, roughness: 0.6, metalness: 0.4, depthWrite: false }) : material(w.color ?? def.color);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, wh, w.thick), panel);
    m.position.set((w.a.x + w.b.x) / 2, y0 + wh / 2, (w.a.z + w.b.z) / 2);
    m.rotation.y = -Math.atan2(dz, dx);
    m.castShadow = !def.mesh;
    m.receiveShadow = true;
    m.userData['pick'] = pick;
    group.add(m);
    // posts (concrete, wood, metal, chain-link): a little thicker than the panel, in a darker shade of it
    const postMat = material(def.mesh ? '#6f787a' : (w.color ?? def.color));
    for (const t of postsAlong(len, w.material)) {
      // each post stands on the ground under it and reaches the top of the panel
      const py = ground.at(w.a.x + dx * t, w.a.z + dz * t), ph = y0 + wh + 0.1 - py;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, ph, Math.max(0.12, w.thick + 0.06)), postMat);
      post.position.set(w.a.x + dx * t, py + ph / 2, w.a.z + dz * t);
      post.rotation.y = m.rotation.y;
      post.castShadow = true;
      post.userData['pick'] = pick;
      group.add(post);
    }
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

  const collider = new SiteCollider(solids, treeSolids, ground.grid, opts.bare ? [] : (spec.waters ?? []).map((w, i) => ({ pts: w.pts, level: ground.grid ? (ground.water[i] ?? 0) : 0.03 })), opts.bare ? [] : ground.vols);
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
    setGroundStyle(style: GroundStyle): void {
      if (!terrain || !ground.grid) return;
      const col = terrain.geometry.getAttribute('color') as THREE.BufferAttribute;
      const pos = terrain.geometry.getAttribute('position') as THREE.BufferAttribute;
      const natural = (terrain.userData['natural'] ??= (col.array as Float32Array).slice()) as Float32Array;
      if (style === 'height') {
        const { lo, hi } = heightRange(ground.grid);
        for (let i = 0; i < pos.count; i++) col.setXYZ(i, ...heightColor(pos.getY(i), lo, hi));
      } else (col.array as Float32Array).set(natural);
      col.needsUpdate = true;
      (terrain.material as THREE.MeshStandardMaterial).wireframe = style === 'wire';
    },
  };
}
