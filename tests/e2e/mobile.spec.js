'use strict';
// Mobile-viewport behavior (runs on the Pixel 5 project only).

const { test, expect } = require('@playwright/test');
const { stubRenders, overflowsSideways } = require('./helpers');

const BASE = '/?guild=deaths-edge&scope=all';

test.beforeEach(async ({ page }) => { await stubRenders(page); });

test('the bottom nav replaces the tab strip and switches views', async ({ page }) => {
  await page.goto(BASE);
  await expect(page.locator('#tabs')).toBeHidden();
  const nav = page.locator('#bottom-nav button');
  await expect(nav.first()).toBeVisible();
  await expect(nav).toHaveCount(4);

  await nav.filter({ hasText: 'Raids' }).click();
  await expect(page.locator('.tier-head')).toBeVisible();
  await expect(nav.filter({ hasText: 'Raids' })).toHaveAttribute('aria-current', 'true');
});

test('bottom-nav targets meet the 44px touch minimum', async ({ page }) => {
  await page.goto(BASE);
  for (const btn of await page.locator('#bottom-nav button').all()) {
    const box = await btn.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

test('the page never scrolls sideways, even with a wide table', async ({ page }) => {
  await page.goto(`${BASE}&tab=raids`);
  await page.waitForSelector('.matrix');
  expect(await overflowsSideways(page)).toBe(false);
});

test('the game switch and guild switch both fit the phone header', async ({ page }) => {
  await page.goto(BASE);
  const viewport = page.viewportSize();
  for (const name of ['Retail', 'Forever', 'Deaths Edge', 'Riot Act']) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.height).toBeGreaterThanOrEqual(36);
  }
  expect(await overflowsSideways(page)).toBe(false);
});

test('the character sheet fills the phone screen and scrolls inside itself', async ({ page }) => {
  await page.goto(BASE);
  await page.locator('.char-card', { hasText: 'Decillin' }).click();
  await page.waitForSelector('#detail-dialog[open] .gear-table');
  const box = await page.locator('#detail-dialog').boundingBox();
  const viewport = page.viewportSize();
  expect(Math.round(box.width)).toBe(viewport.width);
  expect(await overflowsSideways(page)).toBe(false);
  const close = await page.getByRole('button', { name: 'Close dialog' }).boundingBox();
  expect(close.height).toBeGreaterThanOrEqual(44);
});

test('the refresh button stays reachable on phones, as a full-size icon target', async ({ page }) => {
  await page.goto(BASE);
  const button = page.getByRole('button', { name: 'Refresh' });
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  const box = await button.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
});

// The accessibility scans in a11y.spec.js run at desktop width only, and a
// control can lose its name in the phone layout alone (the sort label is
// hidden there). Scan the phone layouts too.
for (const [name, url, ready] of [
  ['roster', BASE, '.roster-grid'],
  ['leaderboard', `${BASE}&tab=leaderboard`, '.lb-table'],
  ['Forever', '/?game=forever', 'h2'],
]) {
  test(`the ${name} view has no WCAG A/AA violations on a phone`, async ({ page }) => {
    const AxeBuilder = require('@axe-core/playwright').default;
    await page.goto(url);
    await page.locator(ready).first().waitFor();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const summary = results.violations
      .map(v => `${v.id}: ${v.help}\n    ${v.nodes.map(n => n.target.join(' ')).join('\n    ')}`).join('\n');
    expect(results.violations, summary).toEqual([]);
  });
}

test('the sort control keeps its accessible name when its label is hidden', async ({ page }) => {
  await page.goto(BASE);
  await expect(page.getByRole('combobox', { name: 'Sort' })).toBeVisible();
});
