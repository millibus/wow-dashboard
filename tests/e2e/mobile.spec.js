'use strict';
// Mobile-viewport behavior (runs on the Pixel 5 project only).

const { test, expect } = require('@playwright/test');

const BASE = '/v2/?guild=deaths-edge&scope=all';

test('the bottom nav replaces the tab strip and switches views', async ({ page }) => {
  await page.goto(BASE);
  await expect(page.locator('#tabs')).toBeHidden();
  const nav = page.locator('#bottom-nav button');
  await expect(nav.first()).toBeVisible();
  await expect(nav).toHaveCount(5);

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
  const overflows = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflows).toBe(false);
});
