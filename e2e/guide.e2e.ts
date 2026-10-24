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

// every step must play on its own, from a first visit (opened from Welcome's Guide me)
for (const s of SNIPPETS.filter((x) => x.section !== 'showcase')) {
  test(`guide step plays alone: ${s.title}`, async ({ page }) => {
    const problems = watch(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Guide me', exact: true }).click(); // from Welcome
    await page.getByRole('button', { name: `Play: ${s.title}`, exact: true }).click();
    const bar = page.locator('app-tour-overlay .bar');
    await expect(bar).toBeVisible();
    try {
      await expect(bar).toBeHidden({ timeout: 240_000 }); // software WebGL in a headless browser is slow
    } catch (e) {
      // where it stuck: the beat, its caption and what the page said, so a timeout explains itself
      const state = await bar.innerText().catch(() => '(no caption)');
      await test.info().attach('stuck', { body: `beat: ${state}\n\n${problems.join('\n')}`, contentType: 'text/plain' });
      throw new Error(`"${s.title}" did not finish. Caption bar: ${state.replace(/\s+/g, ' ')} · page: ${problems.join(' | ') || 'no errors'}`, { cause: e });
    }
    expect(problems).toEqual([]);
  });
}
