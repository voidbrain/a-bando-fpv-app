import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

/**
 * The three short films of the Welcome panel (public/welcome/*.webm), recorded from the app itself:
 *  build = Chiari e Forti turning in the main view, no panels;
 *  fly = the showcase's synced replay screen;  share = the bando editor (the plan, a building selected, its inspector).
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
  // a slow, even turn around the factory: a drag driven from inside the page, one small step per frame (moves sent
  // from here arrive unevenly and the film stuttered)
  await page.locator('app-stage .gl').evaluate(
    (el) =>
      new Promise<void>((done) => {
        const fire = (type: string, x: number): boolean => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, clientX: x, clientY: 450, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
        fire('pointerdown', 900);
        const t0 = performance.now();
        const step = (): void => {
          const t = (performance.now() - t0) / 1000;
          if (t > 9) {
            fire('pointerup', 900 - 9 * 40);
            return done();
          }
          fire('pointermove', 900 - t * 40);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );
  const raw = await save(page, 'build');
  cut(raw, `${DIR}/build.webm`, from, 8);
  rmSync(raw);
});

test('film: fly (from the showcase)', async ({ page }) => {
  const t0 = Date.now();
  await page.goto('/?tour=showcase&lang=en');
  // the films have no caption or drawn cursor: they play under any language
  await page.addStyleTag({ content: 'app-tour-overlay { visibility: hidden !important; }' });
  const say = page.locator('app-tour-overlay .bar .say');
  await expect(say).toContainText('every number of the flight', { timeout: 120_000 });
  const relive = (Date.now() - t0) / 1000 + 1.5;
  await page.waitForTimeout(10_000);
  const raw = await save(page, 'showcase');
  cut(raw, `${DIR}/fly.webm`, relive, 8);
  rmSync(raw);
});

test('film: share (the bando editor)', async ({ page }) => {
  const t0 = Date.now();
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the bandos' }).click();
  await page.locator('app-studio-panel .card.ex').filter({ hasText: /^Chiari e Forti/ }).getByRole('button', { name: 'Open a copy' }).click();
  await page.waitForTimeout(2500);
  await page.locator('app-studio-panel .card').filter({ hasText: /^Chiari e Forti/ }).first().getByRole('button', { name: 'Edit area' }).click();
  await page.waitForTimeout(3000);
  // the editor alone, over the model (Views is not drawn for the film)
  await page.locator('app-panel[data-id="views"]').evaluate((el) => ((el as HTMLElement).hidden = true));
  // the editor fully in the frame: dragged by its title bar, like a pilot would
  const head = page.locator('app-panel[data-id="studio"] > header.grip').first();
  const hb = await head.boundingBox();
  const sb = await page.locator('app-panel[data-id="studio"]').boundingBox();
  if (hb && sb) {
    await page.mouse.move(hb.x + 60, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 60 - Math.max(0, sb.x + sb.width - 1280 + 60), hb.y + hb.height / 2 + 20, { steps: 12 });
    await page.mouse.up();
  }
  await page.waitForTimeout(800);
  const from = (Date.now() - t0) / 1000;
  // pick a building on the plan (outline, knobs, the inspector and its 3D preview), then the editor's 3D view
  const plan = page.locator('app-bando-editor .map').first();
  const box = await plan.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.65, { steps: 30 });
    await page.waitForTimeout(500);
    await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.42);
  }
  await page.waitForTimeout(3000);
  await page.locator('app-bando-editor').getByRole('button', { name: '3D', exact: true }).first().click();
  await page.waitForTimeout(4500);
  const raw = await save(page, 'share');
  cut(raw, `${DIR}/share.webm`, from, 8);
  rmSync(raw);
});
