import { Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import type { SiteSpec } from '../../core/site-spec';
import { SiteViewRenderer } from '../../three/site-view';

/** The editor's 3D mode: the whole bando, orbit with the mouse. Editing happens in 2D; this is for looking. */
@Component({
  selector: 'app-site-view',
  template: `
    <canvas #cv></canvas>
    @if (failed()) {
      <div class="fail dim">3D view unavailable (WebGL could not start).</div>
    } @else {
      <div class="cap dim small">drag: orbit · right-drag or Shift-drag: pan · wheel: zoom · switch to 2D to edit</div>
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
      this.schedule(0);
    });
    effect(() => {
      this.spec();
      this.roofHidden();
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
        this.r?.show(this.spec(), this.roofHidden(), this.frameKey());
      } catch {
        this.failed.set(true);
      }
    }, ms);
  }
}
