import { computed, signal } from '@angular/core';
import type { Pt } from '../../../core/footprint';
import { brushStroke, contourPaths, defaultTerrain, heightPixels, rampGuide, sculptStroke, type Falloff, type TerrainOp } from '../../../core/terrain';
import { polyPts } from './editor-host';
import type { GroundStyle } from '../../../three/site-model';
import type { PickOption } from '../pick-menu';
import type { EditorHost } from './editor-host';

/** A terrain brush: one of the stroke kinds, or sculpting (hold to raise or lower, it makes raise / lower strokes). */
export type Brush = TerrainOp | 'sculpt';

/** The terrain brushes, each its own entry in the palette's Terrain group. */
export const TERRAIN_OPS: readonly { op: Brush; icon: string; name: string }[] = [
  { op: 'sculpt', icon: 'terrainSculpt', name: 'Terrain · sculpt (hold: left raises, right lowers)' },
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
    return v === 'height' || v === 'wire' || v === 'satellite' ? v : 'natural';
  };
  readonly op = signal<Brush>('sculpt');
  readonly radius = signal(8);
  readonly strength = signal(2);
  readonly falloff = signal<Falloff>('smooth');
  readonly opOptions: readonly PickOption[] = TERRAIN_OPS.map((t) => ({ id: t.op, label: t.op[0]!.toUpperCase() + t.op.slice(1), icon: t.icon }));
  readonly falloffOptions: readonly PickOption[] = [
    { id: 'smooth', label: 'Soft edge', icon: 'terrainHill', hint: 'Rounded, natural' },
    { id: 'linear', label: 'Straight edge', icon: 'ramp', hint: 'A steady slope to the rim' },
    { id: 'flat', label: 'Hard edge', icon: 'terrainFlatten', hint: 'Full strength almost to the rim' },
  ];
  readonly asOp = (v: string): Brush => TERRAIN_OPS.find((t) => t.op === v)?.op ?? 'sculpt';
  readonly asFalloff = (v: string): Falloff => (v === 'linear' || v === 'flat' ? v : 'smooth');
  /** What "strength" means for the current operation, for its label. */
  readonly strengthLabel = computed(() => ({ sculpt: 'speed', raise: 'up', lower: 'down', smooth: 'amount %', flatten: '', hill: 'height', crater: 'depth', ramp: 'rise' })[this.op()]);
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

  /** Construction lines of the stroke being drawn: a ramp's band with its slope, a stamp's circle and height, a flatten level. */
  readonly guide = computed(() => {
    const d = this.h.drag();
    const op = this.op();
    if (d?.t === 'sculpt') {
      const s = this.sculpting();
      return s ? { kind: 'ring' as const, at: s.at, r: s.r, label: `${s.lower ? '−' : '+'}${s.k.toFixed(1)} m` } : null;
    }
    if (d?.t !== 'terrain' || !d.pts.length) return null;
    const a = d.pts[0]!, k = Math.abs(this.strength());
    if (op === 'ramp' && d.pts.length > 1) {
      const g = rampGuide(a, d.pts[d.pts.length - 1]!, this.radius() / 2, this.strength());
      return { kind: 'ramp' as const, outline: polyPts(g.outline), arrow: polyPts(g.arrow), at: d.pts[d.pts.length - 1]!, label: `${this.strength() >= 0 ? '+' : ''}${this.strength()} m over ${g.len.toFixed(1)} m · ${g.slope.toFixed(0)} %` };
    }
    if (op === 'hill' || op === 'crater') return { kind: 'ring' as const, at: a, r: this.radius(), label: `${op === 'hill' ? '+' : '−'}${k} m` };
    if (op === 'flatten') return { kind: 'ring' as const, at: a, r: this.radius(), label: `level ${d.h0.toFixed(1)} m` };
    return null;
  });

  // ---- sculpting: hold the button; the stroke grows until it is released (one undo step for the whole press)
  private hold: { at: Pt; lower: boolean; t0: number; idx: number } | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly sculpting = signal<{ at: Pt; lower: boolean; r: number; k: number } | null>(null);

  sculptDown(p: Pt, lower: boolean): void {
    this.h.ed.beginGesture();
    this.startHold(p, lower, performance.now());
    clearInterval(this.timer);
    this.timer = setInterval(() => this.grow(), 120);
  }

  /** The pointer moved while held: past half the radius a new stroke starts there (the hold keeps some of its growth). */
  sculptMove(p: Pt): void {
    const h = this.hold, s = this.sculpting();
    if (!h || !s || Math.hypot(p.x - h.at.x, p.z - h.at.z) < s.r * 0.5) return;
    this.startHold(p, h.lower, performance.now() - 300);
  }

  /** Released: the strokes stay, the 3D model is rebuilt. */
  sculptUp(): void {
    clearInterval(this.timer);
    if (this.hold) this.grow();
    this.hold = null;
    this.sculpting.set(null);
    this.h.applyNow();
  }

  private startHold(p: Pt, lower: boolean, t0: number): void {
    let idx = 0;
    this.h.ed.live((s) => {
      s.terrain ??= defaultTerrain(s.extent);
      idx = s.terrain.strokes.push(sculptStroke(p, 0, lower, { radius: this.radius(), rate: this.strength() })) - 1;
    });
    this.hold = { at: p, lower, t0, idx };
    this.grow();
  }

  private grow(): void {
    const h = this.hold;
    if (!h) return;
    const st = sculptStroke(h.at, (performance.now() - h.t0) / 1000, h.lower, { radius: this.radius(), rate: this.strength() });
    this.h.ed.live((s) => {
      if (s.terrain?.strokes[h.idx]) s.terrain.strokes[h.idx] = st;
    });
    this.sculpting.set({ at: h.at, lower: h.lower, r: st.radius, k: st.strength });
  }

  /** Turn a finished drag into a stroke on the spec (the terrain is created flat on first use). */
  commit(pts: Pt[], h0: number): void {
    const op = this.op();
    if (op === 'sculpt') return;
    const stroke = brushStroke(op, pts, h0, { radius: this.radius(), strength: this.strength(), falloff: this.falloff() });
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
