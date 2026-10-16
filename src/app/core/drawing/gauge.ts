import { speedHsl } from '../math';
import { COLORS, MONO, TAU, scoped } from './canvas-util';

export const GAUGE_SIZE = { w: 150, h: 118 } as const;

export interface GaugeInput {
  /** m/s */
  speed: number;
  /** Top of the scale, km/h. */
  scaleMax: number;
  source: 'SIM' | 'REPLAY';
}

/** Dial scale for a replayed flight: a multiple of 20 km/h, at least 60. */
export const replayScaleMax = (topSpeedMs: number): number => Math.max(60, Math.ceil((topSpeedMs * 3.6) / 20) * 20);
export const SIM_SCALE_MAX = 120;

/** Tachometer-style speed dial: motor-power colour arc (blue -> red), needle and a digital readout. */
export function drawGauge(g: CanvasRenderingContext2D, { speed, scaleMax: M, source }: GaugeInput): void {
  scoped(g, () => {
    const kmh = speed * 3.6;
    const k = Math.min(kmh, M);
    const a0 = Math.PI * 0.75;
    const sw = Math.PI * 1.5;
    const cx = 75, cy = 64, R = 46;
    g.clearRect(0, 0, GAUGE_SIZE.w, GAUGE_SIZE.h);
    g.lineCap = 'butt';
    for (let i = 0; i < 60; i++) {
      const f = i / 60;
      g.strokeStyle = speedHsl(f, 90, 50);
      g.lineWidth = 7;
      g.beginPath();
      g.arc(cx, cy, R - 4, a0 + sw * f, a0 + sw * (f + 1 / 60) + 0.01);
      g.stroke();
    }
    g.fillStyle = COLORS.text;
    g.strokeStyle = COLORS.ring;
    g.lineWidth = 1.2;
    g.font = `9px ${MONO}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let s = 0; s <= M; s += 10) {
      const a = a0 + (sw * s) / M;
      const major = s % 20 === 0;
      const c = Math.cos(a), n = Math.sin(a);
      g.beginPath();
      g.moveTo(cx + c * R, cy + n * R);
      g.lineTo(cx + c * (R + (major ? 7 : 4)), cy + n * (R + (major ? 7 : 4)));
      g.stroke();
      if (major) g.fillText(String(s), cx + c * (R + 14), cy + n * (R + 14));
    }
    const a = a0 + (sw * k) / M;
    g.strokeStyle = '#fff';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * (R - 8), cy + Math.sin(a) * (R - 8));
    g.stroke();
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(cx, cy, 4, 0, TAU);
    g.fill();
    g.font = `bold 22px ${MONO}`;
    g.fillText(String(Math.round(kmh)), cx, cy + 24);
    g.font = `9px ${MONO}`;
    g.fillStyle = COLORS.dim;
    g.fillText(`km/h · ${source}`, cx, cy + 40);
  });
}
