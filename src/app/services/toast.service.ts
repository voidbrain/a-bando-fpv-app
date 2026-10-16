import { Injectable, signal } from '@angular/core';

/** One transient message at the bottom of the screen. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly text = signal<string | null>(null);
  readonly message = this.text.asReadonly();
  private timer: ReturnType<typeof setTimeout> | undefined;

  show(message: string, ms = 2400): void {
    this.text.set(message);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.text.set(null), ms);
  }
}
