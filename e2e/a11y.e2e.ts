import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** axe on the page as it is now (WCAG 2 A and AA); the 3D canvases and the map tiles are left out. */
async function axe(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('canvas').exclude('.leaflet-tile-pane').analyze();
  return r.violations.map((v) => `${v.id} (${v.impact}): ${v.help} · ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

test('first visit: Welcome over the empty world', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('app-panel[data-id="welcome"]')).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test('after Welcome: Views and Guide me', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Guide me', exact: true }).click();
  await expect(page.locator('app-panel[data-id="views"]')).toBeVisible();
  await expect(page.locator('app-panel[data-id="guide"]')).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test('the editor with a model, the inspector and the library', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the bandos' }).click();
  await page.locator('app-studio-panel .card.ex').filter({ hasText: /^Chiari e Forti/ }).getByRole('button', { name: 'Open a copy' }).click();
  await page.locator('app-studio-panel .card:not(.ex)').filter({ hasText: 'Chiari e Forti' }).getByRole('button', { name: 'Edit area' }).click();
  await page.getByRole('button', { name: '2 · Model' }).click();
  await page.locator('app-bando-editor button').filter({ hasText: /^\W*Library$/ }).first().click();
  await expect(page.getByPlaceholder('Search blocks…')).toBeVisible();
  expect(await axe(page)).toEqual([]);
});

test('a guide step running (caption bar)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Guide me', exact: true }).click();
  await page.getByRole('button', { name: 'Play: Start a bando: find the place', exact: true }).click();
  await expect(page.locator('app-tour-overlay .bar')).toBeVisible();
  expect(await axe(page)).toEqual([]);
});
