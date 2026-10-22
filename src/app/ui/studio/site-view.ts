import { Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import type { Flight } from '../../core/models';
import type { SiteSpec } from '../../core/site-spec';
import { SiteViewRenderer, type SitePick } from '../../three/site-view';

/** The editor's 3D mode: the whole bando, orbit with the mouse. Editing happens in 2D; this is for looking. */
@Component({
  selector: 'app-site-view',
  template: `
    <canvas #cv></canvas>
    @if (failed()) {
      <div class="fail dim">3D view unavailable (WebGL could not start).</div>
    } @else {
      <div class="cap dim small">{{ mode() === 'select' ? 'click: select · drag: orbit · right-drag / Shift-drag: pan · wheel: zoom' : 'drag / click on the ground to draw or place · right-drag or Shift-drag: orbit · wheel: zoom' }}</div>
    }
  `,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      z-index: 650;
      display: block;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      touch-action: none;
      cursor: grab;
    }
    .cap {
      position: absolute;
      left: 8px;
      bottom: 6px;
      background: rgba(10, 16, 12, 0.7);
      padding: 1px 7px;
      border-radius: 6px;
      pointer-events: none;
    }
    .fail {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
    }
  `,
})
export class SiteView {
  readonly spec = input.required<SiteSpec>();
  readonly roofHidden = input(false);
  readonly frameKey = input('');
  /** 'select': a click selects what is under it. 'draw': left-drag on the ground reports points for the active tool. */
  readonly mode = input<'select' | 'draw'>('select');
  readonly selection = input<SitePick | null>(null);
  /** One floor of one building to show solid, the rest of that building ghosted. */
  readonly focus = input<{ id: string; li: number } | null>(null);
  readonly flights = input<Flight[]>([]);
  readonly speedMax = input(10);
  readonly picked = output<SitePick | null>();
  readonly ground = output<{ phase: 'down' | 'move' | 'up'; x: number; z: number }>();
  protected readonly failed = signal(false);
  private readonly cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');
  private r: SiteViewRenderer | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    afterNextRender(() => {
      try {
        this.r = new SiteViewRenderer(this.cv().nativeElement);
      } catch {
        this.failed.set(true);
        return;
      }
      this.r.mode = this.mode();
      this.r.onPick = (p) => this.picked.emit(p);
      this.r.onGround = (phase, x, z) => this.ground.emit({ phase, x, z });
      this.schedule(0);
    });
    effect(() => {
      const m = this.mode();
      if (this.r) this.r.mode = m;
    });
    effect(() => {
      const sel = this.selection();
      this.spec(); // a rebuild invalidates the box: redraw it after
      untracked(() => this.r?.setSelection(sel));
    });
    effect(() => {
      const f = this.flights(), m = this.speedMax();
      untracked(() => this.r?.setPaths(f, m));
    });
    effect(() => {
      this.spec();
      this.roofHidden();
      this.focus();
      untracked(() => this.schedule(220)); // an edit drag changes the spec many times a second
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      this.r?.dispose();
      this.r = null;
    });
  }

  private schedule(ms: number): void {
    if (!this.r) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      try {
        this.r?.show(this.spec(), this.roofHidden(), this.frameKey(), this.focus());
        this.r?.setSelection(this.selection());
        this.r?.setPaths(this.flights(), this.speedMax());
      } catch {
        this.failed.set(true);
      }
    }, ms);
  }
}
