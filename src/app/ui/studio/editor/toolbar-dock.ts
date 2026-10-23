import { computed, signal, type Signal } from '@angular/core';
import { raiseZ } from '../../stacking';

/** A screen position inside the editor, pixels from its top-left corner. */
export type XY = { x: number; y: number };
type Which = 'pal' | 'opts';

/** Where the palette is drawn: where it was dragged (kept inside the editor), else the top-left corner. */
export function palettePlace(pos: XY | null, size: { w: number; h: number }): XY {
  return pos ? { x: Math.max(0, Math.min(size.w - 46, pos.x)), y: Math.max(0, Math.min(size.h - 60, pos.y)) } : { x: 8, y: 8 };
}

/**
 * Where the options bar is drawn: where it was dragged, else beside the active tool's button (`btn.top` from the
 * palette's top), on the side of the palette with more room (right by default). `max` = the width it may take.
 */
export function optionsPlace(pos: XY | null, pal: XY, btn: { top: number; palW: number }, size: { w: number; h: number }): { left: number | null; right: number | null; top: number; max: number } {
  const { w, h } = size;
  if (pos) {
    const left = Math.max(0, Math.min(w - 120, pos.x));
    return { left, right: null, top: Math.max(0, Math.min(h - 36, pos.y)), max: w - left - 8 };
  }
  const top = Math.max(0, Math.min(h - 36, pal.y + btn.top));
  return pal.x + btn.palW / 2 < w / 2
    ? { left: pal.x + btn.palW + 6, right: null, top, max: w - (pal.x + btn.palW + 6) - 8 }
    : { left: null, right: w - pal.x + 6, top, max: pal.x - 14 };
}

const load = (k: string): XY | null => {
  try {
    const v = JSON.parse(localStorage.getItem(`abando-float-${k}`) ?? 'null') as XY | null;
    return v && isFinite(v.x) && isFinite(v.y) ? v : null;
  } catch {
    return null;
  }
};
const save = (k: string, v: XY | null): void => {
  try {
    if (v) localStorage.setItem(`abando-float-${k}`, JSON.stringify(v));
    else localStorage.removeItem(`abando-float-${k}`);
  } catch {
    /* no storage */
  }
};
const KEY: Record<Which, string> = { pal: 'palette', opts: 'opts' };

/**
 * The editor's two movable toolbars, the tool palette and the options bar: where they are (dragged by their grip and
 * remembered, Reset UI forgets it), and their place in the stacking order shared with the float boxes.
 */
export class ToolbarDock {
  /** `size`: the editor's size; `host`: the element positions are measured from. */
  constructor(
    private readonly size: Signal<{ w: number; h: number }>,
    private readonly host: () => HTMLElement,
  ) {}

  private readonly owner: Record<Which, object> = { pal: {}, opts: {} };
  readonly palZ = signal(raiseZ(this.owner.pal));
  readonly optsZ = signal(raiseZ(this.owner.opts));
  private readonly pos = { pal: signal<XY | null>(load('palette')), opts: signal<XY | null>(load('opts')) };
  /** The active tool button inside the palette, measured after every render: the options bar lines up with it. */
  private readonly toolBtn = signal<{ top: number; palW: number }>({ top: 0, palW: 46 });
  private tb: { which: Which; dx: number; dy: number } | null = null;
  readonly palXY = computed(() => palettePlace(this.pos.pal(), this.size()));
  readonly optsXY = computed(() => optionsPlace(this.pos.opts(), this.palXY(), this.toolBtn(), this.size()));

  /** Bring a toolbar to the top of the shared stacking order. */
  raise(which: Which): void {
    (which === 'pal' ? this.palZ : this.optsZ).set(raiseZ(this.owner[which]));
  }

  /** Measure the active button in the drawn palette (after a render). */
  measure(pal: HTMLElement | undefined): void {
    if (!pal) return;
    const btn = pal.querySelector<HTMLElement>('.pbtn.on');
    const next = { top: btn ? btn.getBoundingClientRect().top - pal.getBoundingClientRect().top : 0, palW: pal.offsetWidth };
    const cur = this.toolBtn();
    if (Math.abs(cur.top - next.top) > 0.5 || Math.abs(cur.palW - next.palW) > 0.5) this.toolBtn.set(next);
  }

  down(e: PointerEvent, which: Which): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = (e.currentTarget as HTMLElement).parentElement!;
    const box = el.getBoundingClientRect(), host = this.host().getBoundingClientRect();
    this.tb = { which, dx: e.clientX - box.left, dy: e.clientY - box.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    // the bar is about to be placed by hand: start from where it is drawn now
    this.pos[which].set({ x: box.left - host.left, y: box.top - host.top });
  }

  move(e: PointerEvent): void {
    const t = this.tb;
    if (!t) return;
    const host = this.host().getBoundingClientRect();
    this.pos[t.which].set({ x: e.clientX - host.left - t.dx, y: e.clientY - host.top - t.dy });
  }

  up(e: PointerEvent): void {
    const t = this.tb;
    this.tb = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (t) save(KEY[t.which], this.pos[t.which]());
  }

  /** Back beside its default place (double-click on the grip). */
  reset(which: Which): void {
    this.pos[which].set(null);
    save(KEY[which], null);
  }

  /** Reset UI: both back (the stored places are cleared by the layout store). */
  resetAll(): void {
    this.pos.pal.set(null);
    this.pos.opts.set(null);
  }
}
