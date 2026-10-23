import { defineConfig } from '@playwright/test';

/**
 * End-to-end checks in a real browser: every guide step plays on its own without errors, and the main screens pass
 * axe (WCAG 2 A / AA). `npm run e2e` starts its own dev server on port 4300.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  timeout: 360_000,
  fullyParallel: true,
  workers: process.env['CI'] ? 2 : 4,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:4300', viewport: { width: 1400, height: 900 }, locale: 'en-US' },
  webServer: { command: 'npx ng serve --port 4300', url: 'http://localhost:4300', timeout: 240_000, reuseExistingServer: !process.env['CI'] },
});
