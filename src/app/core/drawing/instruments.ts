import { clamp } from '../math';
import { COLORS, MONO, TAU, scoped } from './canvas-util';

export const INSTRUMENTS_SIZE = { w: 250, h: 140 } as const;

export interface InstrumentsInput {
  /** Degrees, nose-up positive. */
  pitch: number;
  /** Degrees, right bank positive. */
  roll: number;
  /** Geographic heading, degrees [0, 360). */
  heading: number;
}

const rad = (d: number): number => (d * Math.PI) / 180;

/** Betaflight-style artificial horizon (left) and heading compass with a moving card (right). */
export function drawInstruments(g: CanvasRenderingContext2D, { pitch, roll, heading }: InstrumentsInput): void {
  scoped(g, () => {
    g.clearRect(0, 0, INSTRUMENTS_SIZE.w, INSTRUMENTS_SIZE.h);
    g.textAlign = 'center';
    g.lineCap = 'round';
    drawHorizon(g, pitch, roll);
    drawHeadingCard(g, heading);
  });
}

function drawHorizon(g: CanvasRenderingContext2D, pitch: number, roll: number): void {
  const cx = 63, cy = 64, R = 56;
  scoped(g, () => {
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.clip();
    g.translate(cx, cy);
    g.rotate(-rad(roll));
    const py = clamp(pitch, -90, 90) * 1.5; // nose up = horizon moves down; right bank = horizon tilts left-down
    g.fillStyle = '#3c7fd0';
    g.fillRect(-R * 3, -R * 3 + py, R * 6, R * 3);
    g.fillStyle = '#8b5e34';
    g.fillRect(-R * 3, py, R * 6, R * 3);
    g.strokeStyle = '#fff';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(-R * 3, py);
    g.lineTo(R * 3, py);
    g.stroke();
    g.font = `8px ${MONO}`;
    g.fillStyle = '#fff';
    g.lineWidth = 1;
    for (let d = -90; d <= 90; d += 10) {
      if (!d) continue;
      const y = py - d * 1.5;
      const w = d % 20 === 0 ? 28 : 14;
      g.beginPath();
      g.moveTo(-w / 2, y);
      g.lineTo(w / 2, y);
      g.stroke();
      if (d % 20 === 0) {
        g.fillText(String(Math.abs(d)), -w / 2 - 9, y + 3);
        g.fillText(String(Math.abs(d)), w / 2 + 9, y + 3);
      }
    }
  });
  scoped(g, () => {
    g.translate(cx, cy);
    g.strokeStyle = '#e8eef0';
    g.lineWidth = 1.2;
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const r = rad(a);
      const l = a % 30 === 0 ? 9 : 5;
      g.beginPath();
      g.moveTo(Math.sin(r) * (R - 1), -Math.cos(r) * (R - 1));
      g.lineTo(Math.sin(r) * (R - 1 - l), -Math.cos(r) * (R - 1 - l));
      g.stroke();
    }
    g.rotate(-rad(roll));
    g.fillStyle = COLORS.orange;
    g.beginPath(); // roll pointer
    g.moveTo(0, -R + 2);
    g.lineTo(-5, -R + 11);
    g.lineTo(5, -R + 11);
    g.fill();
  });
  scoped(g, () => {
    g.translate(cx, cy);
    g.strokeStyle = '#ffd24a';
    g.fillStyle = '#ffd24a';
    g.lineWidth = 2.6;
    g.beginPath(); // fixed aircraft symbol
    g.moveTo(-34, 0);
    g.lineTo(-12, 0);
    g.lineTo(-12, 6);
    g.moveTo(34, 0);
    g.lineTo(12, 0);
    g.lineTo(12, 6);
    g.stroke();
    g.fillRect(-2, -2, 4, 4);
  });
  g.strokeStyle = COLORS.ring;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.stroke();
  g.fillStyle = COLORS.dim;
  g.font = `9px ${MONO}`;
  g.fillText(`ROLL ${roll.toFixed(0)}°  PITCH ${pitch.toFixed(0)}°`, cx, 136);
}

function drawHeadingCard(g: CanvasRenderingContext2D, heading: number): void {
  const cx = 187, cy = 64, R = 56;
  scoped(g, () => {
    g.translate(cx, cy);
    g.fillStyle = '#17201c';
    g.beginPath();
    g.arc(0, 0, R, 0, TAU);
    g.fill();
    scoped(g, () => {
      g.rotate(-rad(heading)); // the card turns, the aircraft stays
      g.strokeStyle = COLORS.ring;
      g.fillStyle = COLORS.text;
      g.font = `bold 10px ${MONO}`;
      for (let d = 0; d < 360; d += 5) {
        const r = rad(d);
        const l = d % 30 === 0 ? 9 : d % 10 === 0 ? 6 : 3;
        g.lineWidth = d % 90 === 0 ? 2 : 1;
        g.beginPath();
        g.moveTo(Math.sin(r) * (R - 1), -Math.cos(r) * (R - 1));
        g.lineTo(Math.sin(r) * (R - 1 - l), -Math.cos(r) * (R - 1 - l));
        g.stroke();
      }
      for (let d = 0; d < 360; d += 30) {
        const r = rad(d);
        const txt = d % 90 === 0 ? 'NESW'.charAt(d / 90) : String(d / 10);
        scoped(g, () => {
          g.translate(Math.sin(r) * (R - 18), -Math.cos(r) * (R - 18));
          g.rotate(r);
          g.fillStyle = d === 0 ? '#ff5a4d' : COLORS.text;
          g.fillText(txt, 0, 3);
        });
      }
    });
    g.fillStyle = COLORS.orange;
    g.beginPath(); // lubber mark
    g.moveTo(0, -R - 1);
    g.lineTo(-5, -R + 8);
    g.lineTo(5, -R + 8);
    g.fill();
    g.strokeStyle = '#fff';
    g.fillStyle = '#fff';
    g.lineWidth = 3;
    g.beginPath(); // aircraft in the middle
    g.moveTo(0, -20);
    g.lineTo(0, 18);
    g.moveTo(-17, 0);
    g.lineTo(17, 0);
    g.moveTo(-7, 16);
    g.lineTo(7, 16);
    g.stroke();
    g.beginPath();
    g.moveTo(0, -24);
    g.lineTo(-4, -17);
    g.lineTo(4, -17);
    g.fill();
  });
  g.strokeStyle = COLORS.ring;
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.stroke();
  g.fillStyle = COLORS.dim;
  g.font = `9px ${MONO}`;
  g.fillText(`HDG ${heading.toFixed(0)}°`, cx, 136);
}
