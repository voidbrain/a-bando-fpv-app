import { Component, inject } from '@angular/core';
import { ToastService } from '../services/toast.service';

/**
 * The one-line confirmation at the bottom centre. It is rendered last in the app root, outside every panel and the
 * stage, so it is always on top of panels, dialogs and float boxes.
 */
@Component({
  selector: 'app-toast-host',
  template: `<div class="toast" [class.show]="!!toast.message()" role="status" aria-live="polite">{{ toast.message() }}</div>`,
  host: { style: 'position: fixed; inset: auto 0 0 0; z-index: 100000; pointer-events: none' },
})
export class ToastHost {
  protected readonly toast = inject(ToastService);
}
