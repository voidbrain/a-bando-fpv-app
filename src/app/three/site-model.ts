import * as THREE from 'three';
import { SITE_DIMS, isInClearing } from '../core/site-dims';
import { SiteCollider, type SolidBox, type TreeCylinder } from '../core/sim/collider';

/** Deciduous / conifer description: [x, z, height, radius]. */
export type TreeSpec = readonly [number, number, number, number];
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

  private matrix(kind: TreeKind, i: number, trunk: boolean): THREE.Matrix4 {
    const [x, z, h, r] = (kind === 'd' ? this.dec : this.con)[i] as TreeSpec;
    const o = this.tmp;
    if (trunk) {
      o.position.set(x, h * 0.2, z);
      o.scale.set(1, h * 0.4, 1);
    } else if (kind === 'd') {
      o.position.set(x, h * 0.4 + r * 0.7, z);
      o.scale.set(r, r * 1.15, r);
    } else {
      o.position.set(x, h * 0.65, z);
      o.scale.set(r * 0.9, h * 0.8, r * 0.9);
    }
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

/** Park-Miller generator: the tree layout depends on its exact sequence, so it is part of the scene definition. */
function createRandom(seed = 7): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

interface Opening {
  a: number;
  b: number;
  /** Gaps (y0, y1) in the opening that stay empty (door / window), the rest is filled. */
  g: [number, number][];
}

/**
 * Build the whole site from the real measured dimensions (see {@link SITE_DIMS}): store with four barrel vaults,
 * annex ("house") with doors and windows, torn greenhouse tunnel, two small houses, hardstanding, road and 800+ trees.
 * Walls are built from boxes with real openings, so the drone can fly through doors and windows.
 */
export function buildSiteModel(): SiteModel {
  const D = SITE_DIMS;
  const group = new THREE.Group();
  const roof = new THREE.Group();
  group.add(roof);
  const solids: SolidBox[] = [];
  const treeSolids: TreeCylinder[] = [];
  const occluders: THREE.Mesh[] = [];
  const rnd = createRandom(7);

  const box = (x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material, solid = true, parent: THREE.Object3D = group, cast = true): THREE.Mesh => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    o.position.set(x, y, z);
    o.castShadow = cast;
    o.receiveShadow = true;
    parent.add(o);
    if (solid) {
      solids.push([x - w / 2, x + w / 2, y - h / 2, y + h / 2, z - d / 2, z + d / 2, false]);
      occluders.push(o);
    }
    return o;
  };

  const grass = material('#789b52');
  const conc = material('#a9aaa0');
  const wall = material('#d7d0bd');
  const white = material('#e8e6dc');
  const pier = material('#c4c1b2');
  const steel = material('#899792', { metalness: 0.6, roughness: 0.4 });
  const terra = material('#b5683f', { side: THREE.DoubleSide });
  const dirt = material('#b49b73');
  const dark = material('#2a3330');

  // ---- ground and meadow patches
  box(0, -0.5, 0, 520, 1, 460, grass, false, group, false).renderOrder = GROUND_ORDER;
  // The original stacked the 300 patches millimetres apart (0.01 + i * 0.00035 m), which a 24-bit depth buffer cannot resolve
  // at distance: it flickers. The layout is unchanged, but depth is taken out of the equation: the patches are drawn right
  // after the ground (draw order), in creation order, ignoring the depth buffer entirely. Everything else is drawn after them
  // and therefore always covers them: concrete, floors and buildings can never show a patch through them.
  // (Do NOT use polygonOffset here: it scales with the viewing slope and pushes patches in front of the concrete at low angles.)
  const patchMats = ['#6f9350', '#86a35a', '#8a8656', '#7d7a52', '#98a262', '#9a8a5c'].map((c) => material(c, { depthWrite: false, depthTest: false }));
  for (let i = 0; i < 300; i++) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(3 + rnd() * 13, 6), patchMats[i % 6]);
    p.rotation.set(-Math.PI / 2, 0, rnd() * 6);
    p.position.set((rnd() - 0.5) * 500, 0.01, (rnd() - 0.5) * 440);
    p.renderOrder = DECAL_ORDER + i; // after the ground, in creation order: later patches paint over earlier ones, like the original
    p.receiveShadow = true;
    group.add(p);
  }

  // ---- hardstanding + road traced from the north-up screenshot (0.1776 m per pixel)
  box(-45, 0.08, 28, 34, 0.16, 94, conc, false, group, false);
  box(8.5, 0.08, 90.5, 113, 0.16, 29, conc, false, group, false);
  box(55.5, 0.08, 41.5, 49, 0.16, 73, conc, false, group, false);
  box(-44, 0.2, 26, 4, 0.04, 4, material('#e8c65a'), false, group, false); // take-off pad
  box(-30, 0.05, -143, 140, 0.05, 3.5, dirt, false, group, false);
  box(0, 0.04, 111, 360, 0.08, 7, material('#4a4d4b'), false, group, false).rotation.y = 0.061;

  // ---- main store: 4 barrel vaults (13.75 m each). Eaves 5.7 m, ridge ~9.7 m (estimated by proportion from the photos)
  const vault = (len: number, r: number, k: number, mat: THREE.Material, seg = 8): THREE.Mesh => {
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true, Math.PI / 2, Math.PI);
    g.rotateX(Math.PI / 2);
    g.scale(1, k, 1);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const { BW, BL, AL, AW, GL, EXN, BX0, BX1, BZ0, BZ1, AX0, AX1, AZ0, AZ1, AX, AZ, GX0, GX1, EH, AH } = D;
  const VW = BW / 4, VR = VW / 2, VKY = 0.58, RISE = VR * VKY, NB = 23, PS = BL / NB;
  for (let i = 0; i < 4; i++) {
    const v = vault(BL, VR, VKY, terra);
    v.position.set(BX0 + VW / 2 + i * VW, EH, 0);
    roof.add(v);
  }
  for (let i = 0; i < 2; i++) for (let z = BZ0 + 25 + i * 12; z <= BZ1 - 12; z += 26) box(BX0 + VW / 2 + i * VW, EH + RISE - 0.1, z, 2, 0.2, 2, white, false, roof, false);
  solids.push([BX0, BX1, EH + 0.4, EH + RISE + 0.2, BZ0, BZ1, true]);
  box(0, 0.05, 0, BW, 0.1, BL, conc, false, group, false);
  box(BX1, EH / 2, 0, 0.8, EH, BL, wall);
  box(BX1 - EXN / 2, EH / 2, BZ0, EXN, EH, 0.8, wall);
  // front (west) face: piers, then 2 bays with lower panels + 1 big full-height door, lintel above
  for (let i = 0; i <= NB; i++) box(BX0, EH / 2, BZ0 + i * PS, 1, EH, 1, pier);
  for (let i = 0; i < NB; i++) if (i % 3 !== 2) box(BX0, 0.75, BZ0 + (i + 0.5) * PS, 0.5, 1.5, PS - 1, wall);
  box(BX0, EH - 0.5, 0, 0.5, 1, BL, wall);
  for (let i = 0; i <= 8; i++) box(BX0 + (i * BW) / 8, EH / 2, BZ1, 1, EH, 1, pier);
  box(0, EH - 0.5, BZ1, BW, 1, 0.5, wall);
  for (const x of [BX0 + VW, 0, BX1 - VW]) for (let z = BZ0 + 2 * PS; z < BZ1 - 1; z += 2 * PS) box(x, EH / 2, z, 0.8, EH, 0.8, pier);
  box(BX1 + 2.2, 3, -33, 3.5, 6, 3.5, white);
  box(75, 0.9, 55.5, 4.5, 1.8, 2.2, material('#5f7a4a'));

  // ---- annex ("house") 56 x 20 m: hollow. Front door, 12 m opening to the greenhouse (west), 3 doors on the forest side,
  // east door, and a shared wall with the store made of 4 big internal windows separated by 3 columns
  box(AX, 0.05, AZ, AL, 0.1, AW, conc, false, group, false);
  const holes = (alongX: boolean, c: number, a0: number, a1: number, h: number, th: number, ops: Opening[]): void => {
    const put = (p0: number, p1: number, y0: number, y1: number): void => {
      if (p1 - p0 < 0.01 || y1 - y0 < 0.01) return;
      const m = (p0 + p1) / 2, l = p1 - p0, y = (y0 + y1) / 2, hh = y1 - y0;
      if (alongX) box(m, y, c, l, hh, th, wall);
      else box(c, y, m, th, hh, l, wall);
    };
    let p = a0;
    for (const o of [...ops].sort((u, v) => u.a - v.a)) {
      put(p, o.a, 0, h);
      let y = 0;
      for (const g of o.g) {
        put(o.a, o.b, y, g[0]);
        y = g[1];
      }
      put(o.a, o.b, y, h);
      p = o.b;
    }
    put(p, a1, 0, h);
  };
  const door = (c: number, w: number, hh: number): Opening => ({ a: c - w / 2, b: c + w / 2, g: [[0, hh]] });
  const win = (c: number): Opening => ({ a: c - 0.5, b: c + 0.5, g: [[4.4, 5.4]] });
  const wins = (x0: number, x1: number, st: number, avoid: number[]): Opening[] => {
    const r: Opening[] = [];
    for (let x = x0; x <= x1; x += st) if (avoid.every((d) => Math.abs(x - d) > 2.4)) r.push(win(x));
    return r;
  };
  const nd = [0.21, 0.5, 0.78].map((f) => AX0 + f * AL);
  holes(true, AZ0, AX0, AX1, AH, 0.5, [...nd.map((c) => door(c, 2.2, 2.6)), ...wins(AX0 + 2, AX1 - 2, 3.4, nd)]); // forest side: 3 doors + small windows
  holes(false, AX1, AZ0, AZ1, AH, 0.5, [{ a: AZ - 1.1, b: AZ + 1.1, g: [[0, 2.6], [4.4, 5.4]] }]); // east end: door + small window above
  box(AX0, AH / 2, AZ0 + 2, 0.5, AH, 4, wall);
  box(AX0, AH / 2, AZ1 - 2, 0.5, AH, 4, wall);
  box(AX0, 5.95, AZ, 0.5, 1.1, 12, wall); // west wall: 12 m opening into the greenhouse
  const dc = (AX0 + BX0) / 2;
  holes(true, AZ1, AX0, BX0, AH, 0.5, [door(dc, 2.4, 2.8), ...wins(AX0 + 2.5, BX0 - 2, 3.4, [dc])]); // front: central door + small windows
  for (const x of [dc - 1.2, dc + 1.2]) box(x, 1.4, AZ1 + 0.3, 0.14, 2.8, 0.1, dark, false, group, false);
  box(dc, 2.8, AZ1 + 0.3, 2.6, 0.14, 0.1, dark, false, group, false);
  {
    const R = (AW + 1.2) / 1.732;
    const g = new THREE.CylinderGeometry(R, R, AL + 1, 3);
    g.rotateX(Math.PI / 2);
    g.rotateZ(Math.PI);
    g.rotateY(Math.PI / 2);
    g.scale(1, 3.9 / (1.5 * R), 1);
    const a = new THREE.Mesh(g, material('#c27a55'));
    a.position.set(AX, AH + 1.3, AZ);
    a.castShadow = true;
    roof.add(a);
  }
  solids.push([AX0, AX1, AH, AH + 3.9, AZ0, AZ1, true]);
  box(dc - 4.5, 2.4, AZ1 + 0.28, 2.4, 1.4, 0.06, material('#2f6fb5'), false, group, false);
  box(dc - 8, 1.4, AZ1 + 0.28, 1.4, 1, 0.06, material('#e07a2d'), false, group, false);
  box(dc + 4.5, 2.2, AZ1 + 0.28, 1.8, 0.9, 0.06, material('#7a4aa8'), false, group, false);
  {
    const SW = AX1 - BX0, WW = (SW - 3) / 4, SC = (AX1 + BX0) / 2;
    box(SC, 0.5, AZ1, SW, 1, 0.6, wall);
    box(SC, 5.55, AZ1, SW, 1.9, 0.6, wall);
    for (let i = 0; i < 3; i++) box(BX0 + (i + 1) * WW + i + 0.5, 2.8, AZ1, 1, 3.6, 0.9, pier);
  }

  // ---- greenhouse 50 x 20 m tunnel: no side walls, no horizontal bars below 2 m, elliptical arch (ridge ~9 m),
  // ribs every 2.5 m, torn middle, open bar-only west end
  const GW = AW / 2, GK = 0.7, GZ = AZ, GS = 2, GHT = GS + GW * GK;
  const glass = (o: number): THREE.MeshStandardMaterial => material('#9ec1b6', { transparent: true, opacity: o, side: THREE.DoubleSide, roughness: 0.3, depthWrite: false });
  const TZ0 = GX0 + 0.66 * GL, TZ1 = GX0 + 0.92 * GL;
  for (const [f0, f1, o] of [[0, 0.37, 0.34], [0.37, 0.66, 0.24], [0.92, 1, 0.3]] as const) {
    const x0 = GX0 + f0 * GL, x1 = GX0 + f1 * GL;
    const v = vault(x1 - x0, GW, GK, glass(o), 14);
    v.castShadow = false;
    v.rotation.y = Math.PI / 2;
    v.position.set((x0 + x1) / 2, GS, GZ);
    group.add(v);
  }
  const lp: number[] = [];
  for (let a = 22.5; a < 180; a += 22.5) {
    const r = (a * Math.PI) / 180, y = GS + GW * GK * Math.sin(r), z = GZ + GW * Math.cos(r);
    lp.push(GX0, y, z, GX1, y, z);
  }
  for (let i = 0; i <= 20; i++) {
    const x = GX0 + (i * GL) / 20, torn = x > TZ0 && x < TZ1;
    const t = new THREE.Mesh(new THREE.TorusGeometry(GW, 0.08, 4, 14, Math.PI), steel);
    t.rotation.y = Math.PI / 2;
    t.position.set(x, GS, GZ);
    t.scale.y = GK * (torn ? 1 - ((i * 37) % 5) * 0.04 : 1);
    if (torn) t.rotation.x = (((i * 7) % 5) - 2) * 0.025;
    group.add(t);
    lp.push(x, 0, GZ - GW, x, GS, GZ - GW, x, 0, GZ + GW, x, GS, GZ + GW);
  }
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x56655f })));
  }
  for (const o of [-6, -3, 0, 3, 6]) {
    const h = GS + GW * GK * Math.sqrt(1 - (o / GW) ** 2);
    box(GX0, h / 2, GZ + o, 0.1, h, 0.1, steel, false, group, false); // west end: open, vertical bars only
  }
  for (const y of [5, 6.6, 8]) {
    const w = GW * Math.sqrt(1 - ((y - GS) / (GW * GK)) ** 2);
    box(GX0, y, GZ, 0.1, 0.1, 2 * w, steel, false, group, false);
  }
  box((GX0 + GX1) / 2, 0.08, GZ, GL, 0.16, AW - 0.5, conc, false, group, false);
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.6), glass(0.4));
    p.position.set(TZ0 + 3 + i * 4.5, 0.9, GZ + (i - 1) * 3.5);
    p.rotation.set(-0.7 + i * 0.4, i * 0.9, 0.3);
    group.add(p);
  }
  solids.push([GX0, TZ0, GHT - 1.5, GHT, GZ - 4, GZ + 4, false], [TZ1, GX1, GHT - 1.5, GHT, GZ - 4, GZ + 4, false]);

  // ---- small houses seen on the screenshot (gable roofs)
  const house = (cx: number, cz: number, w: number, d: number, h: number, rc: string, wc: string): void => {
    box(cx, h / 2, cz, w, h, d, material(wc));
    const R = d * 0.577;
    const g = new THREE.CylinderGeometry(R, R, w + 0.8, 3);
    g.rotateX(Math.PI / 2);
    g.rotateZ(Math.PI);
    g.rotateY(Math.PI / 2);
    g.scale(1, 0.45, 1);
    const r = new THREE.Mesh(g, material(rc));
    r.position.set(cx, h + R * 0.225, cz);
    r.castShadow = true;
    occluders.push(r);
    group.add(r);
    solids.push([cx - w / 2, cx + w / 2, h, h + R * 0.675, cz - d / 2, cz + d / 2, false]);
  };
  house(-62.7, 94.5, 18, 11, 6.5, '#6e6468', '#b7cfc4');
  house(68, 91.7, 16, 11.5, 6.5, '#b5683f', '#d7d0bd');

  // ---- trees (instanced). Zones leave the open field between greenhouse and store clear on purpose.
  const dec: TreeSpec[] = [];
  const con: TreeSpec[] = [];
  const insideSite = (x: number, z: number): boolean => x > -108 && x < 92 && z > -102 && z < 124;
  const zone = (x0: number, x1: number, z0: number, z1: number, n: number, force = false, sc = 1): void => {
    for (let i = 0; i < n; i++) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
      if (isInClearing(x, z)) continue;
      if (!force && insideSite(x, z)) continue;
      const h = (5 + rnd() * 6) * sc, r = (1.6 + rnd() * 1.6) * sc;
      (rnd() < 0.28 ? con : dec).push([x, z, h, r]);
      treeSolids.push([x, z, r * 0.75, h]);
    }
  };
  zone(-107, 14, -163, -97, 200);
  zone(-213, -121, -114, 36, 255);
  zone(-213, -114, 36, 156, 110);
  zone(-107, 64, 108, 168, 140);
  zone(65, 156, 108, 163, 70);
  zone(-150, -70, -20, 70, 14, true);
  zone(-71, 156, -142, -91, 50, false, 0.55);
  zone(92, 180, -100, 71, 60, false, 0.55);
  zone(-85, -28, -106, -88, 18, false, 0.7);

  const dm = new THREE.Object3D();
  const palette = ['#2f6a46', '#3f7a4c', '#4d8150', '#6b9154', '#7a9a58'].map((c) => new THREE.Color(c));
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.32, 1, 5), material('#70533a'), dec.length + con.length);
  const crownsDec = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), material('#ffffff'), dec.length);
  const crownsCon = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 6), material('#ffffff'), con.length);
  let j = 0;
  dec.forEach(([x, z, h, r], i) => {
    dm.position.set(x, h * 0.2, z);
    dm.scale.set(1, h * 0.4, 1);
    dm.updateMatrix();
    trunks.setMatrixAt(j++, dm.matrix);
    dm.position.set(x, h * 0.4 + r * 0.7, z);
    dm.scale.set(r, r * 1.15, r);
    dm.updateMatrix();
    crownsDec.setMatrixAt(i, dm.matrix);
    crownsDec.setColorAt(i, palette[i % 5] as THREE.Color);
  });
  con.forEach(([x, z, h, r], i) => {
    dm.position.set(x, h * 0.2, z);
    dm.scale.set(1, h * 0.4, 1);
    dm.updateMatrix();
    trunks.setMatrixAt(j++, dm.matrix);
    dm.position.set(x, h * 0.65, z);
    dm.scale.set(r * 0.9, h * 0.8, r * 0.9);
    dm.updateMatrix();
    crownsCon.setMatrixAt(i, dm.matrix);
    crownsCon.setColorAt(i, palette[i % 3] as THREE.Color);
  });
  for (const m of [trunks, crownsDec, crownsCon]) {
    m.castShadow = true;
    group.add(m);
  }

  // shrubs + tall cypress in front of the greenhouse (from oblique photo)
  const bush = (x: number, z: number, r: number, h: number, c: string): void => {
    if (isInClearing(x, z)) return;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), material(c));
    m.position.set(x, h / 2, z);
    m.scale.y = h / (2 * r);
    m.castShadow = true;
    occluders.push(m);
    group.add(m);
    treeSolids.push([x, z, r * 0.9, h]);
  };
  bush(-64, -58, 3, 4.2, '#46704f');
  bush(-71.7, -56.1, 2.2, 3.2, '#3f6a49');
  if (!isInClearing(-46.9, -63.2)) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(1.4, 12, 6), material('#3d6b45'));
    c.position.set(-46.9, 6, -63.2);
    c.castShadow = true;
    occluders.push(c);
    group.add(c);
    treeSolids.push([-46.9, -63.2, 1, 12]);
  }
  // front meadow shrubs, placed by eye from the oblique photo: big ones mid-field, a loose band along the shed front / apron edge, tall thin ones in the foreground
  const G = ['#46704f', '#527a4e', '#5e8556', '#3f6a49'];
  const meadow: readonly (readonly [number, number, number, number])[] = [
    [-30, -31, 2.3, 4.2], [-37.5, -33, 1.4, 3], [-31, -28, 0.8, 1.6],
    [-21.5, -27, 1, 2.6], [-24, -20, 0.9, 2], [-22, -15, 1.2, 3], [-25.5, -9, 0.8, 1.8], [-23, -5, 0.9, 2.2], [-26, 0, 0.9, 2], [-21, 2, 0.8, 1.8],
    [-45, -15, 1.1, 2.8], [-50, -22, 0.8, 1.8], [-48, -5, 0.9, 2], [-55, 8, 1, 2.4], [-42, 12, 0.8, 1.6],
    [-58, -14, 2.2, 4], [-52, 2, 1.1, 3.6], [-68, -4, 1.2, 4], [-47, 12, 2.1, 3.6], [-70, 10, 0.9, 1.8], [-60, 20, 1, 2.2],
  ];
  meadow.forEach((b, i) => bush(b[0] * 1.42, b[1] * 1.42, b[2] * 1.25, b[3] * 1.25, G[i % 4] as string));

  // roofs and every solid piece may be faded by the x-ray
  roof.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) occluders.push(o as THREE.Mesh);
  });

  const collider = new SiteCollider(solids, treeSolids);
  return {
    group,
    roof,
    collider,
    trees: new TreeField(dec, con, trunks, crownsDec, crownsCon),
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
