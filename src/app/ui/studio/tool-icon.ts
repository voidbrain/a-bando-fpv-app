import { Component, computed, input } from '@angular/core';

/** One stroke of an icon: an SVG path on a 24 × 24 grid. `f` fills it, `d` dashes it. */
interface Stroke {
  p: string;
  f?: boolean;
  d?: boolean;
}

const dot = (x: number, y: number, r = 1.3): Stroke => ({ p: `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`, f: true });

/** The editor's tool icons: plain outlines in the current colour, so they follow the theme. */
export const TOOL_ICONS: Readonly<Record<string, readonly Stroke[]>> = {
  select: [{ p: 'M5 3 L19 10.5 L12.5 12.5 L10 19.5 Z' }],
  measure: [{ p: 'M3 16 L16 3 L21 8 L8 21 Z' }, { p: 'M7 12 l2.5 2.5 M10 9 l2 2 M13 6 l2.5 2.5' }],
  building: [{ p: 'M3 11 L12 3 L21 11' }, { p: 'M5 9.5 V20 H19 V9.5' }, { p: 'M10 20 v-5.5 h4 V20' }],
  merge: [{ p: 'M4 4 H14 V10 H20 V20 H10 V14 H4 Z' }, { p: 'M10 10 v4 M10 10 h4', d: true }],
  cut: [{ p: 'M4 4 H20 V20 H4 Z' }, { p: 'M12 4 V12 H20', d: true }, { p: 'M15 15 l4 4 M19 15 l-4 4' }],
  wing: [{ p: 'M3 7 H15 V20 H3 Z' }, { p: 'M15 12 H21 V20 H15', d: true }, { p: 'M9 11 v5 M6.5 13.5 h5' }],
  structure: [{ p: 'M9 21 V9 L12 3 L15 9 V21' }, { p: 'M7 21 H17 M9 13 H15 M9 17 H15' }],
  tree: [{ p: 'M6 10 a6 6 0 1 1 12 0 a6 6 0 0 1 -12 0' }, { p: 'M12 16 V21 M9 21 H15' }],
  brush: [{ p: 'M3 19 C8 19 6 9 12 9 S16 17 21 13', d: true }, dot(5, 18, 1.8), dot(12, 9, 1.8), dot(19, 14, 1.8)],
  areaRect: [{ p: 'M4 5 H20 V19 H4 Z', d: true }, dot(9, 10), dot(15, 9), dot(12, 15), dot(7, 15.5), dot(16.5, 15.5)],
  areaCircle: [{ p: 'M3 12 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0', d: true }, dot(9, 10), dot(15, 9.5), dot(12, 15), dot(8, 14.5)],
  lasso: [{ p: 'M5 10 C4 5 12 3 17 5 C22 7 20 13 15 14 C12 14.5 12 18 9 19 C6 19.5 4 16 5 10 Z', d: true }, dot(9, 9.5), dot(15, 9), dot(12, 13)],
  fence: [{ p: 'M4 21 V9 l2 -2.5 l2 2.5 V21 M10 21 V9 l2 -2.5 l2 2.5 V21 M16 21 V9 l2 -2.5 l2 2.5 V21' }, { p: 'M3 12.5 H21 M3 17.5 H21' }],
  wall: [{ p: 'M3 6 H21 V11 H3 Z M3 11 H21 V16 H3 Z M3 16 H21 V20 H3 Z' }, { p: 'M9 6 V11 M15 11 V16 M9 16 V20' }],
  door: [{ p: 'M6 21 V4 H18 V21 M3 21 H21' }, dot(15, 13, 1.1)],
  window: [{ p: 'M5 4 H19 V20 H5 Z M12 4 V20 M5 12 H19' }],
  void: [{ p: 'M4 4 H20 V20 H4 Z', d: true }, { p: 'M4 4 L20 20 M20 4 L4 20' }],
  column: [{ p: 'M6 12 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0' }, dot(12, 12, 1.6)],
  stairs: [{ p: 'M3 20 H8 V15 H13 V10 H18 V5 H21' }, { p: 'M3 20 V21 H21 V5', d: true }],
  pinStart: [{ p: 'M6 21 V4' }, { p: 'M6 4 H18 L15 8 L18 12 H6', f: true }],
  pinEnd: [{ p: 'M6 21 V4' }, { p: 'M6 4 H18 L15 8 L18 12 H6' }],
};

/** A tool's icon as a small inline SVG. */
@Component({
  selector: 'app-tool-icon',
  template: `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      @for (s of strokes(); track $index) {
        <path [attr.d]="s.p" [attr.fill]="s.f ? 'currentColor' : 'none'" [attr.stroke-dasharray]="s.d ? '2.5 2.5' : null" />
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-grid;
      place-items: center;
      line-height: 0;
    }
  `,
})
export class ToolIcon {
  readonly name = input.required<string>();
  protected readonly strokes = computed(() => TOOL_ICONS[this.name()] ?? []);
}
