import { formatClock, lowerBound, speedHsl } from '../math';
import type { Flight } from '../models';
import { MONO, scoped } from './canvas-util';

export const TIMELINE_HEIGHT = 46;
const STEPS = [1, 2, 5, 10, 20, 30, 60, 120, 300];

export interface TimelineInput {
  flight: Flight;
  /** Cached times of the GPS points (see pointTimes). */
  times: ArrayLike<number>;
  /** Replay time, seconds. */
  time: number;
  liftoff: number | null;
  firstFlip: number | null;
  /** Top speed of the flight, m/s (colour / height scale). */
  speedMax: number;
}

/** Tick spacing so labels are at least 56 px apart. */
export const tickStep = (width: number, duration: number): number => STEPS.find((s) => width / (duration / s) >= 56) ?? 300;

/** Speed profile of the flight (colour = speed), tick labels, take-off / flip markers and the playhead. Returns the caption. */
export function drawTimeline(g: CanvasRenderingContext2D, w: number, h: number, { flight: P, times, time, liftoff, firstFlip, speedMax }: TimelineInput): string {
  const vm = Math.max(0.1, speedMax);
  const t0 = P.pts[0]!.t;
  const dur = P.dur;
  scoped(g, () => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(110,130,118,.22)';
    g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 2) {
      const i = Math.min(P.spd.length - 1, lowerBound(times, t0 + (x / w) * dur));
      const f = Math.min(1, (P.spd[i] ?? 0) / vm);
      g.fillStyle = speedHsl(f, 90, 50);
      const bh = 2 + f * (h - 12);
      g.fillRect(x, h - bh, 2, bh);
    }
    const step = tickStep(w, dur);
    g.fillStyle = '#aab9af';
    g.font = `9px ${MONO}`;
    g.strokeStyle = 'rgba(170,185,175,.35)';
    g.lineWidth = 1;
    for (let t = 0; t <= dur; t += step) {
      const x = (t / dur) * w;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
      g.fillText(formatClock(t).replace(/\.0$/, ''), x + 2, 10);
    }
    const marker = (t: number | null, colour: string, label: string): void => {
      if (t == null || !dur) return;
      const x = (t / dur) * w;
      g.fillStyle = colour;
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x - 5, h - 9);
      g.lineTo(x + 5, h - 9);
      g.fill();
      g.fillText(label, x + 7, h - 2);
    };
    marker(liftoff, '#ff9a2e', 'T/O');
    marker(firstFlip, '#c070ff', 'F');
    const cx = dur ? (time / dur) * w : 0;
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx, 0);
    g.lineTo(cx, h);
    g.stroke();
  });
  return `${formatClock(time)} / ${formatClock(dur)} · max ${(vm * 3.6).toFixed(0)} km/h`;
}

/** Click / drag position on the timeline -> replay time. */
export const timeAtX = (x: number, width: number, duration: number): number => (Math.max(0, Math.min(width, x)) / Math.max(1, width)) * duration;
