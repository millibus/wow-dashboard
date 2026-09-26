'use strict';
// The previous V1 dashboard (docs/v1/: index.html + app.js), kept at /v1/ as a
// fallback after the V2 cutover, so its refresh behavior and its handling of
// an old snapshot stay covered. It reads the legacy files the pipeline writes
// to /data/ (one level up from its own page).

const { test, expect } = require('@playwright/test');

// Fixture logins are 2025-08-24. Pin the roster's own timestamp a few days
// after that, and the snapshot far in the past, to reproduce a pipeline that
// stopped refreshing a long time ago.
const ROSTER_AS_OF = '2025-08-28T00:00:00.000Z';

async function routeStaleRoster(page, { ilvl } = {}) {
  await page.route('**/data/guild-deaths-edge.json*', async route => {
    const res = await route.fetch();
    const data = JSON.parse(await res.text());
    data.lastUpdated = ROSTER_AS_OF;
    // Owners map by NAME in V1, so a refresh is made observable through a
    // value on the card rather than a rename.
    if (ilvl) for (const m of data.members) if (m.name === 'Decillin') m.averageIlvl = ilvl;
    await route.fulfill({ response: res, body: JSON.stringify(data) });
  });
}

async function routeSnapshotTs(page, ts) {
  await page.route('**/data/generated-at.json*', route =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ts }) }));
}

test.beforeEach(async ({ page }) => {
  await routeSnapshotTs(page, ROSTER_AS_OF);
});

test('an old snapshot still opens on its active characters, not an empty grid', async ({ page }) => {
  await routeStaleRoster(page);
  await page.goto('/v1/');
  await expect(page.locator('#stale-banner')).toBeVisible();
  // "Active" is measured from the roster's timestamp, not the viewer's clock.
  await expect(page.locator('.char-card').first()).toBeVisible();
  await expect(page.locator('#guild-stats')).not.toContainText('Infinity');
});

test('the summary never shows -Infinity when nothing is in scope', async ({ page }) => {
  // Unmodified fixture roster: its timestamp is fresh and every login is past
  // the archive threshold, so the active scope is empty.
  await page.goto('/v1/');
  await expect(page.locator('#guild-stats')).toContainText('Top ilvl');
  await expect(page.locator('#guild-stats')).not.toContainText('Infinity');
});

test('Refresh reloads the snapshot in place and keeps the search', async ({ page }) => {
  await routeStaleRoster(page);
  await page.goto('/v1/');
  await expect(page.locator('.char-card').first()).toBeVisible();
  await page.locator('#search').fill('Decil');
  await expect(page.locator('.char-card')).toHaveCount(1);

  await page.unroute('**/data/guild-deaths-edge.json*');
  await routeStaleRoster(page, { ilvl: 777 });
  await page.getByRole('button', { name: /Refresh/ }).click();
  await expect(page.locator('.char-card')).toHaveCount(1);
  await expect(page.locator('.char-card')).toContainText('777');
  await expect(page.getByRole('button', { name: /Refresh/ })).toBeEnabled();
});

test('a newer snapshot is picked up automatically, with no reload', async ({ page }) => {
  await page.clock.install();
  await routeStaleRoster(page);
  await page.goto('/v1/');
  await expect(page.locator('.char-card').first()).toBeVisible();
  await page.evaluate(() => { window.__beforeRefresh = true; });

  await page.unroute('**/data/generated-at.json*');
  await routeSnapshotTs(page, '2025-08-28T01:00:00.000Z');
  await page.unroute('**/data/guild-deaths-edge.json*');
  await routeStaleRoster(page, { ilvl: 777 });

  await page.clock.runFor(5 * 60e3 + 1000);
  await expect(page.locator('.char-card', { hasText: '777' })).toBeVisible();
  expect(await page.evaluate(() => window.__beforeRefresh)).toBe(true);
});

test.describe('collections pickers', () => {
  test('list only owned characters the snapshot has data for, and every entry loads', async ({ page }) => {
    // Remove Revän's pets so the picker must leave them out.
    await page.route('**/data/collections-deaths-edge.json*', async route => {
      const res = await route.fetch();
      const data = JSON.parse(await res.text());
      delete data['Revän'].pets;
      await route.fulfill({ response: res, body: JSON.stringify(data) });
    });
    await page.goto('/v1/?tab=pets');
    const options = page.locator('#pets-char-select option');
    await expect(options).toHaveCount(2); // placeholder + Decillin
    await expect(options.nth(1)).toContainText('Decillin');
    await page.selectOption('#pets-char-select', { index: 1 });
    await expect(page.locator('#pets-grid')).not.toContainText('Failed');
    await expect(page.locator('#pets-summary')).not.toBeEmpty();
  });

  test('mounts lists every character with data, not only the active ones', async ({ page }) => {
    // Fixture logins are all past the archive threshold: the active scope is
    // empty, yet both characters have mounts.
    await page.goto('/v1/?tab=mounts');
    await expect(page.locator('#mounts-char-select option')).toHaveCount(3);
  });

  test('switching guild rebuilds the picker for the new guild', async ({ page }) => {
    await page.goto('/v1/?tab=pets');
    await expect(page.locator('#pets-char-select option')).toHaveCount(3);
    await page.selectOption('#pets-char-select', { index: 1 });
    await expect(page.locator('#pets-summary')).not.toBeEmpty();

    await page.locator('.guild-toggle-btn[data-slug="riot-act"]').click();
    const options = page.locator('#pets-char-select option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(1)).toContainText('Grrumpy');
    await expect(page.locator('#pets-grid')).toContainText('Select a character');
  });
});

test('raids say so when the snapshot has no raid records, instead of showing zeros', async ({ page }) => {
  // The pipeline omits members whose raid fetch failed; none at all = unknown.
  await page.route('**/data/raid-deaths-edge.json*', async route => {
    const res = await route.fetch();
    const data = JSON.parse(await res.text());
    data.members = [];
    await route.fulfill({ response: res, body: JSON.stringify(data) });
  });
  await page.goto('/v1/?tab=raids');
  await expect(page.locator('#raid-content')).toContainText('Raid progress is not in this snapshot');
});

test('members fetched with no kills show as a real zero, not as unknown', async ({ page }) => {
  await page.route('**/data/raid-deaths-edge.json*', async route => {
    const res = await route.fetch();
    const data = JSON.parse(await res.text());
    for (const m of data.members) m.tiers = [];
    await route.fulfill({ response: res, body: JSON.stringify(data) });
  });
  await page.goto('/v1/?tab=raids');
  await expect(page.locator('#raid-content')).not.toContainText('not in this snapshot');
  await expect(page.locator('#raid-content')).toContainText('0 of 2');
});

test('a guild switch during a slow collections load still builds the new guild\'s picker', async ({ page }) => {
  let release;
  const gate = new Promise(r => { release = r; });
  await page.route('**/data/collections-deaths-edge.json*', async route => {
    await gate;
    await route.continue();
  });
  // Hold riot-act's collections briefly too, so it lands after the switch.
  await page.route('**/data/collections-riot-act.json*', async route => {
    await new Promise(r => setTimeout(r, 300));
    await route.continue();
  });
  await page.goto('/v1/?tab=pets');
  await page.locator('.guild-toggle-btn[data-slug="riot-act"]').click();
  release(); // deaths-edge's request resumes while riot-act is current
  const options = page.locator('#pets-char-select option');
  await expect(options.nth(1)).toContainText('Grrumpy');
  await expect(options).toHaveCount(2);
});
