import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { snippetForMark, type Snippet } from '../core/tour';
import { TourService } from '../services/tour.service';

/**
 * What the guided tour draws over the app: the cursor, a ring on every click, an outline round the target and the
 * caption bar with its controls (Esc stops). With hover tips on, it also shows the snippet that explains a marked tool
 * after a short hover, with a button to play it.
 */
@Component({
  selector: 'app-tour-overlay',
  host: {
    '(document:keydown.escape)': 'tour.end()',
    '(document:mouseover)': 'hover($event)',
  },
  template: `
    @if (tour.focus(); as f) {
      <div class="focus" [style.left.px]="f.x - 4" [style.top.px]="f.y - 4" [style.width.px]="f.w + 8" [style.height.px]="f.h + 8"></div>
    }
    @if (tour.ring(); as r) {
      <!-- two branches so every click makes a new ring (and restarts its animation) -->
      @if (r.n % 2) {
        <div class="ring" [style.left.px]="r.x" [style.top.px]="r.y"></div>
      } @else {
        <div class="ring" [style.left.px]="r.x" [style.top.px]="r.y"></div>
      }
    }
    @if (tour.cursor(); as c) {
      <svg class="cursor" [class.down]="c.down" [style.left.px]="c.x" [style.top.px]="c.y" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <path d="M3 2 L3 19 L8 14.5 L11.5 22 L14.5 20.6 L11 13.2 L17.5 13.2 Z" />
      </svg>
    }
    @if (tour.state(); as s) {
      <div #bar class="bar" role="status" aria-live="polite" [attr.data-preparing]="s.preparing || null" [style.left.px]="barAt().left" [style.top.px]="barAt().top" [style.bottom.px]="barAt().bottom">
        <div class="head">
          <span class="grip" title="Drag to move" aria-hidden="true" (pointerdown)="gripDown($event)" (pointermove)="gripMove($event)" (pointerup)="gripUp($event)" (pointercancel)="gripUp($event)">⠿</span>
          <b>{{ s.title }}</b>
          <span class="dim small mono">{{ s.index }} / {{ s.total }}</span>
          <span class="sp"></span>
          <button class="btn" (click)="tour.back()" [disabled]="!s.canBack" title="Back: this step again from its start (from its start, the step before)">‹ Back</button>
          <button class="btn" (click)="tour.togglePause()">{{ s.paused ? '▶ Resume' : '❚❚ Pause' }}</button>
          <button class="btn" (click)="tour.next()" title="Skip to the next step">Next ›</button>
          <button class="btn" (click)="tour.end()" title="Stop the tour (Esc)">■ Stop</button>
        </div>
        <div class="say">{{ s.say }}</div>
        <div class="prog"><i [style.width.%]="(s.index / s.total) * 100"></i></div>
      </div>
    }
    @if (tip(); as t) {
      <div class="tip" role="dialog" [attr.aria-label]="t.s.title" [style.left.px]="t.x" [style.top.px]="t.y" (mouseenter)="keepTip()" (mouseleave)="dropTip()">
        <b>{{ t.s.title }}</b>
        <div class="dim small">{{ t.s.beats[0]?.say }}</div>
        <button class="btn primary" (click)="show(t.s)">▶ Show me</button>
      </div>
    }
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: 100002;
      pointer-events: none;
    }
    .cursor {
      position: fixed;
      margin: -3px 0 0 -4px;
      fill: #ffffff;
      stroke: #0e1411;
      stroke-width: 1.4;
      filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.5));
      transition: transform 0.1s;
    }
    .cursor.down {
      transform: scale(0.86);
    }
    .ring {
      position: fixed;
      width: 34px;
      height: 34px;
      margin: -17px 0 0 -17px;
      border: 2px solid var(--accent);
      border-radius: 50%;
      animation: ring 0.5s ease-out forwards;
    }
    @keyframes ring {
      from {
        transform: scale(0.3);
        opacity: 1;
      }
      to {
        transform: scale(1.3);
        opacity: 0;
      }
    }
    .focus {
      position: fixed;
      border: 2px dashed var(--accent);
      border-radius: 8px;
      transition: all 0.25s;
    }
    .bar {
      pointer-events: auto;
      position: fixed;
      width: min(520px, calc(100vw - 32px));
      padding: 8px 10px 0;
      background: var(--panel-solid);
      border: 2px solid var(--accent);
      border-radius: 10px;
      box-shadow: 0 10px 32px rgba(0, 0, 0, 0.6);
      overflow: hidden;

    }
    .grip {
      cursor: grab;
      color: var(--dim);
      padding: 0 2px;
      touch-action: none;
      user-select: none;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .sp {
      flex: 1;
    }
    .say {
      margin: 6px 0 8px;
      font-size: 14px;
      line-height: 1.45;
      color: var(--text);
    }
    .prog {
      height: 3px;
      margin: 0 -10px;
      background: var(--line);
      i {
        display: block;
        height: 100%;
        background: var(--accent);
        transition: width 0.3s;
      }
    }
    .tip {
      pointer-events: auto;
      position: fixed;
      width: 260px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      align-items: flex-start;
      padding: 8px 10px;
      background: var(--panel-solid);
      border: 2px solid var(--accent);
      border-radius: 8px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    }
    .btn:focus-visible {
      outline: 2px solid var(--accent);
    }
  `,
})
export class TourOverlay {
  protected readonly tour = inject(TourService);
  protected readonly tip = signal<{ s: Snippet; x: number; y: number } | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hide: ReturnType<typeof setTimeout> | null = null;
  private last: Element | null = null;
  protected readonly on = computed(() => this.tour.tips() && !this.tour.state());
  private readonly barEl = viewChild<ElementRef<HTMLElement>>('bar');
  /**
   * Where the caption was dragged (for this visit); otherwise centred, its bottom edge 40 px above the window's, so a
   * longer or shorter caption grows upwards and the bar never moves.
   */
  private readonly dragged = signal<{ left: number; top: number } | null>(null);
  protected readonly barAt = computed<{ left: number; top: number | null; bottom: number | null }>(() => {
    const w = Math.min(520, innerWidth - 32);
    const d = this.dragged();
    if (d) return { left: Math.max(0, Math.min(innerWidth - w, d.left)), top: Math.max(0, Math.min(innerHeight - 40, d.top)), bottom: null };
    return { left: Math.round((innerWidth - w) / 2), top: null, bottom: 40 };
  });
  private grab: { dx: number; dy: number } | null = null;
  protected gripDown(e: PointerEvent): void {
    const r = this.barEl()?.nativeElement.getBoundingClientRect();
    if (!r) return;
    this.grab = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  protected gripMove(e: PointerEvent): void {
    if (this.grab) this.dragged.set({ left: e.clientX - this.grab.dx, top: e.clientY - this.grab.dy });
  }
  protected gripUp(e: PointerEvent): void {
    this.grab = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }

  protected hover(e: MouseEvent): void {
    if (!this.on()) return;
    const el = (e.target as Element | null)?.closest('[data-tour]') ?? null;
    if (el === this.last) return;
    this.last = el;
    if (this.timer) clearTimeout(this.timer);
    if (!el) return this.dropTip();
    const s = (el.getAttribute('data-tour') ?? '').split(/\s+/).map((m) => snippetForMark(m)).find((x) => !!x);
    if (!s) return this.dropTip();
    this.timer = setTimeout(() => {
      const r = el.getBoundingClientRect();
      const x = Math.min(innerWidth - 276, Math.max(8, r.right + 8)), y = Math.min(innerHeight - 140, Math.max(8, r.top));
      this.keepTip();
      this.tip.set({ s, x, y });
    }, 700);
  }

  protected keepTip(): void {
    if (this.hide) clearTimeout(this.hide);
    this.hide = null;
  }

  protected dropTip(): void {
    if (this.hide || !this.tip()) return;
    this.hide = setTimeout(() => {
      this.tip.set(null);
      this.hide = null;
    }, 400);
  }

  protected show(s: Snippet): void {
    this.tip.set(null);
    void this.tour.playSnippet(s);
  }
}
