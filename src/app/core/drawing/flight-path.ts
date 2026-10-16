import { clamp, speedHsl } from '../math';
import type { Vec3 } from '../math3d';
import type { Calibration, Flight } from '../models';
import { MONO, TAU, scoped } from './canvas-util';

export type PathViewMode = 'top' | 'side' | 'front' | '3d';

export interface PathView {
  mode: PathViewMode;
  zoom: number;
  /** Pan in CSS pixels. */
  px: number;
  py: number;
  /** 3D orbit angles, radians. */
  yaw: number;
  pitch: number;
}

export const createPathView = (): PathView => ({ mode: 'top', zoom: 1, px: 0, py: 0, yaw: 0.7, pitch: 0.55 });
export const resetPathView = (v: PathView): void => {
  v.zoom = 1;
  v.px = v.py = 0;
  v.yaw = 0.7;
  v.pitch = 0.55;
};

/** Mouse interaction: drag rotates in 3D (shift = pan) and pans in the other views; wheel zooms. */
export function dragPathView(v: PathView, dx: number, dy: number, shift: boolean): void {
  if (v.mode === '3d' && !shift) {
    v.yaw += dx * 0.01;
    v.pitch = clamp(v.pitch + dy * 0.01, -1.5, 1.5);
  } else {
    v.px += dx;
    v.py += dy;
  }
}
export const zoomPathView = (v: PathView, wheelDeltaY: number): void => {
  v.zoom = clamp(v.zoom * (1 - wheelDeltaY * 0.001), 0.2, 30);
};

type Pt = [number, number, number];

const GRID = 'rgba(150,170,160,.26)';
const AXIS = 'rgba(225,238,230,.85)';
const NICE_STEPS = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
/** Smallest "nice" grid step (metres) that is at least `px` pixels wide at `pxPerMetre`. */
export const niceStep = (px: number, pxPerMetre: number): number => NICE_STEPS.find((q) => q * pxPerMetre >= px) ?? 500;

/**
 * Flight-path card: only the path(s), coloured by speed (same blue -> red scale as everywhere), over a labelled
 * cartesian grid in metres with arrow-headed axes. Returns the colour-scale caption ("0 – 72 km/h").
 * East / north come from the local frame through the calibration rotation.
 */
