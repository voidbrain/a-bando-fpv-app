import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { LibraryStore } from './services/library-store.service';
import { SiteLibraryService } from './services/site-library.service';
import { BlockLibraryService } from './services/block-library.service';

/**
 * The app is zoneless: rendering is driven by one requestAnimationFrame loop and by signals, so Angular's change
 * detection only runs when a signal that a template reads actually changes.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    // the library (bandos, blocks, the catalogue) lives in IndexedDB: load it before anything reads it
    provideAppInitializer(async () => {
      const library = inject(SiteLibraryService);
      const blocks = inject(BlockLibraryService);
      await inject(LibraryStore).init();
      library.migrateLegacy();
      void blocks.sync(); // the catalogue refreshes in the background; the cached one is usable at once
    }),
  ],
};
