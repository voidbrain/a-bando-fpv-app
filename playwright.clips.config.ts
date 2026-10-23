import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** `npm run clips`: record every guide step as a video clip (docs/guide/clips/<step>.webm). */
export default defineConfig({
  ...base,
  testMatch: 'clips.record.ts',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: 'list',
  use: {
    ...base.use,
    viewport: { width: 1280, height: 800 },
    video: { mode: 'on', size: { width: 1280, height: 800 } },
    // the GPU where there is one: software WebGL draws the 3D steps at a few frames a second
    launchOptions: { args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] },
  },
});
