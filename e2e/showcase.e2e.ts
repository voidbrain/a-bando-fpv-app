import { expect, test } from '@playwright/test';

/** The showcase link plays the welcome tour by itself and ends on its finished screen. */
test('the showcase link plays to the end', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'warning' && m.text().startsWith('tour') && errors.push(m.text())); // a step that found nothing to point at
  await page.goto('/?tour=showcase&lang=it');
  const bar = page.locator('app-tour-overlay .bar');
  await expect(bar).toBeVisible({ timeout: 20_000 });
  await expect(bar).toContainText('OpenBando'); // Italian captions (the app name stays)
  await expect(bar).toBeHidden({ timeout: 300_000 });
  const shown = await page.locator('app-panel:not([hidden])').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-id')}${e.classList.contains('ghost') ? '*' : ''}`));
  expect(shown.sort()).toEqual(['attitude', 'blackbox', 'path', 'speed', 'timeline', 'video*', 'vpFpv'].sort()); // only the video under glass
  expect(errors).toEqual([]);
});

/** The showcase skips the scan: the offset it uses must be the one a real Auto-sync finds for the demo flight. */
test('the showcase offset is what Auto-sync finds', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Close Welcome' }).click();
  const load = async (panel: string, url: string, name: string, type: string): Promise<void> => {
    await page.evaluate(
      async ([panel, url, name, type]) => {
        const blob = await (await fetch(url)).blob();
        const input = document.querySelector<HTMLInputElement>(`app-panel[data-id="${panel}"] input[type=file]`)!;
        const dt = new DataTransfer();
        dt.items.add(new File([blob], name, { type }));
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      [panel, url, name, type],
    );
  };
  await page.evaluate(() => {
    for (const id of ['flights', 'video']) document.querySelector<HTMLElement>(`app-panel[data-id="${id}"]`)!.hidden = false;
  });
  await load('flights', 'guide-demo/flight.csv', 'demo.csv', 'text/csv');
  await load('video', 'guide-demo/flight.mp4', 'demo.mp4', 'video/mp4');
  await page.waitForTimeout(1500);
  await page.locator('app-panel[data-id="video"] [data-tour~="auto-sync"]').click();
  const status = page.locator('app-panel[data-id="video"]');
  await expect(status).toContainText(/offset -?\d+\.\d+ s/, { timeout: 240_000 });
  const found = Number(/offset (-?\d+\.\d+) s/.exec((await status.textContent()) ?? '')![1]);
  expect(Math.abs(found - -0.54)).toBeLessThan(0.15); // DEMO_OFFSET in services/tour.service.ts
});
