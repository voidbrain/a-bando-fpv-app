import { GRID_DT } from '../sync/features';
import type { SyncFeatures } from '../sync/matcher';
import { MONO, scoped } from './canvas-util';

export const SYNC_PLOT_HEIGHT = 60;
const SPAN = 60; // seconds of log shown

/**
 * Alignment plot: log rotation (blue) vs video motion (orange) over the first minute of flight, shifted by the
 * current offset. Nudge the offset and watch the peaks line up.
 */
export function drawSyncPlot(g: CanvasRenderingContext2D, w: number, h: number, f: SyncFeatures, offset: number): void {
  scoped(g, () => {
    g.clearRect(0, 0, w, h);
    const F = f.F[f.logFeature];
    const V = f.V[f.videoFeature];
    const fa: number[] = [];
    const va: number[] = [];
    let f0 = 1e9, f1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (let x = 0; x < w; x++) {
      const lt = f.L0 + (x / w) * SPAN;
      const k = Math.floor(lt / GRID_DT);
      const j = Math.floor((lt + offset - f.vt0) / GRID_DT);
      const a = k >= 0 && k < F.length ? (F[k] as number) : NaN;
      const b = j >= 0 && j < V.length ? (V[j] as number) : NaN;
      fa.push(a);
      va.push(b);
      if (!Number.isNaN(a)) {
        f0 = Math.min(f0, a);
        f1 = Math.max(f1, a);
      }
      if (!Number.isNaN(b)) {
        v0 = Math.min(v0, b);
        v1 = Math.max(v1, b);
      }
    }
    g.lineWidth = 1.4;
    const series: readonly (readonly [number[], number, number, string])[] = [[fa, f0, f1, '#6bb0ff'], [va, v0, v1, '#ff9a2e']];
    for (const [arr, lo, hi, colour] of series) {
      g.strokeStyle = colour;
      g.beginPath();
      let on = false;
      arr.forEach((y, x) => {
        if (Number.isNaN(y)) {
          on = false;
          return;
        }
        const yy = h - 4 - ((y - lo) / Math.max(hi - lo, 1e-9)) * (h - 14);
        if (on) g.lineTo(x, yy);
        else g.moveTo(x, yy);
        on = true;
      });
      g.stroke();
    }
    g.fillStyle = '#aab9af';
    g.font = `9px ${MONO}`;
    g.fillText(`blue = log · orange = video (${f.logFeature} vs ${f.videoFeature}) · shifted by the offset`, 4, 9);
  });
}
