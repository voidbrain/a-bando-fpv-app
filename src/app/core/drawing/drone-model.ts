import { clamp } from '../math';
import { Quat, Vec3 } from '../math3d';

/**
 * Software-rendered 3D drone for the Blackbox card: arms, stack, orange battery on TOP, grey bottom plate, camera in
 * front, 4 motors (colour = power) and 4 prop discs. Top and bottom are clearly different colours so up / down facing
 * is obvious. X frame, Betaflight motor order: M1 rear-right, M2 front-right, M3 rear-left, M4 front-left.
 * Front = -Z, up = +Y.
 */
type RGB = readonly [number, number, number];
type Pt3 = readonly [number, number, number];

interface Poly {
  v: Pt3[];
  c: RGB;
  /** Opacity. */
  a: number;
  /** Kind, for depth sorting tests and motor colouring. */
  k: string;
  /** Motor index (0..3) this polygon belongs to, or -1. */
  m: number;
  /** Only draw when facing the viewer (forward arrows). */
  face?: boolean;
  nrm?: Pt3;
  /** Depth bias so decals sit in front of the surface they are painted on. */
  bias?: number;
}

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function buildPolys(): Poly[] {
  const polys: Poly[] = [];
  const add = (v: Pt3[], c: string, o: Partial<Poly> = {}): void => {
    polys.push({ v, c: hex(c), a: 1, k: 'body', m: -1, ...o });
  };
  type P2 = readonly [number, number];
  const prism = (pts: P2[], y0: number, y1: number, top: string, bot: string, side: string, k: string, o: Partial<Poly> = {}): void => {
    const n = pts.length;
    add(pts.map((p) => [p[0], y1, p[1]] as Pt3), top, { ...o, k: `${k}-top` });
    add(pts.map((p) => [p[0], y0, p[1]] as Pt3).reverse(), bot, { k: `${k}-bot` });
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % n]!;
      add([[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], side, { k });
    }
  };
  const rect = (cx: number, cz: number, w: number, d: number): P2[] => [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]];
  const ngon = (cx: number, cz: number, r: number, n: number): P2[] => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i * 6.2832) / n), cz + r * Math.sin((i * 6.2832) / n)] as const);

  const s2 = Math.SQRT1_2, L = 1.414, w = 0.07;
  for (const [dx, dz] of [[s2, s2], [s2, -s2]] as const) {
    const px = -dz, pz = dx;
    prism([[-L * dx - w * px, -L * dz - w * pz], [L * dx - w * px, L * dz - w * pz], [L * dx + w * px, L * dz + w * pz], [-L * dx + w * px, -L * dz + w * pz]], -0.03, 0.03, '#3a4046', '#1d2125', '#2a2f33', 'arm');
  }
  prism(rect(0, 0.1, 0.64, 0.9), -0.1, 0.1, '#59616a', '#2a2f35', '#3a4047', 'stack'); // flight stack: dark grey underside
  prism(rect(0, 0.12, 0.5, 0.95), 0.1, 0.3, '#ff9a3c', '#d9822b', '#e67e22', 'battery'); // battery: orange TOP
  prism(rect(0, -0.62, 0.34, 0.26), 0.04, 0.28, '#2b3036', '#1b1f23', '#232831', 'camera');
  add(ngon(0, 0, 0.13, 12).map((p) => [p[0], 0.16 + p[1], -0.752] as Pt3), '#6bb0ff', { k: 'lens' }); // lens on the camera front
  add(ngon(0, 0, 0.09, 12).map((p) => [p[0], 0.16 + p[1], -0.755] as Pt3), '#0a0a0c', { k: 'lens' });

  // forward arrows (front = -z): white on the orange battery top and on the grey underside, so the nose is obvious from either side
  const arrow = (y: number, top: boolean): void => {
    const pts = ([[0, -0.3], [-0.2, 0], [-0.08, 0], [-0.08, 0.5], [0.08, 0.5], [0.08, 0], [0.2, 0]] as const).map((p) => [p[0], y, p[1]] as Pt3);
    add(top ? pts : pts.slice().reverse(), top ? '#ffffff' : '#e6edf1', { k: top ? 'arrow-top' : 'arrow-bot', face: true, bias: 0.1, nrm: top ? [0, 1, 0] : [0, -1, 0] });
  };
  arrow(0.304, true);
  arrow(-0.104, false);

  const motors: readonly (readonly [number, number])[] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  motors.forEach(([mx, mz], i) => {
    prism(ngon(mx, mz, 0.15, 12), 0.03, 0.2, '#9aa0a6', '#30343a', '#6b7078', 'motor', { m: i });
    add(ngon(mx, mz, 0.8, 24).map((p) => [p[0], 0.27, p[1]] as Pt3), mz < 0 ? '#7bd88f' : '#ff8a80', { a: 0.16, k: 'prop' }); // prop discs: green = front, red = rear
  });
  return polys;
}

const POLYS = buildPolys();

