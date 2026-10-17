import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, input, signal } from '@angular/core';

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
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.left.px]': 'geo().x',
    '[style.top.px]': 'geo().y',
    '[style.width.px]': 'geo().w',
    '[style.height]': 'open() ? geo().h + "px" : "auto"',
    '[class.closed]': '!open()',
    '(pointerdown)': 'down($event)',
    '(document:pointerup)': 'up()',
    '(document:pointercancel)': 'up()',
  },
  template: `
    <header (pointerdown)="dragStart($event)" (pointermove)="dragMove($event)" (pointerup)="dragEnd()">
      <span class="t">{{ title() }}</span>
      <button (pointerdown)="$event.stopPropagation()" (click)="open.set(!open())" [title]="open() ? 'Collapse' : 'Expand'">{{ open() ? '▾' : '▸' }}</button>
    </header>
    @if (open()) {
      <div class="body"><ng-content /></div>
    }
  `,
  styles: `
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

  protected readonly open = signal(true);
  constructor() {
    afterNextRender(() => this.init());
  }

  protected readonly geo = signal<Geo>({ x: 8, y: 8, w: 260, h: 220 });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private drag: { dx: number; dy: number } | null = null;
  private resizing = false;
  private ready = false;

  private key(): string {
    return `abando-float-${this.fid()}`;
  }

  private init(): void {
    if (this.ready) return;
    this.ready = true;
    let g: Geo = { x: this.x(), y: this.y(), w: this.w(), h: this.h() };
    try {
      const raw = localStorage.getItem(this.key());
      if (raw) {
        const p = JSON.parse(raw) as Partial<Geo>;
        if ([p.x, p.y, p.w, p.h].every((v) => typeof v === 'number' && isFinite(v))) g = p as Geo;
      }
    } catch {
      /* no storage: defaults */
    }
    this.geo.set(this.clamp(g));
  }

  /** Keep the box inside its parent area. */
  private clamp(g: Geo): Geo {
    const par = this.host.nativeElement.parentElement;
    const pw = par?.clientWidth ?? 9999, ph = par?.clientHeight ?? 9999;
    const w = Math.min(Math.max(160, g.w), Math.max(160, pw - 8));
    const h = Math.min(Math.max(60, g.h), Math.max(60, ph - 8));
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
