import { Component, DestroyRef, ElementRef, afterNextRender, inject, input, signal } from '@angular/core';

interface Geo {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A small window inside a window: drag it by its header, resize it from the bottom-right corner, collapse it with ▾.
 * Position and size are remembered per `fid` and kept inside the parent. Place it inside a `position: relative` area.
 */
@Component({
  selector: 'app-float-box',
  host: {
    '[style.left.px]': 'geo().x',
    '[style.top.px]': 'geo().y',
    '[style.width.px]': 'geo().w',
    '[style.min-width.px]': 'minW()',
    '[style.min-height]': 'open() ? minH() + "px" : null',
    '[style.height]': 'open() ? geo().h + "px" : "auto"',
    '[class.closed]': '!open()',
    '(pointerdown)': 'down($event)',
    '(document:pointerup)': 'up()',
    '(document:pointercancel)': 'up()',
  },
  template: `
    <header (pointerdown)="dragStart($event)" (pointermove)="dragMove($event)" (pointerup)="dragEnd()" (dblclick)="reset()" title="Drag to move · double-click for the default size">
      <span class="t">{{ title() }}</span>
      <button (pointerdown)="$event.stopPropagation()" (click)="open.set(!open())" [title]="open() ? 'Collapse' : 'Expand'">{{ open() ? '▾' : '▸' }}</button>
    </header>
    @if (open()) {
      <div class="body"><ng-content /></div>
      <div class="blgrip" title="Drag to resize" (pointerdown)="blDown($event)" (pointermove)="blMove($event)" (pointerup)="blUp()" (pointercancel)="blUp()"></div>
    }
  `,
  styles: `
    .blgrip {
      position: absolute;
      left: 0;
      bottom: 0;
      width: 16px;
      height: 16px;
      z-index: 5;
      cursor: nesw-resize;
      touch-action: none;
      opacity: 0.6;
      background: linear-gradient(135deg, transparent 0 46%, var(--dim) 46% 54%, transparent 54% 66%, var(--dim) 66% 74%, transparent 74%);
    }
    .blgrip:hover {
      opacity: 1;
    }
    :host {
      position: absolute;
      z-index: 1200;
      display: flex;
      flex-direction: column;
      min-width: 160px;
      min-height: 60px;
      max-width: calc(100% - 8px);
      max-height: calc(100% - 8px);
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(6px);
      resize: both;
      overflow: hidden;
    }
    :host(.closed) {
      resize: none;
      min-height: 0;
    }
    header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 6px 3px 8px;
      cursor: grab;
      user-select: none;
      touch-action: none;
      border-bottom: 1px solid var(--line);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .t {
      flex: 1;
    }
    button {
      background: none;
      border: 0;
      color: var(--dim);
      cursor: pointer;
    }
    .body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 6px 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
  `,
})
export class FloatBox {
  readonly fid = input.required<string>();
  readonly title = input('');
  readonly x = input(8);
  readonly y = input(8);
  readonly w = input(260);
  readonly h = input(220);
  /** The smallest size the box may have (a chat box is useless below ~300 × 280). */
  readonly minW = input(160);
  readonly minH = input(60);

  protected readonly open = signal(true);
  private ro: ResizeObserver | null = null;
  constructor() {
    inject(DestroyRef).onDestroy(() => this.ro?.disconnect());
    afterNextRender(() => {
      this.init();
      const par = this.host.nativeElement.parentElement;
      if (par) {
        this.ro = new ResizeObserver(() => {
          if (this.ready) this.geo.update((g) => this.clamp(g));
        });
        this.ro.observe(par);
      }
    });
  }

  protected readonly geo = signal<Geo>({ x: 8, y: 8, w: 260, h: 220 });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private drag: { dx: number; dy: number } | null = null;
  private resizing = false;
  private ready = false;

  private key(): string {
    return `abando-float-${this.fid()}`;
  }

