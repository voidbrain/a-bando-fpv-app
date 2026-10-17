import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input } from '@angular/core';
import { LayoutStore } from '../../state/layout.store';
import { PANEL_BY_ID, type PanelId } from '../panel-defs';

/**
 * A floating window: drag it by the title bar, collapse it (▾), make it transparent (◐, keeps only the content marked
 * `.keep`). Position, size, stacking and these flags live in {@link LayoutStore} and are remembered across visits.
 * The content is projected, so every panel is a thin component that only knows its own controls.
 */
@Component({
  selector: 'app-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-panel': '',
    '[attr.data-id]': 'id()',
    '[class.ghost]': 'state().ghost',
    '[class.min]': 'state().minimized',
    '[class.resizable]': 'def().resizable',
    '[hidden]': '!state().visible',
    '[style.z-index]': 'state().z',
    '[style.left.px]': 'state().x ?? def().anchor.left ?? null',
    '[style.top.px]': 'state().y ?? def().anchor.top ?? null',
    '[style.right.px]': 'state().x === null ? (def().anchor.right ?? null) : null',
    '[style.bottom.px]': 'state().y === null ? (def().anchor.bottom ?? null) : null',
    '[style.width.px]': 'panelWidth()',
    // collapsed: drop the remembered height so the box hugs the title bar instead of staying big over the page;
    // expanded (or ghost-collapsed): exactly the remembered / default height — never the transient content height.
    '[style.height]': 'state().minimized ? "auto" : panelHeight()',
    '(pointerdown)': 'raise(); gripDown($event)',
    '(document:pointerup)': 'sizeCommit()',
    '(document:pointercancel)': 'sizeCommit()',
  },
  template: `
    <header class="grip" title="Drag to move" (pointerdown)="dragStart($event)" (pointermove)="dragMove($event)" (pointerup)="dragEnd()" (pointercancel)="dragEnd()">
      <span class="dots">⠿</span>
      <span class="title">{{ def().title }}</span>
      <button class="gb" title="Transparent: hide the panel background, keep only the content" (pointerdown)="$event.stopPropagation()" (click)="layout.toggleGhost(id())">◐</button>
      <button class="gb" title="Collapse / expand" (pointerdown)="$event.stopPropagation()" (click)="layout.toggleMinimized(id())">▾</button>
    </header>
    <div class="body"><ng-content /></div>
  `,
  styles: `
    :host {
      position: absolute;
      display: flex;
      flex-direction: column;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(6px);
      max-width: calc(100vw - 8px);
      max-height: calc(100vh - 8px);
      min-width: 90px;
    }
    :host([hidden]) {
      display: none;
    }
    :host(.resizable:not(.min)) {
      resize: both;
      overflow: hidden;
      min-height: 120px;
    }
    .grip {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 6px 4px 8px;
      cursor: grab;
      user-select: none;
      touch-action: none;
      border-bottom: 1px solid var(--line);
    }
    .dots {
      color: var(--dim);
    }
    .title {
      flex: 1;
      font-weight: 600;
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .gb {
      background: none;
      border: 0;
      color: var(--dim);
      cursor: pointer;
      padding: 0 3px;
      font-size: 13px;
      line-height: 1;
      &:hover {
        color: var(--text);
      }
    }
    .body {
      display: flex;
      flex-direction: column;
      padding: 8px;
      overflow: auto;
      flex: 1 1 auto;
      min-height: 0;
    }
    :host(.min) .body {
      display: none;
    }
    /* collapsed panels are not resizable (the remembered expanded size must survive untouched) */
    :host(.min.resizable) {
      resize: none;
    }
    :host(.min) .grip {
      border-bottom: 0;
    }
  `,
})
export class Panel {
  readonly id = input.required<PanelId>();
  protected readonly layout = inject(LayoutStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly def = computed(() => PANEL_BY_ID[this.id()]);
  readonly state = computed(() => this.layout.panels()[this.id()]);
  private drag: { dx: number; dy: number } | null = null;
  /** True while the user drags the header (move) — suppresses the re-open size guard. */
  private get dragging(): boolean { return this.drag !== null; }

  /** Width: the remembered size, else the default. */
  protected panelWidth(): number | null {
    return this.state().w ?? this.def().width ?? null;
  }

  /**
   * Height: always explicit for resizable panels so a re-opened one gets exactly its saved height back — never the
   * transient content height of the first frames after un-hiding. The template overrides it with "auto" while collapsed.
   */
  protected panelHeight(): number | null {
    const d = this.def();
    if (!d.resizable) return null;
    // never restore a size recorded while the panel was collapsed (a few px high): reopen at the default instead
    const h = this.state().h;
    if (h !== null && h < 100) return d.height ?? null;
    return h ?? d.height ?? null;
  }

  /**
   * Remember the size a resizable panel was dragged to. Only a mouse / touch release on the panel can change the
   * size (the corner grip is the browser's native `resize`), so that is the single moment it is measured: nothing is
   * ever stored while the panel is hidden, collapsed or ghosted, and re-opening restores exactly the saved size.
   */
  private resizing = false;

  /** A press in the bottom-right corner is the start of a native resize drag. */
  protected gripDown(e: PointerEvent): void {
    if (!this.def().resizable) return;
    const r = this.host.nativeElement.getBoundingClientRect();
    this.resizing = e.clientX > r.right - 24 && e.clientY > r.bottom - 24;
  }

  protected sizeCommit(): void {
    if (!this.resizing) return;
    this.resizing = false;
    const el = this.host.nativeElement;
    if (el.hidden || el.classList.contains('min') || el.classList.contains('ghost')) return;
    const w = Math.round(el.offsetWidth);
    const h = Math.round(el.offsetHeight);
    if (w < 60 || h < 100) return;
    const s = this.state();
    if (w !== s.w || h !== s.h) this.layout.resizeTo(this.id(), w, h);
  }

  protected raise(): void {
    this.layout.raise(this.id());
  }

  protected dragStart(e: PointerEvent): void {
    const r = this.host.nativeElement.getBoundingClientRect();
    this.drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  protected dragMove(e: PointerEvent): void {
    if (!this.drag) return;
    const el = this.host.nativeElement;
    const x = Math.max(0, Math.min(Math.max(0, innerWidth - el.offsetWidth), e.clientX - this.drag.dx));
    const y = Math.max(0, Math.min(Math.max(0, innerHeight - el.offsetHeight), e.clientY - this.drag.dy));
    this.layout.moveTo(this.id(), x, y);
  }

  protected dragEnd(): void {
    this.drag = null;
  }
}
