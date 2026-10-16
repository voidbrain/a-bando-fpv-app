/** Shared canvas helpers for the instrument widgets. */
export const TAU = Math.PI * 2;

/** Size a canvas to its CSS size times the device pixel ratio (max 2) and set the transform so drawing uses CSS pixels. */
export function fitCanvas(cv: HTMLCanvasElement, w: number, h: number, dprMax = 2): CanvasRenderingContext2D | null {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, dprMax);
  const pw = Math.max(1, Math.round(w * dpr));
  const ph = Math.max(1, Math.round(h * dpr));
  if (cv.width !== pw || cv.height !== ph) {
    cv.width = pw;
    cv.height = ph;
  }
  const g = cv.getContext('2d');
  if (!g) return null;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

export const MONO = 'ui-monospace,Menlo,monospace';
export const COLORS = {
  panelLine: '#4a5d53',
  dim: '#aab9af',
  text: '#eef4ed',
  ring: '#cfd9d3',
  orange: '#ff9a2e',
  accent: '#b7ed83',
} as const;

/** Run `fn` with the context state saved and restored (text alignment, line caps, transforms...). */
export function scoped(g: CanvasRenderingContext2D, fn: () => void): void {
  g.save();
  try {
    fn();
  } finally {
    g.restore();
  }
}
