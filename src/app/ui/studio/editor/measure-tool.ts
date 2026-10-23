import { computed, signal } from '@angular/core';
import { anglesAt, arcOf, chainClick, measureLabel, nearestSnap, orthoSnap, shiftEnds, snapTargets, type MeasureChain, type Pt, type Seg } from '../../../core/measure';
import type { Drag, EditorHost } from './editor-host';

/**
 * The Measure tool: chains of measures (click, click, click), the angles where they meet, magnets to elements, and
 * moving a measure or one of its ends. Measures are not part of the spec: they live here until cleared.
 */
export class MeasureTool {
  constructor(private readonly h: EditorHost) {}

  readonly chain = signal<MeasureChain>({ segs: [], a: null, start: null });
  readonly sel = signal<number | null>(null);
  readonly selSeg = computed(() => (this.h.tool() === 'measure' && !this.chain().a ? (this.chain().segs[this.sel() ?? -1] ?? null) : null));
  /** Measure lines only take the pointer while no chain is open (then a click always adds a point). */
  readonly hit = computed(() => (this.h.tool() === 'measure' && !this.chain().a ? 'stroke' : 'none'));
  /** What the pointer is magnetised to while measuring ('corner', 'tree' ...), or ''. */
  readonly snap = signal('');
  /** The point under the pointer while measuring (the live line follows it). */
  readonly hover = signal<Pt | null>(null);
  /** The angle arcs: radius 34 px, but never more than a third of the shorter arm. */
  readonly arcs = computed(() => {
    const segs = this.chain().segs, r0 = 34 / Math.max(0.01, this.h.ppm());
    return anglesAt(segs).map((a) => {
      const arm = Math.min(Math.hypot(segs[a.i]!.b.x - segs[a.i]!.a.x, segs[a.i]!.b.z - segs[a.i]!.a.z), Math.hypot(segs[a.j]!.b.x - segs[a.j]!.a.x, segs[a.j]!.b.z - segs[a.j]!.a.z));
      return { ...arcOf(a.at, a.d1, a.d2, Math.min(r0, arm / 3)), deg: a.deg };
    });
  });
  /** A measure's label: its plan length, and on a terrain the height difference and the length along the ground. */
  readonly fmt = (m: Seg): string => {
    const g = this.h.ground();
    return measureLabel(m, g.grid ? g.at : null);
  };

  /** Where a measure click or hover lands: magnet to elements within ~10 px, else straightened against the building axes. */
  point(raw: Pt): Pt {
    const m = this.chain();
    const sn = nearestSnap(snapTargets(this.h.ed.draft(), m.segs), raw, 10 / Math.max(0.01, this.h.ppm()));
    this.snap.set(sn?.kind ?? '');
    if (sn) return sn.pt;
    return m.a ? orthoSnap(m.a, raw, this.h.building()?.rotDeg ?? 0, 2.5) : raw;
  }

  /** A click on the plan with the Measure tool. */
  click(p: Pt): void {
    const m = this.chain();
    if (!m.a) this.sel.set(null);
    const r = chainClick(m, this.point(p));
    this.chain.set(r.chain);
    if (r.ended) this.hover.set(null);
  }

  /** Start a chain at `p` (the context menu's "Measure from here"). */
  startAt(p: Pt): void {
    this.chain.update((m) => ({ ...m, a: p, start: p }));
  }

  /** End the chain being drawn (Esc, a right click). */
  endChain(): void {
    this.chain.update((m) => ({ ...m, a: null, start: null }));
    this.hover.set(null);
  }

  /** A press on a measure: near an end it starts a new measure from there (to read the angle); on the line it selects it and drags it along. */
  lineDown(e: PointerEvent, i: number): void {
    e.stopPropagation();
    const m = this.chain().segs[i];
    if (!m) return;
    const p = this.h.toWorld(e);
    const r = 10 / Math.max(0.01, this.h.ppm());
    if (Math.hypot(p.x - m.a.x, p.z - m.a.z) < r || Math.hypot(p.x - m.b.x, p.z - m.b.z) < r) {
      this.sel.set(null);
      return this.h.bgDown(e);
    }
    this.h.capture(e);
    this.sel.set(i);
    this.h.drag.set({ t: 'measMove', i, last: p });
  }

  /** The white knob of the selected measure: drag one end (other measures ending on the same point follow). */
  endDown(e: PointerEvent, end: 0 | 1): void {
    e.stopPropagation();
    const i = this.sel();
    const m = i === null ? undefined : this.chain().segs[i];
    if (i === null || !m) return;
    this.h.capture(e);
    this.h.drag.set({ t: 'measEnd', i, end, old: end ? m.b : m.a });
  }

  /** A measure drag continues to `p`. */
  dragTo(d: Extract<Drag, { t: 'measMove' | 'measEnd' }>, p: Pt): void {
    if (d.t === 'measMove') {
      const g = this.chain().segs[d.i];
      if (g) this.shift([g.a, g.b], p.x - d.last.x, p.z - d.last.z);
      this.h.drag.set({ ...d, last: p });
      return;
    }
    const others = this.chain().segs.filter((g) => Math.hypot(g.a.x - d.old.x, g.a.z - d.old.z) > 0.05 && Math.hypot(g.b.x - d.old.x, g.b.z - d.old.z) > 0.05);
    const sn = nearestSnap(snapTargets(this.h.ed.draft(), others), p, 10 / Math.max(0.01, this.h.ppm()));
    const q = sn ? sn.pt : p;
    this.snap.set(sn?.kind ?? '');
    this.hover.set(sn ? q : null);
    this.shift([d.old], q.x - d.old.x, q.z - d.old.z);
    this.h.drag.set({ ...d, old: q });
  }

  private shift(pts: Pt[], dx: number, dz: number): void {
    this.chain.update((m) => ({ ...m, segs: shiftEnds(m.segs, pts, dx, dz) }));
  }

  delete(): void {
    const i = this.sel();
    if (i === null) return;
    this.chain.update((m) => ({ segs: m.segs.filter((_, k) => k !== i), a: null, start: null }));
    this.sel.set(null);
  }

  clear(): void {
    this.chain.set({ segs: [], a: null, start: null });
    this.sel.set(null);
    this.hover.set(null);
  }
}
