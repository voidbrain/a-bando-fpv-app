import { expect, test, type Page } from '@playwright/test';
import { SNIPPETS } from '../src/app/core/tour';

/** What went wrong on the page: uncaught errors, console errors (not failed downloads of map tiles) and tour warnings. */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`error: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(t)) problems.push(`console: ${t}`);
    if (m.type() === 'warning' && t.startsWith('tour')) problems.push(`tour: ${t}`);
  });
  return problems;
}

// every step must play on its own, from a first visit (the Guide me panel is open then)
for (const s of SNIPPETS) {
  test(`guide step plays alone: ${s.title}`, async ({ page }) => {
    const problems = watch(page);
    await page.goto('/');
    await page.getByRole('button', { name: `Play: ${s.title}`, exact: true }).click();
    const bar = page.locator('app-tour-overlay .bar');
    await expect(bar).toBeVisible();
    await expect(bar).toBeHidden({ timeout: 330_000 }); // software WebGL in a headless browser is slow
    expect(problems).toEqual([]);
  });
}
