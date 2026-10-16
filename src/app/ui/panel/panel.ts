import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, untracked } from '@angular/core';
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
    '[style.width.px]': 'state().w ?? def().width ?? null',
    '[style.height.px]': 'def().resizable && !state().minimized ? (state().h ?? def().height ?? null) : null',
    '(pointerdown)': 'raise()',
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
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    // Remember the size a resizable panel was dragged to.
    effect((onCleanup) => {
      if (!this.def().resizable) return;
      const el = this.host.nativeElement;
      let first = true;
      const ro = new ResizeObserver(() => {
        if (first || el.hidden) {
          first = false;
          return;
        }
        const w = Math.round(el.offsetWidth);
        const h = Math.round(el.offsetHeight);
        const s = untracked(() => this.state());
        if (w > 0 && h > 0 && (Math.abs(w - (s.w ?? this.def().width ?? 0)) > 1 || Math.abs(h - (s.h ?? this.def().height ?? 0)) > 1)) this.layout.resizeTo(this.id(), w, h);
      });
      ro.observe(el);
      this.resizeObserver = ro;
      onCleanup(() => ro.disconnect());
    });
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