/** Motor power 0..1 -> RGB (green -> red). */
export function heatRGB(p: number): RGB {
  const h = (1 - p) * 0.33;
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0) * 255, f(8) * 255 * 0.9, f(4) * 255];
}

/** The viewer's orbit: from behind and above; drag sideways to turn the drone about the vertical axis. */
export interface DroneView {
  yaw: number;
  tilt: number;
}

export const DEFAULT_DRONE_VIEW: DroneView = { yaw: 0, tilt: 0.62 };

export interface DroneModelInfo {
  /** Y component of the drone's up vector: 1 = upright, -1 = upside down. */
  up: number;
  /** Draw order of polygon kinds, back to front (used by tests). */
  order: string[];
}

interface Face {
  pts: [number, number, number][];
  z: number;
  col: RGB;
  shade: number;
  a: number;
  k: string;
  line: boolean;
}

const LIGHT: Pt3 = [-0.3, 0.7, 0.65];
const LIGHT_LEN = Math.hypot(...LIGHT);
const MOTOR_MIN = 48;
const MOTOR_SPAN = 1999;

/** Draw the drone with attitude `q`, motor outputs `mot` (raw 48..2047) into the box (x0, y0, w, h). */
export function drawDroneModel(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, q: Quat, mot: readonly number[], view: DroneView): DroneModelInfo {
  const S = Math.min(w / 4.6, h / 3.7);
  const cx = x0 + w / 2;
  const cy = y0 + h / 2 + h * 0.06;
  const qView = new Quat().setFromEuler(view.tilt, 0, 0, 'XYZ').multiply(new Quat().setFromEuler(0, view.yaw, 0, 'XYZ'));
  const qt = qView.clone().multiply(q);
  const v = new Vec3();
  const power = mot.map((m) => clamp((m - MOTOR_MIN) / MOTOR_SPAN, 0, 1));
  const D = 9; // camera distance for the perspective divide
  const project = (p: Pt3): [number, number, number] => {
    v.set(p[0], p[1], p[2]).applyQuat(qt);
    const s = D / (D - v.z);
    return [cx + v.x * S * s, cy - v.y * S * s, v.z];
  };
  const flat = (x: number, y: number, z: number): [number, number] => {
    v.set(x, y, z).applyQuat(qView);
    return [cx + v.x * S, cy - v.y * S];
  };

  // level reference: a ring on the horizontal world plane and a vertical (gravity-up) axis, drawn first
  g.save();
  g.strokeStyle = 'rgba(150,170,160,.45)';
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i * 6.2832) / 40;
    const p = flat(Math.cos(a) * 1.9, -0.75, Math.sin(a) * 1.9);
    if (i) g.lineTo(p[0], p[1]);
    else g.moveTo(p[0], p[1]);
  }
  g.stroke();
  const a0 = flat(0, -0.75, 0);
  const a1 = flat(0, 1.6, 0);
  g.beginPath();
  g.moveTo(a0[0], a0[1]);
  g.lineTo(a1[0], a1[1]);
  g.stroke();
  g.fillStyle = 'rgba(150,170,160,.7)';
  g.font = '8px ui-monospace,monospace';
  g.fillText('up', a1[0] + 3, a1[1] + 3);

  const faces: Face[] = [];
  const A = new Vec3(), B = new Vec3(), C = new Vec3();
  for (const p of POLYS) {
    const pts = p.v.map(project);
    let zm = 0;
    for (const q2 of pts) zm += q2[2];
    zm /= pts.length;
    A.set(...p.v[0]!).applyQuat(qt);
    B.set(...p.v[1]!).applyQuat(qt);
    C.set(...p.v[2]!).applyQuat(qt);
    const n = B.sub(A).cross(C.sub(A)).normalize();
    const shade = 0.5 + 0.5 * Math.abs((n.x * LIGHT[0] + n.y * LIGHT[1] + n.z * LIGHT[2]) / LIGHT_LEN);
    if (p.face && p.nrm) {
      const nv = new Vec3(p.nrm[0], p.nrm[1], p.nrm[2]).applyQuat(qt);
      if (nv.z <= 0) continue;
    }
    const col = p.m >= 0 && p.k === 'motor-top' ? heatRGB(power[p.m] ?? 0) : p.c;
    faces.push({ pts, z: zm + (p.bias ?? 0), col, shade: p.face ? 1 : shade, a: p.a, k: p.k, line: p.a >= 1 });
  }
  faces.sort((a, b) => a.z - b.z);
  for (const f of faces) {
    g.beginPath();
    f.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.closePath();
    g.fillStyle = `rgba(${Math.round(f.col[0] * f.shade)},${Math.round(f.col[1] * f.shade)},${Math.round(f.col[2] * f.shade)},${f.a})`;
    g.fill();
    if (f.line) {
      g.strokeStyle = 'rgba(0,0,0,.35)';
      g.lineWidth = 0.6;
      g.stroke();
    }
  }
  g.restore();
  return { up: new Vec3(0, 1, 0).applyQuat(q).y, order: faces.map((f) => f.k) };
}
