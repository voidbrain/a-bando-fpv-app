import { fitCanvas, MONO } from './canvas-util';

/** The two ends of a measuring line; null = not picked yet. */
export interface MeasureState {
  a: { x: number; y: number } | null;
  b: { x: number; y: number } | null;
}

export const createMeasureState = (): MeasureState => ({ a: null, b: null });

/**
 * Register one end of the measurement from a pointer position (CSS pixels inside the canvas). The first click sets A,
 * the second sets B and finishes; clicking again starts over. Returns which point was set ('a' | 'b' | null when ignored).
 */
export function measureClick(s: MeasureState, x: number, y: number): 'a' | 'b' | null {
  if (!s.a) {
    s.a = { x, y };
    return 'a';
  }
  if (!s.b) {
    s.b = { x, y };
    return 'b';
  }
  s.a = { x, y };
  s.b = null;
  return 'a';
}

/** True when (x, y) lies within `tol` pixels of the finished A→B line (the click that removes it). */
export function measureHit(s: MeasureState, x: number, y: number, tol = 8): boolean {
  if (!s.a || !s.b) return false;
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((x - s.a.x) * dx + (y - s.a.y) * dy) / len2)) : 0;
  return Math.hypot(x - (s.a.x + t * dx), y - (s.a.y + t * dy)) <= tol;
}

export const measureClear = (s: MeasureState): void => {
  s.a = null;
  s.b = null;
};

/** Distance in metres between the two points given `metresPerPixel` (0 until both ends are picked). */
export function measureMetres(s: MeasureState, metresPerPixel: number): number {
  if (!s.a || !s.b) return 0;
  return Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) * metresPerPixel;
}

/**
 * Draw the measuring instrument over an already-painted canvas: a dashed line A→B with endpoint crosses and a label
 * plate showing the real-world distance. Coordinates are CSS pixels; `metresPerPixel` converts them to metres.
 */
export function drawMeasure(canvas: HTMLCanvasElement, state: MeasureState, cssW: number, cssH: number, metresPerPixel: number): void {
  if ((!state.a && !state.b) || cssW < 8 || cssH < 8) return;
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const g = fitCanvas(canvas, cssW, cssH, dpr);
  if (!g) return;
  const line = '#ffd166';
  const paint = (a: { x: number; y: number }, b: { x: number; y: number } | null): void => {
    g.save();
    g.strokeStyle = line;
    g.lineWidth = 1.5;
    g.setLineDash([6, 4]);
    if (b) {
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
    g.setLineDash([]);
    for (const p of [a, b]) {
      if (!p) continue;
      g.beginPath();
      g.moveTo(p.x - 6, p.y);
      g.lineTo(p.x + 6, p.y);
      g.moveTo(p.x, p.y - 6);
      g.lineTo(p.x, p.y + 6);
      g.stroke();
      // a solid marker so the first click is clearly registered
      g.fillStyle = line;
      g.beginPath();
      g.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      g.fill();
    }
    if (b) {
      const m = Math.hypot(b.x - a.x, b.y - a.y) * metresPerPixel;
      const text = m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(1)} m`;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      g.font = `bold 11px ${MONO}`;
      const tw = g.measureText(text).width + 10;
      g.fillStyle = 'rgba(20,34,28,.85)';
      g.fillRect(mx - tw / 2, my - 9, tw, 18);
      g.strokeStyle = 'rgba(255,209,102,.6)';
      g.lineWidth = 1;
      g.strokeRect(mx - tw / 2, my - 9, tw, 18);
      g.fillStyle = '#ffe9ad';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, mx, my);
    }
    g.restore();
  };
  paint(state.a ?? state.b!, state.a && state.b ? state.b : state.a ? null : state.b);
}