  private init(tries = 0): void {
    if (this.ready) return;
    const par = this.host.nativeElement.parentElement;
    // the parent has not been laid out yet (0 × 0): measuring now would squash the box. Try again next frame.
    if ((!par || par.clientWidth < 50 || par.clientHeight < 50) && tries < 20) {
      requestAnimationFrame(() => this.init(tries + 1));
      return;
    }
    this.ready = true;
    let g: Geo = this.defaults();
    try {
      const raw = localStorage.getItem(this.key());
      if (raw) {
        const p = JSON.parse(raw) as Partial<Geo>;
        // a remembered size below the minimum is a leftover of an earlier bug: ignore it
        if ([p.x, p.y, p.w, p.h].every((v) => typeof v === 'number' && isFinite(v)) && p.w! >= this.minW() && p.h! >= this.minH()) g = p as Geo;
      }
    } catch {
      /* no storage: defaults */
    }
    this.geo.set(this.clamp(g));
  }

  private defaults(): Geo {
    return { x: this.x(), y: this.y(), w: this.w(), h: this.h() };
  }

  /** Double-click the title: back to the default place and size. */
  protected reset(): void {
    this.init();
    this.geo.set(this.clamp(this.defaults()));
    this.save();
  }

  /** Keep the box inside its parent area (and never below its minimum size). */
  private clamp(g: Geo): Geo {
    const par = this.host.nativeElement.parentElement;
    const pw = par?.clientWidth || 9999, ph = par?.clientHeight || 9999;
    const w = Math.min(Math.max(this.minW(), g.w), Math.max(this.minW(), pw - 8));
    const h = Math.min(Math.max(this.minH(), g.h), Math.max(this.minH(), ph - 8));
    return { w, h, x: Math.min(Math.max(0, g.x), Math.max(0, pw - w)), y: Math.min(Math.max(0, g.y), Math.max(0, ph - h)) };
  }

  private save(): void {
    try {
      localStorage.setItem(this.key(), JSON.stringify(this.geo()));
    } catch {
      /* ignore */
    }
  }

  protected down(e: PointerEvent): void {
    this.init();
    const r = this.host.nativeElement.getBoundingClientRect();
    // the native resize grip lives in the bottom-right corner
    this.resizing = this.open() && e.clientX > r.right - 22 && e.clientY > r.bottom - 22;
  }

  protected dragStart(e: PointerEvent): void {
    this.init();
    const r = this.host.nativeElement.getBoundingClientRect();
    this.drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }

  protected dragMove(e: PointerEvent): void {
    if (!this.drag) return;
    const par = this.host.nativeElement.parentElement?.getBoundingClientRect();
    if (!par) return;
    this.geo.update((g) => this.clamp({ ...g, x: e.clientX - par.left - this.drag!.dx, y: e.clientY - par.top - this.drag!.dy }));
  }

  private bl: { x: number; y: number; g: Geo } | null = null;

  /** Bottom-left corner: the left edge and the bottom edge follow the pointer. */
  protected blDown(e: PointerEvent): void {
    this.init();
    this.bl = { x: e.clientX, y: e.clientY, g: { ...this.geo() } };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }

  protected blMove(e: PointerEvent): void {
    const d = this.bl;
    if (!d) return;
    const dx = e.clientX - d.x;
    let x = d.g.x + dx, w = d.g.w - dx;
    if (w < this.minW()) {
      x -= this.minW() - w;
      w = this.minW();
    }
    if (x < 0) {
      w += x;
      x = 0;
    }
    this.geo.set(this.clamp({ x, y: d.g.y, w, h: d.g.h + (e.clientY - d.y) }));
  }

  protected blUp(): void {
    if (!this.bl) return;
    this.bl = null;
    this.save();
  }

  protected dragEnd(): void {
    this.drag = null;
    this.save();
  }

  /** Mouse released anywhere: if the corner grip was being dragged, remember the new size. */
  protected up(): void {
    if (!this.resizing) return;
    this.resizing = false;
    const el = this.host.nativeElement;
    this.geo.update((g) => this.clamp({ ...g, w: el.offsetWidth, h: el.offsetHeight }));
    this.save();
  }
}
