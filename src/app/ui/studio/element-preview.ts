import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { PreviewRenderer, type PreviewTarget } from '../../three/element-preview';

/**
 * A small 3D view of what is selected in the editor: a building / tree / fence on its own, or — for a wall, door,
 * window, void or column of one floor — that element in place with the rest of the building semi-transparent.
 * Drag to orbit, wheel to zoom; it turns slowly when left alone.
 */
@Component({
  selector: 'app-element-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas #cv></canvas>
    @if (failed()) {
      <div class="fail dim small">3D preview unavailable (WebGL could not start).</div>
    }
    <div class="cap dim small">{{ caption() }}</div>
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      flex: none;
    }
    canvas {
      display: block;
      width: 100%;
      height: 150px;
      border-radius: 6px;
      background: radial-gradient(circle at 50% 35%, #26352c, #111a14);
      cursor: grab;
      touch-action: none;
    }
    .fail {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
    }
    .cap {
      position: absolute;
      left: 8px;
      bottom: 4px;
      pointer-events: none;
    }
  `,
})
export class ElementPreview {
  readonly target = input.required<PreviewTarget>();
  /** Changes when a different object is selected (the camera then re-frames); edits to the same object keep the view. */
  readonly key = input('');
  readonly caption = input('drag to rotate · wheel to zoom');
  protected readonly failed = signal(false);

  private readonly cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');
  private renderer: PreviewRenderer | null = null;
  private lastKey = '\0';
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    afterNextRender(() => {
      try {
        this.renderer = new PreviewRenderer(this.cv().nativeElement);
      } catch {
        this.failed.set(true);
        return;
      }
      this.schedule();
    });
    effect(() => {
      this.target();
      this.key();
      untracked(() => this.schedule());
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      this.renderer?.dispose();
      this.renderer = null;
    });
  }

  /** Rebuild shortly after the last change: a drag in the editor edits the model dozens of times a second. */
  private schedule(): void {
    if (!this.renderer) return;
    const reframe = this.key() !== this.lastKey;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      try {
        this.renderer?.show(this.target(), reframe);
        this.lastKey = this.key();
      } catch {
        this.failed.set(true);
      }
    }, reframe ? 0 : 150);
  }
}
