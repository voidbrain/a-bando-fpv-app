import { Component, DestroyRef, ElementRef, inject, input, viewChild } from '@angular/core';
import { fitCanvas } from '../../core/drawing/canvas-util';
import { FrameLoopService, FrameOrder } from '../../services/frame-loop.service';
import { LayoutStore } from '../../state/layout.store';
import type { PanelId } from '../panel-defs';

/** Draws into a canvas of CSS size `w` x `h` (already scaled for the device pixel ratio). */
export type DrawFn = (g: CanvasRenderingContext2D, w: number, h: number) => void;

/**
 * A canvas that redraws from the frame loop while its panel is shown (not hidden, not collapsed), at a device-pixel
 * sharp resolution. Give it a fixed `width` / `height` (CSS px) or leave one out to fill the available space.
 * Canvases are tagged `data-capture` so the renderer can composite them into exported videos.
 */
@Component({
  selector: 'app-canvas',
  host: { '[style.width]': 'width() === null ? "100%" : width() + "px"', '[style.height]': 'height() === null ? "100%" : height() + "px"' },
  template: `<canvas #cv [attr.data-capture]="capture() ? '' : null"></canvas>`,
  styles: `
    :host {
      display: block;
      line-height: 0;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      touch-action: none;
    }
  `,
})
export class CanvasWidget {
  readonly panel = input.required<PanelId>();
  readonly draw = input.required<DrawFn>();
  /** CSS pixels; null = fill the parent. */
  readonly width = input<number | null>(null);
  readonly height = input<number | null>(null);
  /** Redraw every n-th frame. */
  readonly every = input(2);
  readonly capture = input(true);

  private readonly cv = viewChild<ElementRef<HTMLCanvasElement>>('cv');
  private readonly layout = inject(LayoutStore);
  private readonly loop = inject(FrameLoopService);
  private frame = 0;

  constructor() {
    const stop = this.loop.add(FrameOrder.widgets, () => this.tick());
    inject(DestroyRef).onDestroy(stop);
  }

  /** The underlying canvas (for pointer coordinates). */
  get element(): HTMLCanvasElement | null {
    return this.cv()?.nativeElement ?? null;
  }

  private tick(): void {
    if (!this.loop.forceAll && this.frame++ % Math.max(1, this.every()) !== 0) return;
    const p = this.layout.panels()[this.panel()];
    if (!p.visible || p.minimized) return;
    const el = this.cv()?.nativeElement;
    if (!el) return;
    const w = this.width() ?? el.clientWidth;
    const h = this.height() ?? el.clientHeight;
    if (w < 2 || h < 2) return;
    const g = fitCanvas(el, w, h);
    if (g) this.draw()(g, w, h);
  }
}
