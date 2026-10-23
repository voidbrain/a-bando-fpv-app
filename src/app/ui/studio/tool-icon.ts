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
  // ---- option pictures (structure kinds, tree kinds, fence materials, shapes) ----
  chimney: [{ p: 'M9 21 L10 4 H14 L15 21 Z' }, { p: 'M10 8 H14' }],
  silo: [{ p: 'M7 21 V8 a5 4 0 0 1 10 0 V21 Z' }, { p: 'M7 13 H17' }],
  tank: [{ p: 'M4 10 a8 3 0 0 1 16 0 V18 a8 3 0 0 1 -16 0 Z' }, { p: 'M4 10 a8 3 0 0 0 16 0' }],
  waterTower: [{ p: 'M7 4 H17 V11 H7 Z' }, { p: 'M8 11 L6 21 M16 11 L18 21 M7 16 H17' }],
  lattice: [{ p: 'M8 21 L12 3 L16 21' }, { p: 'M9 16 H15 M10 11 H14 M9 16 L14 11 M15 16 L10 11' }],
  crane: [{ p: 'M8 21 V4 M3 5 H21 M8 4 L12 5 M18 5 V12' }, { p: 'M16.5 12 H19.5 V14 H16.5 Z', f: true }],
  bridge: [{ p: 'M2 10 H22 M2 13 H22' }, { p: 'M5 13 V20 M12 13 V20 M19 13 V20' }],
  ramp: [{ p: 'M3 20 L21 8 V20 Z' }],
  container: [{ p: 'M3 8 H21 V18 H3 Z' }, { p: 'M7 8 V18 M11 8 V18 M15 8 V18' }],
  car: [{ p: 'M3 16 V12 L6 8 H15 L19 12 H21 V16 Z' }, dot(7, 17, 1.8), dot(17, 17, 1.8)],
  truck: [{ p: 'M2 16 V7 H14 V16 Z M14 10 H18 L21 13 V16 H14' }, dot(6, 17, 1.8), dot(17, 17, 1.8)],
  excavator: [{ p: 'M3 18 H13 a2 2 0 0 0 0 -4 H3 a2 2 0 0 0 0 4 Z M5 14 V9 H10 V14 M10 10 L16 5 L20 10' }, { p: 'M20 10 L21.5 13 L18 13 Z', f: true }],
  conifer: [{ p: 'M12 3 L18 15 H6 Z' }, { p: 'M12 15 V21' }],
  mixedTrees: [{ p: 'M3 10 a4 4 0 1 1 8 0 a4 4 0 0 1 -8 0 M7 14 V20' }, { p: 'M17 5 L21 15 H13 Z M17 15 V20' }],
  brick: [{ p: 'M3 6 H21 V20 H3 Z M3 10.5 H21 M3 15 H21' }, { p: 'M9 6 V10.5 M15 6 V10.5 M6 10.5 V15 M12 10.5 V15 M18 10.5 V15 M9 15 V20 M15 15 V20' }],
  concrete: [{ p: 'M3 5 H11 V20 H3 Z M13 5 H21 V20 H13 Z' }],
  metalSheet: [{ p: 'M3 5 H21 V20 H3 Z' }, { p: 'M6 5 V20 M9 5 V20 M12 5 V20 M15 5 V20 M18 5 V20', d: true }],
  chainlink: [{ p: 'M3 21 V4 M21 21 V4' }, { p: 'M3 6 L18 21 M3 13 L11 21 M10 4 L21 15 M17 4 L21 8 M21 6 L6 21 M21 13 L13 21 M14 4 L3 15 M7 4 L3 8', d: true }],
  greenhouse: [{ p: 'M3 20 V12 a9 9 0 0 1 18 0 V20 Z' }, { p: 'M12 3 V20 M7.5 5 V20 M16.5 5 V20', d: true }],
  colSquare: [{ p: 'M7 7 H17 V17 H7 Z' }, dot(12, 12, 1.6)],
  // ---- ground layers ----
  road: [{ p: 'M7 21 L10 3 M17 21 L14 3' }, { p: 'M12 5 V8 M12 11 V14 M12 17 V20' }],
  track: [{ p: 'M5 21 C8 14 6 9 10 3 M13 21 C16 14 14 9 18 3', d: true }],
  pathway: [{ p: 'M12 21 C9 16 15 12 11 7 C9 5 11 4 12 3', d: true }, dot(7, 18, 0.9), dot(17, 9, 0.9)],
  rail: [{ p: 'M8 21 L10 3 M16 21 L14 3' }, { p: 'M6.5 18 H17.5 M7.3 13 H16.7 M8 8 H16 M8.6 4.5 H15.4' }],
  surface: [{ p: 'M4 8 L12 4 L20 8 L20 16 L12 20 L4 16 Z' }, { p: 'M8 10 h0.01 M12 12 h0.01 M16 10 h0.01 M10 15 h0.01 M14 15 h0.01' }],
  water: [{ p: 'M3 9 C6 7 8 11 12 9 S18 7 21 9 M3 14 C6 12 8 16 12 14 S18 12 21 14 M3 19 C6 17 8 21 12 19 S18 17 21 19' }],
  grassland: [{ p: 'M4 20 L6 14 M8 20 L8 12 M12 20 L11 13 M16 20 L17 12 M20 20 L19 15' }, { p: 'M2 20 H22' }],
  asphalt: [{ p: 'M3 6 H21 V18 H3 Z' }, dot(7, 10, 0.7), dot(13, 9, 0.7), dot(17, 13, 0.7), dot(9, 15, 0.7)],
  gravel: [dot(6, 8, 1.4), dot(12, 7, 1.1), dot(17, 9, 1.5), dot(8, 14, 1.2), dot(14, 14, 1.4), dot(19, 16, 1), dot(5, 19, 1.1), dot(11, 19, 1.3)],
  dirt: [{ p: 'M2 15 C6 12 9 17 13 14 S19 12 22 15' }, { p: 'M2 19 H22', d: true }, dot(7, 9, 0.8), dot(16, 8, 0.8)],
  sand: [{ p: 'M2 18 C6 14 10 14 14 17 S20 19 22 16' }, { p: 'M4 11 C7 9 10 9 13 11', d: true }],
  rubble: [{ p: 'M3 20 L6 15 L10 17 L12 12 L16 15 L19 11 L21 20 Z' }, { p: 'M8 9 L10 7 L12 9 Z M15 6 L17 5 L18 7 Z' }],
  blocks: [{ p: 'M3 13 H11 V21 H3 Z M13 13 H21 V21 H13 Z M8 3 H16 V11 H8 Z' }],
  gate: [{ p: 'M5 21 V5 H19 V21' }, { p: 'M3 21 H7 M17 21 H21' }],
  diveGate: [{ p: 'M4 9 L12 5 L20 9 L12 13 Z' }, { p: 'M4 9 V20 M20 9 V20 M12 13 V21', d: true }],
  // ---- underground ----
  tunnel: [{ p: 'M2 20 C6 6 18 6 22 20' }, { p: 'M7 20 V15 a5 5 0 0 1 10 0 V20' }],
  bunker: [{ p: 'M2 9 H22' }, { p: 'M5 12 H19 V20 H5 Z', d: true }, { p: 'M12 9 V12' }],
  culvertBox: [{ p: 'M5 6 H19 V18 H5 Z M8 9 H16 V15 H8 Z' }],
  culvertPipe: [{ p: 'M4 12 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0 M7 12 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0' }],
  culvertVault: [{ p: 'M4 20 V11 a8 8 0 0 1 16 0 V20 M7 20 V12 a5 5 0 0 1 10 0 V20' }],
  // ---- terrain ----
  terrainRaise: [{ p: 'M2 20 C7 20 8 11 12 11 S17 20 22 20' }, { p: 'M12 8 V2 M9 5 L12 2 L15 5' }],
  terrainLower: [{ p: 'M2 10 C7 10 8 19 12 19 S17 10 22 10' }, { p: 'M12 3 V9 M9 6 L12 9 L15 6' }],
  terrainSmooth: [{ p: 'M2 15 L5 10 L8 16 L11 9 L14 15', d: true }, { p: 'M2 19 C8 19 10 14 14 14 S20 19 22 19' }],
  terrainFlatten: [{ p: 'M2 20 L7 11 H17 L22 20' }, { p: 'M5 8 H19', d: true }],
  terrainHill: [{ p: 'M2 19 Q12 1 22 19' }, { p: 'M2 19 H22', d: true }],
  terrainCrater: [{ p: 'M2 11 H5 Q12 25 19 11 H22' }, { p: 'M5 11 L6 9 M19 11 L18 9' }],
  // ---- views panel: cameras, view toggles, show / hide ----
  eye: [{ p: 'M2 12 C5 6 19 6 22 12 C19 18 5 18 2 12 Z' }, { p: 'M9 12 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0' }],
  eyeOff: [{ p: 'M2 12 C5 6 19 6 22 12 C19 18 5 18 2 12 Z' }, { p: 'M4 20 L20 4' }],
  eyeHalf: [{ p: 'M2 12 C5 6 19 6 22 12 C19 18 5 18 2 12 Z' }, { p: 'M12 9 a3 3 0 0 0 0 6 Z', f: true }],
  camOrbit: [{ p: 'M3 12 a9 4 0 1 0 18 0 a9 4 0 1 0 -18 0', d: true }, { p: 'M9 12 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0' }, { p: 'M19 9 l2 3 l-3 1' }],
  camChase: [{ p: 'M10 15 L14 9 L18 15 L14 13.5 Z' }, { p: 'M3 21 L8 17 M5 21 l3 -4 l-4 1' }],
  camFpv: [{ p: 'M3 7 H21 V17 H3 Z' }, { p: 'M12 10 v4 M10 12 h4' }],
  camTop: [{ p: 'M4 4 H20 V20 H4 Z', d: true }, { p: 'M12 7 L15 15 L12 13.5 L9 15 Z' }],
  roof: [{ p: 'M3 11 L12 4 L21 11' }, { p: 'M5 11 V20 H19 V11', d: true }],
  xray: [{ p: 'M4 6 H14 V18 H4 Z', d: true }, { p: 'M10 10 H20 V20 H10 Z' }],
  follow: [{ p: 'M12 3 a9 9 0 1 0 0.01 0', d: true }, { p: 'M12 8 L15.5 16 L12 14 L8.5 16 Z', f: true }],
  recentre: [{ p: 'M12 3 V7 M12 17 V21 M3 12 H7 M17 12 H21' }, { p: 'M7 12 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0' }],
  satellite: [{ p: 'M4 18 L10 12 L13 15 L20 8' }, { p: 'M3 4 H21 V20 H3 Z' }, dot(8, 8, 1.4)],
  resetLayout: [{ p: 'M4 12 a8 8 0 1 0 2.5 -5.8' }, { p: 'M3 3 V7.5 H7.5' }],
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
