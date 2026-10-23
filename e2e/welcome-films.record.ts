import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

/**
 * The three short films of the Welcome panel (public/welcome/*.webm), recorded from the app itself:
 *  build  = Chiari e Forti turning in the main view, no panels;
 *  fly = the showcase's synced replay screen;  share = its four cameras under glass (what a render shows).
 * Run with `npm run films` (the clips config: the GPU, 1440 × 900). Needs ffmpeg.
 */
const DIR = 'public/welcome';
mkdirSync(DIR, { recursive: true });

function cut(raw: string, out: string, from: number, len: number): void {
  const ff = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', from.toFixed(2), '-t', String(len), '-i', raw, '-vf', 'scale=720:-2,fps=24', '-c:v', 'libvpx-vp9', '-crf', '38', '-b:v', '0', '-row-mt', '1', '-an', out]);
  expect(ff.status, String(ff.stderr)).toBe(0);
}

async function save(page: Page, name: string): Promise<string> {
  const video = page.video();
  await page.close();
  const raw = `${DIR}/${name}.raw.webm`;
  await video?.saveAs(raw);
  return raw;
}

test('film: build', async ({ page }) => {
  const t0 = Date.now();
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the bandos' }).click();
  await page.locator('app-studio-panel .card.ex').filter({ hasText: /^Chiari e Forti/ }).getByRole('button', { name: 'Open a copy' }).click();
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: 'Hide every panel but this one' }).click();
  // Views has no ×: for the film it simply is not drawn
  await page.locator('app-panel[data-id="views"]').evaluate((el) => ((el as HTMLElement).hidden = true));
  await page.waitForTimeout(800);
  const from = (Date.now() - t0) / 1000;
  // a slow turn around the factory: the left button drags the orbit
  await page.mouse.move(900, 450);
  await page.mouse.down();
  for (let i = 0; i < 160; i++) {
    await page.mouse.move(900 - i * 2.2, 450 + Math.sin(i / 30) * 6);
    await page.waitForTimeout(50);
  }
  await page.mouse.up();
  const raw = await save(page, 'build');
  cut(raw, `${DIR}/build.webm`, from, 8);
  rmSync(raw);
});

test('films: fly and share (from the showcase)', async ({ page }) => {
  const t0 = Date.now();
  await page.goto('/?tour=showcase&lang=en');
  // the films have no caption or drawn cursor: they play under any language
  await page.addStyleTag({ content: 'app-tour-overlay { visibility: hidden !important; }' });
  const say = page.locator('app-tour-overlay .bar .say');
  await expect(say).toContainText('every number of the flight', { timeout: 120_000 });
  const relive = (Date.now() - t0) / 1000 + 1.5;
  await expect(say).toContainText('The video turns to glass', { timeout: 120_000 });
  const pro = (Date.now() - t0) / 1000 + 1.5;
  await page.waitForTimeout(9000);
  const raw = await save(page, 'showcase');
  cut(raw, `${DIR}/fly.webm`, relive, 8);
  cut(raw, `${DIR}/share.webm`, pro, 8);
  rmSync(raw);
});
