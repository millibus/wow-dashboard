'use strict';
// The V2 dashboard is the site root; V1 lives on at /v1/, and the old /v2/
// address forwards to the root so existing links and bookmarks keep working.

const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});

test('the site root is the dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: 'Dashboard views' })).toBeVisible();
  await expect(page.locator('#freshness')).toContainText('Updated');
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();
});

test('old /v2/ links forward to the root and keep their deep link', async ({ page }) => {
  await page.goto('/v2/?guild=riot-act&tab=leaderboard#x');
  await expect(page).toHaveURL(/\/\?guild=riot-act&tab=leaderboard#x$/);
  await expect(page.getByRole('tab', { name: 'Leaderboard' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#guild-title')).toContainText('Riot Act');
});

test('the previous dashboard still works at /v1/ and links back to the new one', async ({ page }) => {
  await page.goto('/v1/');
  await expect(page.locator('#guild-stats')).toContainText('Members');
  const back = page.getByRole('link', { name: /Open the new dashboard/ });
  await back.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('tablist', { name: 'Dashboard views' })).toBeVisible();
});
