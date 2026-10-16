import { clamp, lowerBound } from '../math';
import { Quat, attitudeQuat } from '../math3d';
import type { Telemetry } from '../models';
import { COLORS, MONO, TAU, scoped } from './canvas-util';
import { DEFAULT_DRONE_VIEW, drawDroneModel, type DroneView } from './drone-model';

export const BLACKBOX_SIZE = { w: 340, h: 300 } as const;
/** Region of the card where dragging turns the 3D drone (x < 166, 112 < y < 246). */
export const DRONE_DRAG_AREA = { x1: 166, y0: 112, y1: 246 } as const;

const MOTOR_MIN = 48;
const MOTOR_SPAN = 1999;
const TRAIL_STEPS = 16;
const TRAIL_STEP_S = 0.045;
const REF = new Quat();

export interface BlackboxState {
  view: DroneView;
}
export const createBlackboxState = (): BlackboxState => ({ view: { ...DEFAULT_DRONE_VIEW } });

/**
 * Blackbox-style panel from the telemetry at replay time `t`: two stick gimbals with a fading trail of the last
 * ~0.7 s, four motor bars, a 3D drone model with attitude badge, heading, and a +-2 s gyro graph.
 */
export function drawBlackbox(g: CanvasRenderingContext2D, T: Telemetry, t: number, state: BlackboxState): void {
  scoped(g, () => {
    const k = lowerBound(T.t, t);
    g.clearRect(0, 0, BLACKBOX_SIZE.w, BLACKBOX_SIZE.h);
    g.font = `10px ${MONO}`;
    const roll = T.att[k * 3]!;
    const pitchUp = -T.att[k * 3 + 1]!; // Betaflight pitch is positive nose-down
    const yaw = T.att[k * 3 + 2]!;

    const gimbal = (x: number, y: number, label: string, get: (idx: number) => [number, number]): void => {
      g.strokeStyle = COLORS.panelLine;
      g.lineWidth = 1;
      g.strokeRect(x, y, 90, 90);
      g.beginPath();
      g.moveTo(x + 45, y);
      g.lineTo(x + 45, y + 90);
      g.moveTo(x, y + 45);
      g.lineTo(x + 90, y + 45);
      g.stroke();
      const pos = (idx: number): [number, number] => {
        const a = get(idx);
        return [x + 45 + clamp(a[0], -1, 1) * 43, y + 45 - clamp(a[1], -1, 1) * 43];
      };
      g.lineCap = 'round';
      let prev = pos(k);
      for (let j = 1; j <= TRAIL_STEPS; j++) {
        const p = pos(lowerBound(T.t, Math.max(0, t - j * TRAIL_STEP_S)));
        const f = 1 - j / (TRAIL_STEPS + 1);
        g.strokeStyle = `rgba(183,237,131,${0.34 * f})`;
        g.lineWidth = 2 + 3 * f;
        g.beginPath();
        g.moveTo(prev[0], prev[1]);
        g.lineTo(p[0], p[1]);
        g.stroke();
        g.fillStyle = `rgba(183,237,131,${0.3 * f})`;
        g.beginPath();
        g.arc(p[0], p[1], 1 + 4.5 * f, 0, TAU);
        g.fill();
        prev = p;
      }
      const c = pos(k);
      g.fillStyle = COLORS.accent;
      g.beginPath();
      g.arc(c[0], c[1], 6, 0, TAU);
      g.fill();
      g.lineWidth = 1;
      g.fillStyle = COLORS.dim;
      g.fillText(label, x + 2, y + 103);
    };
    gimbal(8, 6, 'yaw / throttle', (i) => [T.rc[i * 4 + 2]! / 500, (T.rc[i * 4 + 3]! - 1500) / 500]);
    gimbal(108, 6, 'roll / pitch', (i) => [T.rc[i * 4]! / 500, T.rc[i * 4 + 1]! / 500]);

    for (let i = 0; i < 4; i++) {
      const p = clamp((T.mot[k * 4 + i]! - MOTOR_MIN) / MOTOR_SPAN, 0, 1);
      const x = 212 + i * 30;
      g.fillStyle = '#24332c';
      g.fillRect(x, 6, 24, 90);
      g.fillStyle = `hsl(${120 - p * 120},80%,50%)`;
      g.fillRect(x, 6 + 90 * (1 - p), 24, 90 * p);
      g.fillStyle = COLORS.text;
      g.fillText(String(Math.round(p * 100)), x + 3, 106);
      g.fillStyle = COLORS.dim;
      g.fillText(`M${i + 1}`, x + 4, 118);
    }

    const q = attitudeQuat(REF, pitchUp, 0, roll);
    const mot = [T.mot[k * 4]!, T.mot[k * 4 + 1]!, T.mot[k * 4 + 2]!, T.mot[k * 4 + 3]!];
    const info = drawDroneModel(g, 2, 122, 160, 120, q, mot, state.view);
    const ud = info.up;
    g.font = `bold 11px ${MONO}`;
    if (ud <= 0.2) {
      g.fillStyle = ud > -0.2 ? '#ffd24a' : '#ff6b6b';
      g.fillText(ud > -0.2 ? '◀▶ SIDEWAYS' : '▼ INVERTED', 170, 136);
    }
    g.font = `10px ${MONO}`;
    g.fillStyle = COLORS.text;
    g.fillText(`roll  ${(roll * 57.3).toFixed(0)}°`, 170, 156);
    g.fillText(`pitch ${(pitchUp * 57.3).toFixed(0)}°`, 170, 170);
    g.fillText(`hdg   ${((((yaw + T.yawOff) * 57.3) % 360 + 360) % 360).toFixed(0)}°`, 170, 184);

    // gyro, +-2 s around the cursor
    const a = lowerBound(T.t, t - 2);
    const b = lowerBound(T.t, t + 2);
    let mx = 300;
    for (let i = a; i <= b; i++) for (let j = 0; j < 3; j++) mx = Math.max(mx, Math.abs(T.gyro[i * 3 + j]!));
    mx = Math.min(mx, 2000);
    g.strokeStyle = '#33463d';
    g.strokeRect(8, 246, 324, 52);
    g.beginPath();
    g.moveTo(8, 272);
    g.lineTo(332, 272);
    g.moveTo(170, 246);
    g.lineTo(170, 298);
    g.stroke();
    ['#ff6b6b', '#6bff8a', '#6bb0ff'].forEach((c, j) => {
      g.strokeStyle = c;
      g.beginPath();
      const step = Math.max(1, Math.floor((b - a) / 320));
      for (let i = a; i <= b; i += step) {
        const x = 8 + ((T.t[i]! - (t - 2)) / 4) * 324;
        const y = 272 - (T.gyro[i * 3 + j]! / mx) * 26;
        if (i === a) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    });
    g.fillStyle = COLORS.dim;
    g.fillText(`gyro roll/pitch/yaw ±${mx.toFixed(0)}°/s`, 12, 243);
  });
}

export function inDroneDragArea(x: number, y: number): boolean {
  return x < DRONE_DRAG_AREA.x1 && y > DRONE_DRAG_AREA.y0 && y < DRONE_DRAG_AREA.y1;
}
