import * as THREE from 'three';
import type { SolidBox, TreeCylinder } from '../core/sim/collider';
import type { StructureSpec } from '../core/site-spec';

export interface BuiltStructure {
  object: THREE.Group;
  /** Collision boxes in site coordinates. */
  solids: SolidBox[];
  /** Vertical collision cylinders [x, z, radius, topHeight] in site coordinates. */
  cylinders: TreeCylinder[];
}

const mat = (color: string, o: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...o });

/** Default dimensions per kind, used by the editor and by the OpenStreetMap import when a tag is missing. */
export const STRUCTURE_DEFAULTS: Record<StructureSpec['kind'], { name: string; height: number; size: number; length?: number }> = {
  chimney: { name: 'Chimney', height: 35, size: 1.8 },
  silo: { name: 'Silo', height: 18, size: 4 },
  tank: { name: 'Storage tank', height: 8, size: 6 },
  water_tower: { name: 'Water tower', height: 24, size: 4.5 },
  lattice_tower: { name: 'Lattice tower', height: 30, size: 3 },
  bridge: { name: 'Bridge', height: 6, size: 7, length: 30 },
};

/**
 * One structure as geometry plus collision. Everything is built around its own origin, then placed with
 * the structure's position and rotation; the colliders are computed directly in site space (the collider only knows
 * axis-aligned boxes and vertical cylinders, so long or rotated parts are cut into short pieces).
 */
