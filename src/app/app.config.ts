import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';

/**
 * The app is zoneless: rendering is driven by one requestAnimationFrame loop and by signals, so Angular's change
 * detection only runs when a signal that a template reads actually changes.
 */
export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners(), provideZonelessChangeDetection()],
};
