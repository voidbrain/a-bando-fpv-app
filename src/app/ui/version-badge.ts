import { ChangeDetectionStrategy, Component } from '@angular/core';
import { APP_COMMIT, APP_VERSION } from '../version';

/** Build number badge, bottom-left. The deploy workflow bumps it on every push to main. */
@Component({
  selector: 'app-version-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="ver" [title]="commit">v{{ version }}</span>`,
  styles: `
    :host {
      position: fixed;
      left: 8px;
      bottom: 8px;
      z-index: 100001;
      pointer-events: none;
    }
    .ver {
      font: 600 11px monospace;
      color: #eff7e8;
      background: rgba(10, 16, 12, 0.75);
      padding: 2px 7px;
      border-radius: 10px;
    }
  `,
})
export class VersionBadge {
  protected readonly version = APP_VERSION;
  protected readonly commit = APP_COMMIT;
}