export function buildStructure(s: StructureSpec): BuiltStructure {
  const g = new THREE.Group();
  const solids: SolidBox[] = [];
  const cylinders: TreeCylinder[] = [];
  const a = (s.rotDeg * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  /** Local (x, z) to site coordinates. */
  const W = (lx: number, lz: number): [number, number] => [s.x + lx * ca - lz * sa, s.z + lx * sa + lz * ca];
  /** Axis-aligned envelope of a box of size (w along local x, d along local z) centred at local (lx, lz). */
  const box = (lx: number, lz: number, w: number, d: number, y0: number, y1: number): void => {
    const [cx, cz] = W(lx, lz);
    const hw = (w * Math.abs(ca) + d * Math.abs(sa)) / 2, hd = (w * Math.abs(sa) + d * Math.abs(ca)) / 2;
    solids.push([cx - hw, cx + hw, y0, y1, cz - hd, cz + hd, false]);
  };
  const cyl = (lx: number, lz: number, r: number, top: number): void => {
    const [cx, cz] = W(lx, lz);
    cylinders.push([cx, cz, r, top]);
  };
  const add = (m: THREE.Object3D, x: number, y: number, z: number): void => {
    m.position.set(x, y, z);
    if (m instanceof THREE.Mesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    g.add(m);
  };
  const h = Math.max(2, s.height), r = Math.max(0.4, s.size);

  if (s.kind === 'chimney') {
    const brick = mat(s.color ?? '#8a5a44');
    add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r, h, 20), brick), 0, h / 2, 0);
    add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.66, Math.min(1.6, h * 0.05), 20), mat('#3f3a37')), 0, h - Math.min(0.8, h * 0.025), 0); // dark rim
    cyl(0, 0, r * 0.78, h);
  } else if (s.kind === 'silo') {
    const steel = mat(s.color ?? '#b9bec0', { metalness: 0.3 });
    const body = Math.max(1, h - r * 0.6);
    add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, body, 24), steel), 0, body / 2, 0);
    add(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), steel), 0, body, 0);
    for (let y = 2; y < body; y += 2.2) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.005, 0.06, 4, 24), mat('#8d9396'));
      ring.rotation.x = Math.PI / 2;
      add(ring, 0, y, 0);
    }
    cyl(0, 0, r, h);
  } else if (s.kind === 'tank') {
    const body = h * 0.88;
    add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, body, 28), mat(s.color ?? '#a9adaa', { metalness: 0.25 })), 0, body / 2, 0);
    add(new THREE.Mesh(new THREE.ConeGeometry(r * 1.02, h - body, 28), mat('#8e9391')), 0, body + (h - body) / 2, 0);
    cyl(0, 0, r, h);
  } else if (s.kind === 'water_tower') {
    const tankH = Math.min(h * 0.45, r * 1.6);
    const legH = h - tankH - r * 0.25;
    const steel = mat(s.color ?? '#9aa09c', { metalness: 0.3 });
    add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, tankH, 24), steel), 0, legH + tankH / 2, 0);
    add(new THREE.Mesh(new THREE.ConeGeometry(r * 1.03, r * 0.5, 24), mat('#7d8380')), 0, legH + tankH + r * 0.25, 0);
    const legs = 6;
    for (let i = 0; i < legs; i++) {
      const ang = (i / legs) * Math.PI * 2;
      const lx = Math.cos(ang) * r * 0.82, lz = Math.sin(ang) * r * 0.82;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, legH, 8), steel), lx, legH / 2, lz);
      box(lx, lz, 0.7, 0.7, 0, legH);
    }
    for (const y of [legH * 0.35, legH * 0.7]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.82, 0.07, 4, 24), steel);
      ring.rotation.x = Math.PI / 2;
      add(ring, 0, y, 0);
    }
    box(0, 0, r * 2, r * 2, legH, legH + tankH + r * 0.4); // the tank (a square envelope of the round tank)
  } else if (s.kind === 'lattice_tower') {
    const steel = mat(s.color ?? '#7b8187', { metalness: 0.4 });
    const wb = r, wt = Math.max(0.35, r * 0.18);
    const n = Math.max(3, Math.min(12, Math.round(h / 5)));
    const width = (k: number): number => wb + (wt - wb) * (k / n);
    const corner = (k: number, i: number): THREE.Vector3 => {
      const w = width(k);
      return new THREE.Vector3(i === 0 || i === 3 ? -w : w, (h * k) / n, i < 2 ? -w : w);
    };
    const struts: [THREE.Vector3, THREE.Vector3, number][] = [];
    for (let i = 0; i < 4; i++) struts.push([corner(0, i), corner(n, i), 0.16]); // the four legs
    for (let k = 0; k <= n; k++) for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0]] as const) struts.push([corner(k, i), corner(k, j), 0.07]); // rings
    for (let k = 0; k < n; k++) for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0]] as const) {
      struts.push([corner(k, i), corner(k + 1, j), 0.06], [corner(k, j), corner(k + 1, i), 0.06]); // X bracing on each face
    }
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), steel, struts.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    struts.forEach(([p0, p1, t], i) => {
      const d = p1.clone().sub(p0);
      const len = d.length();
      q.setFromUnitVectors(up, d.normalize());
      m4.compose(p0.clone().add(p1).multiplyScalar(0.5), q, new THREE.Vector3(t, len, t));
      inst.setMatrixAt(i, m4);
    });
    inst.castShadow = true;
    g.add(inst);
    add(new THREE.Mesh(new THREE.BoxGeometry(wt * 2 + 0.8, 0.5, wt * 2 + 0.8), steel), 0, h + 0.25, 0); // top platform
    // collision: pieces along each leg, plus the platform
    for (let k = 0; k < n; k++) for (let i = 0; i < 4; i++) {
      const c0 = corner(k, i), c1 = corner(k + 1, i);
      box((c0.x + c1.x) / 2, (c0.z + c1.z) / 2, 0.5, 0.5, c0.y, c1.y);
    }
    box(0, 0, wt * 2 + 0.8, wt * 2 + 0.8, h, h + 0.5);
  } else {
    // bridge: x along its length, z across; the deck top is at `height`
    const L = Math.max(6, s.length ?? 30), Wd = r, t = 0.7;
    const concrete = mat(s.color ?? '#9a9a94');
    const steel = mat('#6c7378', { metalness: 0.3 });
    add(new THREE.Mesh(new THREE.BoxGeometry(L, t, Wd), concrete), 0, h - t / 2, 0);
    for (const sz of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(L, 0.9, 0.14), steel), 0, h + 0.45, sz * (Wd / 2 - 0.07));
    // collision in pieces of at most 4 m so a diagonal bridge does not block a huge envelope
    const pieces = Math.max(1, Math.ceil(L / 4));
    for (let i = 0; i < pieces; i++) {
      const lx = -L / 2 + ((i + 0.5) * L) / pieces;
      box(lx, 0, L / pieces + 0.1, Wd, h - t, h);
      for (const sz of [-1, 1]) box(lx, sz * (Wd / 2 - 0.07), L / pieces + 0.1, 0.2, h, h + 0.9);
    }
    // abutments at both ends
    for (const sx of [-1, 1]) {
      const lx = sx * (L / 2 - 0.7);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.4, h - t, Wd * 0.9), concrete), lx, (h - t) / 2, 0);
      box(lx, 0, 1.4, Wd * 0.9, 0, h - t);
    }
    if (s.style === 'arch') {
      const rise = Math.max(1.5, Math.min(h - t - 1, L * 0.22));
      const R = L / 2 - 0.7;
      const y0 = h - t - rise; // where the arch springs
      for (const sz of [-1, 1]) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(R, 0.3, 6, 28, Math.PI), steel);
        rib.scale.y = rise / R;
        add(rib, 0, y0, sz * (Wd / 2 - 0.5));
        for (let i = 0; i <= 14; i++) { // collision samples along the rib
          const ang = (i / 14) * Math.PI;
          box(Math.cos(ang) * R, sz * (Wd / 2 - 0.5), 1.1, 0.8, y0 + Math.sin(ang) * rise - 0.4, y0 + Math.sin(ang) * rise + 0.4);
        }
        for (let px = -R + 3; px < R - 1; px += 4) { // posts from the rib to the deck
          const yr = y0 + Math.sqrt(Math.max(0, 1 - (px / R) ** 2)) * rise;
          if (h - t - yr < 0.3) continue;
          add(new THREE.Mesh(new THREE.BoxGeometry(0.25, h - t - yr, 0.25), steel), px, yr + (h - t - yr) / 2, sz * (Wd / 2 - 0.5));
          box(px, sz * (Wd / 2 - 0.5), 0.35, 0.35, yr, h - t);
        }
      }
    } else {
      const piers = Math.max(0, Math.round(L / 20) - 1);
      for (let i = 1; i <= piers; i++) {
        const lx = -L / 2 + (i * L) / (piers + 1);
        add(new THREE.Mesh(new THREE.BoxGeometry(1.4, h - t, Wd * 0.7), concrete), lx, (h - t) / 2, 0);
        box(lx, 0, 1.4, Wd * 0.7, 0, h - t);
      }
    }
  }
  g.position.set(s.x, 0, s.z);
  g.rotation.y = -a;
  return { object: g, solids, cylinders };
}
