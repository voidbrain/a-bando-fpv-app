import { computed, signal } from '@angular/core';
import type { Pt } from '../../../core/footprint';
import { brushStroke, contourPaths, defaultTerrain, heightPixels, type Falloff, type TerrainOp } from '../../../core/terrain';
import type { GroundStyle } from '../../../three/site-model';
import type { PickOption } from '../pick-menu';
import type { EditorHost } from './editor-host';

/** The terrain brushes, each its own entry in the palette's Terrain group. */
export const TERRAIN_OPS: readonly { op: TerrainOp; icon: string; name: string }[] = [
  { op: 'raise', icon: 'terrainRaise', name: 'Terrain · raise' },
  { op: 'lower', icon: 'terrainLower', name: 'Terrain · lower' },
  { op: 'smooth', icon: 'terrainSmooth', name: 'Terrain · smooth' },
  { op: 'flatten', icon: 'terrainFlatten', name: 'Terrain · flatten' },
  { op: 'hill', icon: 'terrainHill', name: 'Terrain · hill' },
  { op: 'crater', icon: 'terrainCrater', name: 'Terrain · crater' },
  { op: 'ramp', icon: 'ramp', name: 'Terrain · ramp' },
];

/** The Terrain tool: brush options, how the ground is drawn (contours, height map, 3D style) and the strokes. */
export class TerrainTool {
  constructor(private readonly h: EditorHost) {}

  /** How the terrain is drawn in 3D (and, as a height map, under the 2D plan). */
  readonly groundStyle = signal<GroundStyle>('natural');
  readonly asGroundStyle = (e: Event): GroundStyle => {
    const v = (e.target as HTMLSelectElement).value;
    return v === 'height' || v === 'wire' ? v : 'natural';
  };
  readonly op = signal<TerrainOp>('raise');
  readonly radius = signal(8);
  readonly strength = signal(2);
  readonly falloff = signal<Falloff>('smooth');
  readonly opOptions: readonly PickOption[] = TERRAIN_OPS.map((t) => ({ id: t.op, label: t.op[0]!.toUpperCase() + t.op.slice(1), icon: t.icon }));
  readonly falloffOptions: readonly PickOption[] = [
    { id: 'smooth', label: 'Soft edge', icon: 'terrainHill', hint: 'Rounded, natural' },
    { id: 'linear', label: 'Straight edge', icon: 'ramp', hint: 'A steady slope to the rim' },
    { id: 'flat', label: 'Hard edge', icon: 'terrainFlatten', hint: 'Full strength almost to the rim' },
  ];
  readonly asOp = (v: string): TerrainOp => TERRAIN_OPS.find((t) => t.op === v)?.op ?? 'raise';
  readonly asFalloff = (v: string): Falloff => (v === 'linear' || v === 'flat' ? v : 'smooth');
  /** What "strength" means for the current operation, for its label. */
  readonly strengthLabel = computed(() => ({ raise: 'up', lower: 'down', smooth: 'amount %', flatten: '', hill: 'height', crater: 'depth', ramp: 'rise' })[this.op()]);
  /** The radius of the brush ring (a ramp's radius is its half width). */
  readonly ring = computed(() => (this.op() === 'ramp' ? this.radius() / 2 : this.radius()));

  /** The brush ring in the 3D view while a terrain tool is active. */
  readonly cursor3d = computed(() => {
    const p = this.h.hover();
    if (!p || !this.h.view3d() || this.h.tool() !== 'terrain') return null;
    return { x: p.x, z: p.z, r: this.ring(), color: this.h.tc('terrain') };
  });
  /** The height map under the 2D plan: one pixel per two grid cells, as an image over the grid's extent. */
  readonly heightImage = computed(() => {
    const g = this.h.ground().grid;
    if (!g || this.groundStyle() !== 'height') return null;
    const px = heightPixels(g, 2);
    const c = document.createElement('canvas');
    c.width = px.w;
    c.height = px.h;
    const cx = c.getContext('2d');
    if (!cx) return null;
    cx.putImageData(new ImageData(px.data, px.w, px.h), 0, 0);
    return { href: c.toDataURL(), x: g.x0, z: g.z0, w: (g.nx - 1) * g.cell, d: (g.nz - 1) * g.cell };
  });
  private contourCache: { grid: unknown; out: { minor: string; major: string } } | null = null;
  readonly contours = computed(() => {
    const g = this.h.ground().grid;
    if (!g) return null;
    if (this.contourCache?.grid !== g) this.contourCache = { grid: g, out: contourPaths(g) };
    return this.contourCache.out;
  });
  /** Height of the ground under the pointer while a terrain tool is active. */
  readonly groundUnder = computed(() => {
    const p = this.h.hover();
    return this.h.tool() === 'terrain' && p ? this.h.ground().at(p.x, p.z) : null;
  });
  /** The stroke being painted, as an SVG path. */
  readonly preview = computed(() => {
    const d = this.h.drag();
    const pts = d?.t === 'terrain' ? d.pts : [];
    return pts.length > 1 ? 'M' + pts.map((q) => `${q.x} ${q.z}`).join('L') : '';
  });

  /** Turn a finished drag into a stroke on the spec (the terrain is created flat on first use). */
  commit(pts: Pt[], h0: number): void {
    const stroke = brushStroke(this.op(), pts, h0, { radius: this.radius(), strength: this.strength(), falloff: this.falloff() });
    if (!stroke) return void this.h.toast.show('Drag from the foot of the ramp to its top.');
    this.h.ed.commitSite((s) => {
      s.terrain ??= defaultTerrain(s.extent);
      s.terrain.strokes.push(stroke);
    });
    this.h.applyNow();
  }

  readonly loadingGround = signal(false);
  async realGround(): Promise<void> {
    this.loadingGround.set(true);
    try {
      await this.h.site.loadRealGround();
    } finally {
      this.loadingGround.set(false);
    }
  }

  /** Back to flat ground (one undo step). */
  clear(): void {
    if (!this.h.ed.draft().terrain?.strokes.length) return;
    this.h.ed.commitSite((s) => {
      if (s.terrain) s.terrain.strokes = [];
    });
    this.h.applyNow();
    this.h.toast.show('Terrain strokes removed. Undo brings them back.');
  }
}