export function drawFlightPath(
  g: CanvasRenderingContext2D, w: number, h: number, flights: readonly Flight[], view: PathView, cal: Calibration, speedMax: number, replayPosition: Vec3 | null,
): string {
  g.clearRect(0, 0, w, h);
  if (!flights.length || !flights[0]!.loc.length) return '';
  const A = (cal.rot * Math.PI) / 180;
  const cA = Math.cos(A), sA = Math.sin(A);
  const mode = view.mode;
  /** Vertical exaggeration of the side / front views. */
  const ex = mode === 'side' || mode === 'front' ? 2 : 1;
  const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw), cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
  const east = (p: Vec3): number => p.x * cA + p.z * sA;
  const north = (p: Vec3): number => p.x * sA - p.z * cA;
  const project = (p: Vec3): [number, number] => {
    const e = east(p), n = north(p), a = p.y;
    if (mode === 'top') return [e, n];
    if (mode === 'side') return [e, a * ex];
    if (mode === 'front') return [n, a * ex];
    const x1 = e * cy + n * sy;
    const z1 = -e * sy + n * cy;
    return [x1, a * cp + z1 * sp];
  };

  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  const lines: Pt[][] = flights.map((f) => {
    const st = Math.max(1, Math.ceil(f.loc.length / 1200));
    const pts: Pt[] = [];
    for (let i = 0; i < f.loc.length; i += st) pts.push([...project(f.loc[i]!), f.spd[i] ?? 0]);
    const last = f.loc.length - 1;
    if (last % st !== 0) pts.push([...project(f.loc[last]!), f.spd[last] ?? 0]);
    return pts;
  });
  for (const pts of lines) for (const q of pts) {
    u0 = Math.min(u0, q[0]);
    u1 = Math.max(u1, q[0]);
    v0 = Math.min(v0, q[1]);
    v1 = Math.max(v1, q[1]);
  }
  if (mode !== 'top') v0 = Math.min(v0, 0);
  const sc = Math.min((w - 44) / Math.max(u1 - u0, 1), (h - 44) / Math.max(v1 - v0, 1)) * view.zoom;
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  const X = (u: number): number => w / 2 + (u - cu) * sc + view.px;
  const Y = (v: number): number => h / 2 - (v - cv) * sc + view.py;

  scoped(g, () => {
    g.font = `9px ${MONO}`;
    g.lineWidth = 1;
    const arrow = (x0: number, y0: number, dx: number, dy: number, txt: string, col: string): void => {
      g.strokeStyle = col;
      g.fillStyle = col;
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x0 + dx, y0 + dy);
      g.stroke();
      const an = Math.atan2(dy, dx);
      g.beginPath();
      g.moveTo(x0 + dx, y0 + dy);
      g.lineTo(x0 + dx - 7 * Math.cos(an - 0.45), y0 + dy - 7 * Math.sin(an - 0.45));
      g.lineTo(x0 + dx - 7 * Math.cos(an + 0.45), y0 + dy - 7 * Math.sin(an + 0.45));
      g.closePath();
      g.fill();
      g.textAlign = 'center';
      g.fillText(txt, x0 + dx * 1.32, y0 + dy * 1.32 + 3);
    };

    if (mode === '3d') {
      let e0 = 1e9, e1 = -1e9, n0 = 1e9, n1 = -1e9;
      for (const f of flights) for (const p of f.loc) {
        const e = east(p), n = north(p);
        e0 = Math.min(e0, e);
        e1 = Math.max(e1, e);
        n0 = Math.min(n0, n);
        n1 = Math.max(n1, n);
      }
      const gs = niceStep(34, sc);
      const pj = (e: number, n: number, a: number): [number, number] => [X(e * cy + n * sy), Y(a * cp + (-e * sy + n * cy) * sp)];
      g.strokeStyle = GRID;
      for (let e = Math.floor(e0 / gs) * gs; e <= e1 + gs; e += gs) {
        const p1 = pj(e, n0 - gs, 0), p2 = pj(e, n1 + gs, 0);
        g.beginPath();
        g.moveTo(p1[0], p1[1]);
        g.lineTo(p2[0], p2[1]);
        g.stroke();
      }
      for (let n = Math.floor(n0 / gs) * gs; n <= n1 + gs; n += gs) {
        const p1 = pj(e0 - gs, n, 0), p2 = pj(e1 + gs, n, 0);
        g.beginPath();
        g.moveTo(p1[0], p1[1]);
        g.lineTo(p2[0], p2[1]);
        g.stroke();
      }
      const axis = (e: number, n: number, a: number, txt: string, col: string): void =>
        arrow(34, h - 34, (e * cy + n * sy) * 24, -(a * cp + (-e * sy + n * cy) * sp) * 24, txt, col);
      axis(1, 0, 0, 'E', '#ff8a80');
      axis(0, 1, 0, 'N', '#8be98b');
      axis(0, 0, 1, 'Up', '#8ab4ff');
    } else {
      const gu = niceStep(46, sc);
      const gm = mode === 'top' ? gu : niceStep(34, sc * ex);
      const gv = gm * ex;
      const ua = (0 - w / 2 - view.px) / sc + cu, ub = (w - w / 2 - view.px) / sc + cu;
      const va = (h / 2 + view.py - h) / sc + cv, vb = (h / 2 + view.py) / sc + cv;
      g.textAlign = 'left';
      for (let u = Math.ceil(ua / gu) * gu; u <= ub; u += gu) {
        g.strokeStyle = Math.abs(u) < 1e-9 ? AXIS : GRID;
        g.beginPath();
        g.moveTo(X(u), 0);
        g.lineTo(X(u), h);
        g.stroke();
        g.fillStyle = '#aab9af';
        g.fillText(String(+u.toFixed(1)), X(u) + 2, h - 3);
      }
      for (let v = Math.ceil(va / gv) * gv; v <= vb; v += gv) {
        g.strokeStyle = Math.abs(v) < 1e-9 ? AXIS : GRID;
        g.beginPath();
        g.moveTo(0, Y(v));
        g.lineTo(w, Y(v));
        g.stroke();
        g.fillStyle = '#aab9af';
        g.fillText(String(+(v / ex).toFixed(1)), 3, Y(v) - 2);
      }
      arrow(34, h - 34, 26, 0, mode === 'front' ? 'N' : 'E', '#e8c070');
      arrow(34, h - 34, 0, -26, mode === 'top' ? 'N' : 'Alt', '#e8c070');
    }

    g.lineJoin = 'round';
    g.lineCap = 'round';
    for (const pts of lines) {
      g.strokeStyle = 'rgba(0,0,0,.45)';
      g.lineWidth = 5;
      g.beginPath();
      pts.forEach((q, i) => (i ? g.lineTo(X(q[0]), Y(q[1])) : g.moveTo(X(q[0]), Y(q[1]))));
      g.stroke();
      g.lineWidth = 2.6;
      for (let i = 1; i < pts.length; i++) {
        g.strokeStyle = speedHsl((pts[i]![2] || 0) / speedMax, 90, 52);
        g.beginPath();
        g.moveTo(X(pts[i - 1]![0]), Y(pts[i - 1]![1]));
        g.lineTo(X(pts[i]![0]), Y(pts[i]![1]));
        g.stroke();
      }
      const ends: readonly (readonly [Pt, string])[] = [[pts[0]!, '#2ecc40'], [pts[pts.length - 1]!, '#ff3b30']];
      for (const [q, c] of ends) {
        g.fillStyle = c;
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(X(q[0]), Y(q[1]), 5, 0, TAU);
        g.fill();
        g.stroke();
      }
    }
    if (replayPosition) {
      const c = project(replayPosition);
      g.strokeStyle = '#fff';
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(X(c[0]), Y(c[1]), 7, 0, TAU);
      g.stroke();
      g.strokeStyle = '#000';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(X(c[0]), Y(c[1]), 8.5, 0, TAU);
      g.stroke();
    }
  });
  return `0 – ${(speedMax * 3.6).toFixed(0)} km/h`;
}
