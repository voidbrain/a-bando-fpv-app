import * as THREE from 'three';
import { type BuildingSpec, type LevelSpec, type OpeningSpec, type SiteSpec, type TreeSpec, createRandom } from '../core/site-spec';
import { SITE_DIMS } from '../core/site-dims';
import { DEFAULT_CALIBRATION, METRES_PER_DEG_LAT, SITE_ORIGIN } from '../core/constants';
import { courseDegrees } from '../core/geo';
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
    const gy0 = o.kind === 'door' ? 0 : Math.max(0.4, l.height * 0.75);
    const gy1 = Math.min(l.height, gy0 + o.h);
    if (gy0 > 0) wall(o.c - o.w / 2, o.w, gy0 / 2, gy0);
    if (gy1 < l.height) wall(o.c - o.w / 2, o.w, (gy1 + l.height) / 2, l.height - gy1);
    p = o.c + o.w / 2;
  }
  wall(p, runLen - p, l.height / 2, l.height);
}

/** Four walls of one level plus interior partitions (thin solid walls between their endpoints). */
function buildWalls(ctx: Ctx, b: BuildingSpec, l: LevelSpec, target: THREE.Object3D): void {
  for (const side of ['n', 's', 'e', 'w'] as const) {
    if (l.sides[side]) buildSide(ctx, b, l, side, target);
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
  const top = l.baseY + l.height;
  const rise = Math.max(0.5, l.roofRise);
  const rc = ctx.matFor(l.roofColor);
  if (l.roof === 'flat') {
    ctx.addBox(target, 0, top + 0.15, 0, b.length + 0.6, 0.3, b.width + 0.6, rc, false, true);
    ctx.solids.push(rotBoxLocal(ctx.at[0], ctx.at[1], b.length, b.width, ctx.rot, top, top + 0.3, true));
    return;
  }
  if (l.roof === 'gable') {
    ctx.addMesh(target, gable(b.length, b.width, rise, rc), 0, top + rise * 0.45, 0, rotBoxLocal(ctx.at[0], ctx.at[1], b.length, b.width, ctx.rot, top, top + rise, true));
    return;
  }
  // vault: n barrels across the width (local X), running along Z
  const n = Math.max(1, l.vaultCount ?? 1);
  const VW = b.length / n, VR = VW / 2, VK = l.vaultK ?? 0.58;
  for (let i = 0; i < n; i++) {
    ctx.addMesh(target, vault(b.width, VR, VK, rc), -b.length / 2 + VW / 2 + i * VW, top, 0);
  }
  ctx.solids.push(rotBoxLocal(ctx.at[0], ctx.at[1], b.length, b.width, ctx.rot, top + 0.4, top + VR * VK + 0.2, true));
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

// ---- the shipped default site ("A Bando"), expressed as a data-driven SiteSpec -------------------------

/** Local-frame metres -> WGS84, using the builtin site's geographic origin and calibration (pure math, no signals). */
const builtinGeo = (x: number, z: number): [number, number] => {
  // inverse of toLocalAt: [x,z] = [e*cos(a)+n*sin(a)+dx, e*sin(a)-n*cos(a)+dz], a = rot*RAD
  const X = x - DEFAULT_CALIBRATION.dx, Z = z - DEFAULT_CALIBRATION.dz;
  const a = DEFAULT_CALIBRATION.rot * (Math.PI / 180);
  return [SITE_ORIGIN.lat + (X * Math.sin(a) - Z * Math.cos(a)) / METRES_PER_DEG_LAT, SITE_ORIGIN.lon + (X * Math.cos(a) + Z * Math.sin(a)) / (111320 * Math.cos((SITE_ORIGIN.lat * Math.PI) / 180))];
};

/** Wall openings of one side from a list of centres: doors from the floor, small windows on a high sill. */
function rows(kind: 'door' | 'window', cs: readonly number[], w: number, h: number): OpeningSpec[] {
  return cs.map((c) => ({ kind, c, w, h }));
}

/** Evenly spaced window centres along `len`, skipping any within `avoid` distance of the given points. */
function winRow(from: number, to: number, step: number, avoid: readonly number[]): number[] {
  const out: number[] = [];
  for (let c = from; c <= to; c += step) if (avoid.every((d) => Math.abs(c - d) > 2.4)) out.push(c);
  return out;
}

/** Heading (degrees clockwise from true north) of a local-frame direction (dx, dz), for the builtin calibration. */
const builtinHeading = (dx: number, dz: number): number => courseDegrees(dx, dz, DEFAULT_CALIBRATION);

/** One tree zone of the builtin scatter: rectangular band, density, whether it fills the site interior, size scale. */
interface TreeZone {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  n: number;
  force?: boolean;
  sc?: number;
}

/**
 * The builtin tree scatter, reproduced exactly: the zones are consumed in order by one Park-Miller stream (seed 7),
 * rejected candidates still burn numbers, so regenerating with this layout yields the original positions.
 */
const BUILTIN_ZONES: readonly TreeZone[] = [
  { x0: -107, x1: 14, z0: -163, z1: -97, n: 200 },
  { x0: -213, x1: -121, z0: -114, z1: 36, n: 255 },
  { x0: -213, x1: -114, z0: 36, z1: 156, n: 110 },
  { x0: -107, x1: 64, z0: 108, z1: 168, n: 140 },
  { x0: 65, x1: 156, z0: 108, z1: 163, n: 70 },
  { x0: -150, x1: -70, z0: -20, z1: 70, n: 14, force: true },
  { x0: -71, x1: 156, z0: -142, z1: -91, n: 50, sc: 0.55 },
  { x0: 92, x1: 180, z0: -100, z1: 71, n: 60, sc: 0.55 },
  { x0: -85, x1: -28, z0: -106, z1: -88, n: 18, sc: 0.7 },
];

/** Scatter the builtin zones into TreeSpecs (deterministic; mirrors the original hand-built placement loop). */
function builtinTrees(seed: number): TreeSpec[] {
  const rnd = createRandom(seed);
  const out: TreeSpec[] = [];
  const insideSite = (x: number, z: number): boolean => x > -108 && x < 92 && z > -102 && z < 124;
  const clear = SITE_DIMS.CLEAR;
  const isInClearing = (x: number, z: number): boolean => x > clear.x0 && x < clear.x1 && z > clear.z0 && z < clear.z1;
  for (const zo of BUILTIN_ZONES) {
    for (let i = 0; i < zo.n; i++) {
      const x = zo.x0 + rnd() * (zo.x1 - zo.x0), z = zo.z0 + rnd() * (zo.z1 - zo.z0);
      if (isInClearing(x, z)) continue;
      if (!zo.force && insideSite(x, z)) continue;
      const sc = zo.sc ?? 1;
      const h = (5 + rnd() * 6) * sc, r = (1.6 + rnd() * 1.6) * sc;
      out.push({ x, z, h, r, kind: rnd() < 0.28 ? 'c' : 'd' });
    }
  }
  return out;
}

/** Meadow shrubs of the builtin scene: positions are stored scaled (as the original placed them). */
const BUILTIN_Meadow_RAW: readonly (readonly [number, number, number, number])[] = [
  [-30, -31, 2.3, 4.2], [-37.5, -33, 1.4, 3], [-31, -28, 0.8, 1.6],
  [-21.5, -27, 1, 2.6], [-24, -20, 0.9, 2], [-22, -15, 1.2, 3], [-25.5, -9, 0.8, 1.8], [-23, -5, 0.9, 2.2], [-26, 0, 0.9, 2], [-21, 2, 0.8, 1.8],
  [-45, -15, 1.1, 2.8], [-50, -22, 0.8, 1.8], [-48, -5, 0.9, 2], [-55, 8, 1, 2.4], [-42, 12, 0.8, 1.6],
  [-58, -14, 2.2, 4], [-52, 2, 1.1, 3.6], [-68, -4, 1.2, 4], [-47, 12, 2.1, 3.6], [-70, 10, 0.9, 1.8], [-60, 20, 1, 2.2],
];

function builtinMeadow(): TreeSpec[] {
  const G: TreeSpec['kind'][] = ['d', 'd', 'd', 'd'];
  const out: TreeSpec[] = [];
  const clear = SITE_DIMS.CLEAR;
  BUILTIN_Meadow_RAW.forEach((b, i) => {
    const x = b[0] * 1.42, z = b[1] * 1.42;
    if (x > clear.x0 && x < clear.x1 && z > clear.z0 && z < clear.z1) return;
    out.push({ x, z, h: b[3] * 1.25, r: b[2] * 1.25, kind: G[i % 4] as TreeSpec['kind'] });
  });
  return out;
}

/** Small houses seen on the builtin satellite screenshot. */
const BUILTIN_HOUSES: readonly (readonly [number, number, number, number, number, string])[] = [
  [-62.7, 94.5, 18, 11, 6.5, '#6e6468'],
  [68, 91.7, 16, 11.5, 6.5, '#b5683f'],
];

/**
 * The shipped site as an editable spec: store (55 × 151.76 m, four barrel vaults), annex ("house", 56 × 20 m),
 * greenhouse tunnel, two small houses, pads and roads, the exact builtin tree scatter. All values come from
 * {@link SITE_DIMS}, which was measured against Google Maps; the geometry is pure open data / own measurement.
 */
export function builtinSpec(): SiteSpec {
  const D = SITE_DIMS;
  const { BW, BL, AL, AW, GL, EXN, BX0, BX1, BZ0, BZ1, AX0, AX1, AZ0, AZ1, AX, AZ, GX0, GX1, EH, AH } = D;
  const vaultCount = 4;
  const VW = BW / vaultCount, VR = VW / 2, RISE = VR * 0.58;
  const nb = 23, ps = BL / nb;

  // west face of the store: piers every bay, lower panels except every third bay, one big full-height door in the middle
  const westDoors: OpeningSpec[] = [];
  for (let i = 0; i < nb; i++) {
    if (i % 3 === 2) westDoors.push({ kind: 'door', c: (i + 0.5) * ps, w: ps - 1, h: EH });
    else westDoors.push({ kind: 'window', c: (i + 0.5) * ps, w: ps - 1, h: 0 }); // low panel: modelled as filled wall below
  }
  // strip the pseudo-openings back out: buildSide only needs the real big doors punched through
  const mainWest = westDoors.filter((o) => o.kind === 'door');

  const dc = (AX0 + BX0) / 2; // centre of the annex's shared (south-facing) wall with the store
  const nd = [0.21, 0.5, 0.78].map((f) => AL * f); // three doors along the forest side, in annex-local coords

  const store: BuildingSpec = {
    id: 'store',
    name: 'Store',
    pos: { x: 0, z: 0 },
    rotDeg: 0,
    length: BW,
    width: BL,
    color: '#d7d0bd',
    floorColor: '#a9aaa0',
    levels: [
      {
        baseY: 0,
        height: EH,
        sides: { n: true, s: true, e: true, w: true },
        doors: { w: mainWest },
        partitions: [],
        roof: 'vault',
        roofRise: RISE,
        vaultCount,
        vaultK: 0.58,
        roofColor: '#b5683f',
      },
    ],
  };

  const annex: BuildingSpec = {
    id: 'annex',
    name: 'Annex',
    pos: { x: AX, z: AZ },
    rotDeg: 0,
    length: AL,
    width: AW,
    color: '#d7d0bd',
    levels: [
      {
        baseY: 0,
        height: AH,
        sides: { n: true, s: true, e: true, w: true },
        doors: {
          // forest side (north): 3 doors + small windows — openings measured from AX0
          n: [
            ...nd.map((c) => ({ kind: 'door' as const, c, w: 2.2, h: 2.6 })),
            ...Array.from({ length: Math.floor((AL - 4) / 3.4) + 1 }, (_, i) => AX0 + 2 + i * 3.4 - AX0)
              .filter((c) => nd.every((d) => Math.abs(c - d) > 2.4))
              .map((c) => ({ kind: 'window' as const, c, w: 1, h: 1 })),
          ],
          // east end: door with a small window above at the same spot
          e: [{ kind: 'door', c: AW / 2, w: 2.2, h: 2.6 }, { kind: 'window', c: AW / 2, w: 2.2, h: 1 }],
          // west end: the 12 m opening into the greenhouse
          w: [{ kind: 'door', c: AW / 2, w: 12, h: AH * 0.91 }],
          // shared wall with the store (south): central door + windows
          s: [
            { kind: 'door', c: dc - AX0, w: 2.4, h: 2.8 },
            ...Array.from({ length: Math.floor((BX0 - AX0 - 5) / 3.4) + 1 }, (_, i) => 2.5 + i * 3.4)
              .filter((c) => Math.abs(c - (dc - AX0)) > 2.4)
              .map((c) => ({ kind: 'window' as const, c, w: 1, h: 1 })),
          ],
        },
        partitions: [],
        roof: 'gable',
        roofRise: 3.9,
        roofColor: '#c27a55',
      },
    ],
  };

  const ghW = AW; // greenhouse width = annex depth
  const greenhouse: BuildingSpec = {
    id: 'greenhouse',
    name: 'Greenhouse',
    pos: { x: (GX0 + GX1) / 2, z: AZ },
    rotDeg: 0,
    length: GL,
    width: ghW,
    frame: 'greenhouse',
    levels: [{ baseY: 2, height: 0, sides: { n: false, s: false, e: false, w: false }, doors: {}, partitions: [], roof: 'vault', roofRise: (ghW / 2) * 0.7, vaultCount: 1, vaultK: 0.7 }],
  };

  const houses: BuildingSpec[] = BUILTIN_HOUSES.map(([cx, cz, w, d, h, rc], i) => ({
    id: `house${i + 1}`,
    name: `House ${i + 1}`,
    pos: { x: cx, z: cz },
    rotDeg: 0,
    length: w,
    width: d,
    color: i === 0 ? '#b7cfc4' : '#d7d0bd',
    levels: [{ baseY: 0, height: h, sides: { n: true, s: true, e: true, w: true }, doors: {}, partitions: [], roof: 'gable', roofRise: (d * 0.577) * 0.45, roofColor: rc }],
  }));

  const trees = [...builtinTrees(7), ...builtinMeadow()];
  // the lone cypress in front of the greenhouse (from the oblique photo)
  const clear = D.CLEAR;
  if (!(-46.9 > clear.x0 && -46.9 < clear.x1 && -63.2 > clear.z0 && -63.2 < clear.z1)) trees.push({ x: -46.9, z: -63.2, h: 12, r: 1, kind: 'c' });

  const [p1lat, p1lon] = builtinGeo(GX0, AZ0);
  const [p2lat, p2lon] = builtinGeo(BX1, BZ1);

  return {
    version: 1,
    id: 'bando-default',
    name: 'A Bando',
    createdAt: 0,
    origin: { lat: SITE_ORIGIN.lat, lon: SITE_ORIGIN.lon },
    bearingDeg: builtinHeading(1, 0),
    genScale: 1,
    groundColor: '#789b52',
    buildings: [store, annex, greenhouse, ...houses],
    pads: [
      { x: -45, z: 28, w: 34, d: 94, color: '#a9aaa0' },
      { x: 8.5, z: 90.5, w: 113, d: 29, color: '#a9aaa0' },
      { x: 55.5, z: 41.5, w: 49, d: 73, color: '#a9aaa0' },
      { x: -30, z: -143, w: 140, d: 3.5, color: '#b49b73' },
      { x: 0, z: 111, w: 360, d: 7, color: '#4a4d4b' },
      { x: -44, z: 26, w: 4, d: 4, color: '#e8c65a' },
    ],
    trees,
    seed: 7,
    extent: 240,
    droneStart: { x: -44, z: 26 },
    calibCorners: { p1: { x: GX0, z: AZ0 }, p2: { x: BX1, z: BZ1 } },
    geoCorners: { p1: { lat: p1lat, lon: p1lon }, p2: { lat: p2lat, lon: p2lon } },
  };
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
      if (l.baseY === 0) ctx.addBox(inner, 0, 0.05, 0, b.length, 0.1, b.width, floorMat, false, false);
      if (l.baseY > 0) ctx.addBox(inner, 0, l.baseY, 0, b.length, 0.2, b.width, floorMat, false, false);
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
