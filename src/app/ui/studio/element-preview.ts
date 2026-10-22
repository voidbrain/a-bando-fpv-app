import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { PreviewRenderer, type PreviewTarget } from '../../three/element-preview';

/**
 * A small 3D view of what is selected in the editor: a building / tree / fence on its own, or — for a wall, door,
 * window, void or column of one floor — that element in place with the rest of the building semi-transparent.
 * Drag to orbit, wheel to zoom; it turns slowly when left alone.
 */
@Component({
  selector: 'app-element-preview',
  template: `
    <canvas #cv></canvas>
    <div class="tb">
      <button [class.on]="!roofHidden()" [disabled]="indoor()" (click)="toggleRoof()" [title]="indoor() ? 'The roof is hidden while editing indoors' : roofOn() ? 'Hide the roof' : 'Show the roof'">⌂</button>
      <button [class.on]="spin()" (click)="toggleSpin()" [title]="spin() ? 'Stop turning' : 'Turn slowly'">⟳</button>
    </div>
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
    .tb {
      position: absolute;
      top: 4px;
      right: 4px;
      display: flex;
      gap: 3px;
    }
    .tb button {
      width: 22px;
      height: 22px;
      padding: 0;
      border-radius: 5px;
      border: 1px solid var(--line);
      background: rgba(10, 16, 12, 0.6);
      color: var(--dim);
      cursor: pointer;
      line-height: 1;
    }
    .tb button.on {
      color: var(--accent);
      border-color: var(--accent);
    }
    .tb button:disabled {
      opacity: 0.45;
      cursor: default;
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
  /** Roof shown (remembered). It is always off while a floor or a part of one is edited: you want to see inside. */
  protected readonly roofOn = signal(ElementPreview.stored('abando-preview-roof', true));
  protected readonly spin = signal(ElementPreview.stored('abando-preview-spin', false));
  protected readonly indoor = computed(() => this.target().kind === 'floor' || this.target().kind === 'part');
  protected readonly roofHidden = computed(() => this.indoor() || !this.roofOn());
  private readonly shown = computed<PreviewTarget>(() => {
    const t = this.target();
    if (!this.roofHidden() || !('b' in t)) return t;
    const b = JSON.parse(JSON.stringify(t.b)) as typeof t.b;
    for (const l of b.levels) l.roof = 'none';
    return { ...t, b } as PreviewTarget;
  });

  private static stored(key: string, dflt: boolean): boolean {
    try {
      const v = localStorage.getItem(key);
      return v === null ? dflt : v === '1';
    } catch {
      return dflt;
    }
  }

  private static save(key: string, v: boolean): void {
    try {
      localStorage.setItem(key, v ? '1' : '0');
    } catch {
      /* no storage */
    }
  }

  protected toggleRoof(): void {
    this.roofOn.update((v) => !v);
    ElementPreview.save('abando-preview-roof', this.roofOn());
  }

  protected toggleSpin(): void {
    this.spin.update((v) => !v);
    ElementPreview.save('abando-preview-spin', this.spin());
  }

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
      if (this.renderer) this.renderer.spin = this.spin();
      this.schedule();
    });
    effect(() => {
      if (this.renderer) this.renderer.spin = this.spin();
    });
    effect(() => {
      this.shown();
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
        this.renderer?.show(this.shown(), reframe);
        this.lastKey = this.key();
      } catch {
        this.failed.set(true);
      }
    }, reframe ? 0 : 150);
  }
}
