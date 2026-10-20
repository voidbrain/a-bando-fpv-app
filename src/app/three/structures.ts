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
  stairs: { name: 'Stairs', height: 3, size: 1.4, length: 5.4 },
  ramp: { name: 'Ramp', height: 2, size: 3, length: 10 },
  tower_crane: { name: 'Tower crane', height: 40, size: 1.2, length: 45 },
  container: { name: 'Container', height: 2.6, size: 2.44, length: 12.2 },
  car: { name: 'Car', height: 1.5, size: 1.8, length: 4.5 },
  truck: { name: 'Truck', height: 3.2, size: 2.5, length: 8.5 },
  excavator: { name: 'Excavator', height: 3, size: 2.8, length: 6 },
};

/** Kinds drawn as a length × width rectangle (the rest are round or square about their centre). */
export const RECT_KINDS: readonly StructureSpec['kind'][] = ['bridge', 'stairs', 'ramp', 'container', 'car', 'truck', 'excavator'];

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
  const base = s.y ?? 0; // raised by this much
  const ca = Math.cos(a), sa = Math.sin(a);
  /** Local (x, z) to site coordinates. */
  const W = (lx: number, lz: number): [number, number] => [s.x + lx * ca - lz * sa, s.z + lx * sa + lz * ca];
  /** Axis-aligned envelope of a box of size (w along local x, d along local z) centred at local (lx, lz). */
  const box = (lx: number, lz: number, w: number, d: number, y0: number, y1: number): void => {
    const [cx, cz] = W(lx, lz);
    const hw = (w * Math.abs(ca) + d * Math.abs(sa)) / 2, hd = (w * Math.abs(sa) + d * Math.abs(ca)) / 2;
    solids.push([cx - hw, cx + hw, y0 + base, y1 + base, cz - hd, cz + hd, false]);
  };
  const cyl = (lx: number, lz: number, r: number, top: number): void => {
    if (base > 0) return box(lx, lz, r * 2, r * 2, 0, top); // the collider's cylinders always start on the ground
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
  } else if (s.kind === 'stairs' || s.kind === 'ramp') {
    const run = Math.max(1, s.length ?? 5.4), width = r, rise = Math.max(0.3, s.height);
    const concrete = mat(s.color ?? '#a8a8a0');
    if (s.kind === 'stairs') {
      const n = Math.max(2, Math.round(rise / 0.18)), tread = run / n, dh = rise / n;
      for (let i = 0; i < n; i++) {
        const x = -run / 2 + (i + 0.5) * tread, hgt = (i + 1) * dh;
        add(new THREE.Mesh(new THREE.BoxGeometry(tread, hgt, width), concrete), x, hgt / 2, 0);
        box(x, 0, tread, width, 0, hgt);
      }
      for (const sz of [-1, 1]) { // handrails
        const rail = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(run, rise), 0.06, 0.06), mat('#55595c', { metalness: 0.4 }));
        rail.rotation.z = Math.atan2(rise, run);
        add(rail, 0, rise / 2 + 0.95, sz * (width / 2 - 0.04));
      }
    } else {
      const shape = new THREE.Shape();
      shape.moveTo(-run / 2, 0);
      shape.lineTo(run / 2, 0);
      shape.lineTo(run / 2, rise);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
      geo.translate(0, 0, -width / 2);
      add(new THREE.Mesh(geo, concrete), 0, 0, 0);
      const n = Math.max(2, Math.ceil(run / 0.8));
      for (let i = 0; i < n; i++) box(-run / 2 + ((i + 0.5) * run) / n, 0, run / n + 0.05, width, 0, (rise * (i + 1)) / n);
    }
  } else if (s.kind === 'container') {
    const L = Math.max(2, s.length ?? 12.2), Wd = r, H = Math.max(1, s.height);
    const palette = ['#9a3b2e', '#2f5d8a', '#3f7a52', '#c8892a', '#6d7378', '#7a4f8a'];
    const color = s.color ?? palette[[...s.id].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length]!;
    add(new THREE.Mesh(new THREE.BoxGeometry(L, H, Wd), mat(color, { metalness: 0.25 })), 0, H / 2, 0);
    const rib = mat('#00000030');
    for (let x = -L / 2 + 0.5; x < L / 2 - 0.3; x += 0.6) for (const sz of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(0.08, H * 0.92, 0.04), rib), x, H / 2, sz * (Wd / 2 + 0.02));
    const n = Math.max(1, Math.ceil(L / 2.5));
    for (let i = 0; i < n; i++) box(-L / 2 + ((i + 0.5) * L) / n, 0, L / n + 0.05, Wd, 0, H);
  } else if (s.kind === 'car' || s.kind === 'truck') {
    const L = Math.max(2, s.length ?? 4.5), Wd = r, H = Math.max(1, s.height);
    const body = mat(s.color ?? (s.kind === 'car' ? '#b23a3a' : '#e8e8e2'), { metalness: 0.3 });
    const glass = mat('#2b3a44', { metalness: 0.5 });
    const wheel = (x: number, z: number, rad: number): void => {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 0.3, 14), mat('#1c1c1c'));
      w.rotation.x = Math.PI / 2;
      add(w, x, rad, z);
    };
    if (s.kind === 'car') {
      add(new THREE.Mesh(new THREE.BoxGeometry(L, H * 0.42, Wd), body), 0, H * 0.4, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(L * 0.5, H * 0.38, Wd * 0.88), glass), -L * 0.04, H * 0.78, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(sx * L * 0.32, sz * (Wd / 2 - 0.1), 0.32);
      box(0, 0, L, Wd, 0.1, H * 0.62);
    } else {
      const cab = Math.min(2.4, L * 0.28);
      add(new THREE.Mesh(new THREE.BoxGeometry(cab, H * 0.78, Wd), mat(s.color ?? '#3f6aa0', { metalness: 0.3 })), L / 2 - cab / 2, H * 0.5, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(cab * 0.3, H * 0.28, Wd * 0.92), glass), L / 2 - cab * 0.12, H * 0.66, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(L - cab - 0.1, H * 0.84, Wd), body), -cab / 2 - 0.05, H * 0.57, 0);
      for (const x of [L / 2 - cab * 0.5, -L / 2 + 1.2, -L / 2 + 2.6]) for (const sz of [-1, 1]) wheel(x, sz * (Wd / 2 - 0.1), 0.5);
      const n = Math.max(2, Math.ceil(L / 2.5));
      for (let i = 0; i < n; i++) box(-L / 2 + ((i + 0.5) * L) / n, 0, L / n + 0.05, Wd, 0.2, H * 0.96);
    }
  } else if (s.kind === 'excavator') {
    const L = Math.max(3, s.length ?? 6), Wd = r, H = Math.max(2, s.height);
    const paint = mat(s.color ?? '#e0a100', { metalness: 0.2 });
    const dark = mat('#2a2a2a');
    const track = Math.min(L * 0.85, 4.4);
    for (const sz of [-1, 1]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(track, 0.85, 0.75), dark), -L * 0.12, 0.43, sz * (Wd / 2 - 0.4));
      box(-L * 0.12, sz * (Wd / 2 - 0.4), track, 0.75, 0, 0.85);
    }
    add(new THREE.Mesh(new THREE.BoxGeometry(track * 0.8, 0.9, Wd * 0.85), paint), -L * 0.18, 1.3, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.7, H * 0.5, 1.5), paint), L * 0.1, 1.75 + H * 0.15, -Wd * 0.15);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 1.3), mat('#2b3a44', { metalness: 0.5 })), L * 0.16, 2.2 + H * 0.15, -Wd * 0.15);
    box(-L * 0.18, 0, track * 0.8, Wd * 0.85, 0.85, 1.75);
    box(L * 0.1, -Wd * 0.15, 1.7, 1.5, 1.75, 1.75 + H * 0.5);
    // boom and stick: two tilted bars ending in a bucket
    const bar = (x0: number, y0: number, x1: number, y1: number, t: number): void => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, t, t), paint);
      m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      add(m, (x0 + x1) / 2, (y0 + y1) / 2, Wd * 0.1);
      for (let i = 0; i < Math.ceil(len / 1.5); i++) {
        const f = (i + 0.5) / Math.ceil(len / 1.5);
        box(x0 + (x1 - x0) * f, Wd * 0.1, 1.0, t, Math.min(y0, y1) + (y1 - y0) * f - t / 2 > 0 ? y0 + (y1 - y0) * f - t / 2 : 0, y0 + (y1 - y0) * f + t / 2);
      }
    };
    const elbow = { x: L * 0.5 + 1.2, y: H * 1.05 };
    bar(L * 0.12, 1.7, elbow.x, elbow.y, 0.5);
    bar(elbow.x, elbow.y, elbow.x + 1.6, 0.9, 0.4);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 1.1), dark), elbow.x + 1.9, 0.6, Wd * 0.1);
    box(elbow.x + 1.9, Wd * 0.1, 0.9, 1.1, 0.2, 1.0);
  } else if (s.kind === 'tower_crane') {
    const steel = mat(s.color ?? '#e0b020', { metalness: 0.3 });
    const wb = r;
    const n = Math.max(3, Math.min(14, Math.round(h / 3)));
    const struts: [THREE.Vector3, THREE.Vector3, number][] = [];
    const cn = (k: number, i: number): THREE.Vector3 => new THREE.Vector3(i === 0 || i === 3 ? -wb : wb, (h * k) / n, i < 2 ? -wb : wb);
    for (let i = 0; i < 4; i++) struts.push([cn(0, i), cn(n, i), 0.14]);
    for (let k = 0; k < n; k++) for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0]] as const) struts.push([cn(k, i), cn(k + 1, j), 0.07], [cn(k, j), cn(k + 1, i), 0.07]);
    const J = Math.max(10, s.length ?? 45), back = J * 0.25, topY = h;
    for (const sz of [-1, 1]) { // jib and counter-jib trusses
      struts.push([new THREE.Vector3(-back, topY + 1.4, sz * 0.5), new THREE.Vector3(J, topY + 1.4, sz * 0.5), 0.1], [new THREE.Vector3(-back, topY, sz * 0.5), new THREE.Vector3(J, topY, sz * 0.5), 0.1]);
    }
    for (let x = -back; x < J - 1.5; x += 1.5) for (const sz of [-1, 1]) struts.push([new THREE.Vector3(x, topY, sz * 0.5), new THREE.Vector3(x + 1.5, topY + 1.4, sz * 0.5), 0.05]);
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
    add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, 1.6), mat('#cfcfc8')), 0.6, topY - 1.0, 1.6); // operator cab
    add(new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, 1.4), mat('#7d7d78')), -back + 1.8, topY + 0.8, 0); // counterweight
    add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 5, 0.2), steel), 0, topY + 3.9, 0); // tower head
    const hookX = J * 0.7;
    add(new THREE.Mesh(new THREE.BoxGeometry(0.06, Math.max(2, h - 4), 0.06), mat('#222222')), hookX, 4 + Math.max(2, h - 4) / 2, 0); // hoist cable
    add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.6), mat('#b33a2a')), hookX, 3.6, 0); // hook block
    for (let k = 0; k < n; k++) for (let i = 0; i < 4; i++) {
      const c0 = cn(k, i), c1 = cn(k + 1, i);
      box((c0.x + c1.x) / 2, (c0.z + c1.z) / 2, 0.5, 0.5, c0.y, c1.y);
    }
    const parts = Math.ceil((J + back) / 4);
    for (let i = 0; i < parts; i++) box(-back + ((i + 0.5) * (J + back)) / parts, 0, (J + back) / parts + 0.05, 1.3, topY, topY + 1.6);
    box(-back + 1.8, 0, 3, 1.4, topY, topY + 1.6);
    box(hookX, 0, 0.35, 0.35, 3.2, h - 0.5);
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
  g.position.set(s.x, base, s.z);
  g.rotation.y = -a;
  return { object: g, solids, cylinders };
}
