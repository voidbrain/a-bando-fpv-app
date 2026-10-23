import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { SNIPPETS } from '../src/app/core/tour';

/** One clip per guide step: the step plays on its own from a first visit, the page is recorded, the video is kept. */
const DIR = 'docs/guide/clips';
mkdirSync(DIR, { recursive: true });

for (const s of SNIPPETS) {
  test(`clip: ${s.id}`, async ({ page }) => {
    await page.goto('/');
    // the Guide me panel is open on a first visit: close it so the step has the screen
    await page.getByRole('button', { name: `Play: ${s.title}`, exact: true }).click();
    await page.getByRole('button', { name: 'Close Guide me' }).click({ trial: false }).catch(() => undefined);
    const bar = page.locator('app-tour-overlay .bar');
    await expect(bar).toBeVisible();
    await expect(bar).toBeHidden({ timeout: 330_000 });
    await page.waitForTimeout(400);
    const video = page.video();
    await page.close();
    await video?.saveAs(`${DIR}/${s.id}.webm`);
  });
}
