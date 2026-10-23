import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { SNIPPETS } from '../src/app/core/tour';

/**
 * One clip per guide step: the step plays on its own from a first visit and the page is recorded. The clip starts
 * when the step is ready (opening a bando or loading the demo flight is cut) and is compressed with ffmpeg (VP9,
 * 960 px, 24 fps), so the docs stay small.
 */
const DIR = 'docs/guide/clips';
mkdirSync(DIR, { recursive: true });

for (const s of SNIPPETS.filter((x) => x.section !== 'showcase')) {
  test(`clip: ${s.id}`, async ({ page }) => {
    const t0 = Date.now(); // the video starts with the page
    await page.goto('/');
    await page.getByRole('button', { name: 'Close Welcome' }).click();
    await page.locator('app-panel[data-id="views"]').evaluate((el) => ((el as HTMLElement).hidden = true)); // the step opens what it needs
    await page.evaluate((title) => {
      // the Play buttons live in the Guide panel, closed here: press the one of this step directly
      const b = [...document.querySelectorAll<HTMLButtonElement>('app-guide-panel button')].find((x) => x.getAttribute('aria-label') === `Play: ${title}`);
      b?.click();
    }, s.title);
    const bar = page.locator('app-tour-overlay .bar');
    await expect(page.locator('app-tour-overlay .bar:not([data-preparing])')).toBeVisible({ timeout: 300_000 });
    const from = Math.max(0, (Date.now() - t0) / 1000 - 0.3);
    await expect(bar).toBeHidden({ timeout: 330_000 });
    await page.waitForTimeout(400);
    const video = page.video();
    await page.close();
    const raw = `${DIR}/${s.id}.raw.webm`;
    await video?.saveAs(raw);
    const ff = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', from.toFixed(2), '-i', raw, '-vf', 'scale=960:-2,fps=24', '-c:v', 'libvpx-vp9', '-crf', '40', '-b:v', '0', '-row-mt', '1', '-an', `${DIR}/${s.id}.webm`]);
    rmSync(raw);
    expect(ff.status, String(ff.stderr)).toBe(0);
  });
}
