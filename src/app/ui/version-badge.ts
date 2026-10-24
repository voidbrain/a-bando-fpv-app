import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { LANGS, type Lang } from '../core/i18n';
import { I18nService } from '../services/i18n.service';
import { LayoutStore } from '../state/layout.store';
import { APP_COMMIT, APP_VERSION } from '../version';

/**
 * Build number badge, bottom-left, with the language flag (the deploy workflow bumps the number on every push to main)
 * and, while the Views panel is closed, a menu button that brings it back: the way to every other panel.
 */
@Component({
  selector: 'app-version-badge',
  host: { '(document:pointerdown)': 'outside($event)', '(document:keydown.escape)': 'open.set(false)' },
  template: `
    <span class="ver" [title]="commit">v{{ version }}</span>
    <button type="button" class="flag" (click)="open.set(!open())" [attr.aria-expanded]="open()" aria-haspopup="menu" [attr.aria-label]="'Language: ' + current().name" title="Language">
      <ng-container *ngTemplateOutlet="flag; context: { $implicit: current().id }" />
    </button>
    @if (!viewsShown()) {
      <button type="button" class="flag views" (click)="showViews()" title="Open the Views panel: every panel, the cameras" aria-label="Open the Views panel">
        <svg viewBox="0 0 24 24" width="16" height="14" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
    }
    @if (open()) {
      <div class="menu" role="menu" translate="no">
        @for (l of langs; track l.id) {
          <button type="button" role="menuitemradio" [attr.aria-checked]="l.id === i18n.lang()" [class.on]="l.id === i18n.lang()" (click)="pick(l.id)">
            <ng-container *ngTemplateOutlet="flag; context: { $implicit: l.id }" />
            {{ l.name }}
          </button>
        }
      </div>
    }
    <ng-template #flag let-id>
      @if (id === 'it') {
        <svg viewBox="0 0 3 2" width="18" height="12" aria-hidden="true"><rect width="1" height="2" fill="#009246" /><rect x="1" width="1" height="2" fill="#ffffff" /><rect x="2" width="1" height="2" fill="#ce2b37" /></svg>
      } @else {
        <svg viewBox="0 0 60 30" width="18" height="12" aria-hidden="true">
          <rect width="60" height="30" fill="#012169" />
          <path d="M0 0 60 30M60 0 0 30" stroke="#ffffff" stroke-width="6" />
          <path d="M0 0 60 30M60 0 0 30" stroke="#c8102e" stroke-width="2" />
          <path d="M30 0v30M0 15h60" stroke="#ffffff" stroke-width="10" />
          <path d="M30 0v30M0 15h60" stroke="#c8102e" stroke-width="6" />
        </svg>
      }
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
  styles: `
    :host {
      position: fixed;
      left: 8px;
      bottom: 8px;
      z-index: 100001;
      display: flex;
      align-items: center;
      gap: 4px;
      pointer-events: none;
    }
    .ver {
      font: 600 11px monospace;
      color: #eff7e8;
      background: rgba(10, 16, 12, 0.75);
      padding: 2px 7px;
      border-radius: 10px;
    }
    .flag {
      pointer-events: auto;
      display: flex;
      padding: 3px 5px;
      border: 0;
      border-radius: 10px;
      background: rgba(10, 16, 12, 0.75);
      cursor: pointer;
    }
    .views path {
      stroke: #eff7e8;
      stroke-width: 2.2;
      stroke-linecap: round;
    }
    .flag:focus-visible,
    .menu button:focus-visible {
      outline: 2px solid var(--accent);
    }
    .menu {
      pointer-events: auto;
      position: absolute;
      left: 0;
      bottom: 26px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px;
      background: var(--panel-solid);
      border: 1px solid var(--line);
      border-radius: 9px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    }
    .menu button {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 10px 4px 6px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: none;
      color: var(--text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .menu button:hover {
      background: rgba(255, 255, 255, 0.08);
    }
    .menu button.on {
      border-color: var(--accent);
    }
  `,
})
export class VersionBadge {
  protected readonly i18n = inject(I18nService);
  private readonly layout = inject(LayoutStore);
  protected readonly viewsShown = computed(() => this.layout.panels().views.visible);
  protected readonly version = APP_VERSION;
  protected readonly commit = APP_COMMIT;
  protected readonly langs = LANGS;
  protected readonly open = signal(false);
  protected readonly current = computed(() => LANGS.find((l) => l.id === this.i18n.lang()) ?? LANGS[0]!);

  protected showViews(): void {
    this.layout.setVisible('views', true);
  }

  protected pick(id: Lang): void {
    this.i18n.set(id);
    this.open.set(false);
  }

  protected outside(e: PointerEvent): void {
    if (this.open() && !(e.target as Element | null)?.closest('app-version-badge')) this.open.set(false);
  }
}
