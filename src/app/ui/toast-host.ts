import { Component, inject } from '@angular/core';
import { ToastService } from '../services/toast.service';
import { TourService } from '../services/tour.service';

/**
 * The one-line confirmation at the bottom centre (the top centre while a guide plays, where it cannot meet the caption
 * bar). It is rendered last in the app root, outside every panel and the stage, and stacks above everything, the guide's
 * caption bar included.
 */
@Component({
  selector: 'app-toast-host',
  template: `<div class="toast" [class.show]="!!toast.message()" [class.top]="!!tour.state()" role="status" aria-live="polite">{{ toast.message() }}</div>`,
  host: { style: 'position: fixed; inset: 0; z-index: 100010; pointer-events: none' },
})
export class ToastHost {
  protected readonly toast = inject(ToastService);
  protected readonly tour = inject(TourService);
}
