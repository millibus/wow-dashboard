'use strict';
// V1 → V2 feature parity: race and level filters, compare mode, full
// portrait, "Check for updates", and the header reading realm/region from
// the data rather than constants.

const { test, expect } = require('@playwright/test');

const ALL = '/v2/?guild=deaths-edge&scope=all';

// The page's Google Fonts stylesheet is render-blocking, and Chrome holds
// script execution on it. Tests here gate on network timing, so a slow or
// sandboxed font CDN must not be able to delay the app's own boot: fail the
// font requests instantly and let the fallback stack render.
test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
});

test.describe('roster filters', () => {
  test('race pills narrow the grid and round-trip through the URL', async ({ page }) => {
    await page.goto(ALL);
    await expect(page.locator('.char-card')).toHaveCount(2);
    await page.getByRole('button', { name: 'Undead', exact: true }).click();
    await expect(page.locator('.char-card')).toHaveCount(1);
    await expect(page.locator('.char-name')).toHaveText('Decillin');
    await expect(page).toHaveURL(/races=Undead/);
    await page.reload();
    await expect(page.locator('.char-card')).toHaveCount(1);
  });

  test('level pills come from config and filter by minimum level', async ({ page }) => {
    await page.goto(ALL);
    // levelCap 90 → "90 (cap)"; only Decillin (90) qualifies. Revän is 80.
    await page.getByRole('button', { name: '90 (cap)' }).click();
    await expect(page.locator('.char-card')).toHaveCount(1);
    await expect(page.locator('.char-name')).toHaveText('Decillin');
    await expect(page).toHaveURL(/minlvl=90/);
    await page.getByRole('button', { name: 'Any', exact: true }).click();
    await expect(page.locator('.char-card')).toHaveCount(2);
  });
});

test.describe('compare mode', () => {
  test('two picked cards open a side-by-side comparison', async ({ page }) => {
    await page.goto(ALL);
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.locator('#compare-bar')).toContainText('pick two');
    await page.locator('.char-card', { hasText: 'Decillin' }).click();
    await expect(page.locator('#compare-bar')).toContainText('Decillin selected');
    await expect(page.locator('.char-card', { hasText: 'Decillin' })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.char-card', { hasText: 'Revän' }).click();

    const dialog = page.locator('#compare-dialog');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(dialog.locator('.compare-name')).toHaveText(['Decillin', 'Revän']);
    await page.waitForSelector('#compare-dialog .compare-table tbody tr');
    // URLSearchParams percent-encodes the comma; accept either form.
    await expect(page).toHaveURL(/compare=us-onyxia-207690001(,|%2C)us-onyxia-207690003/);

    // Item level row: 209 vs 95 — the higher known value is marked best.
    const ilvlRow = dialog.locator('tbody tr', { hasText: 'Item level' });
    await expect(ilvlRow.locator('td').nth(0)).toHaveClass(/is-best/);
    await expect(ilvlRow.locator('td').nth(0)).toHaveText('209');

    // Escape closes and keeps compare mode on for the next pair.
    await page.keyboard.press('Escape');
    await expect(dialog).not.toHaveAttribute('open', '');
    await expect(page.locator('#compare-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#compare-bar')).toContainText('pick two');
  });

  test('a comparison is deep-linkable', async ({ page }) => {
    await page.goto(`${ALL}&compare=us-onyxia-207690001,us-onyxia-207690003`);
    await expect(page.locator('#compare-dialog')).toHaveAttribute('open', '');
    await expect(page.locator('#compare-dialog .compare-name')).toHaveCount(2);
  });

  test('a duplicated key in the URL never opens a self-comparison', async ({ page }) => {
    await page.goto(`${ALL}&compare=us-onyxia-207690001,us-onyxia-207690001`);
    await expect(page.locator('.char-card').first()).toBeVisible();
    await expect(page.locator('#compare-dialog')).not.toHaveAttribute('open', '');
    await expect(page.locator('#compare-bar')).toContainText('Decillin selected');
  });

  test('exit compare clears the selection and restores normal card clicks', async ({ page }) => {
    await page.goto(`${ALL}&compare=us-onyxia-207690001`);
    await page.getByRole('button', { name: 'Exit compare' }).click();
    await expect(page.locator('#compare-bar')).toBeHidden();
    await expect(page).not.toHaveURL(/compare=/);
    await page.locator('.char-card', { hasText: 'Decillin' }).click();
    await expect(page.locator('#detail-dialog')).toHaveAttribute('open', '');
  });
});

test.describe('character detail', () => {
  test('full portrait loads only when asked for', async ({ page }) => {
    await page.goto(ALL);
    await page.locator('.char-card', { hasText: 'Decillin' }).click();
    await page.waitForSelector('#detail-dialog[open] .gear-table');
    const toggle = page.locator('.portrait-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.portrait-frame img')).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.portrait-frame img')).toHaveCount(1);
    await expect(page.locator('.portrait-frame img')).toHaveAttribute('alt', /Decillin/);
  });
});

test.describe('check for updates', () => {
  test('is disabled until the initial manifest has loaded', async ({ page }) => {
    // Hold the first manifest response so the pre-load window is observable.
    let release;
    const gate = new Promise(r => { release = r; });
    let first = true;
    await page.route('**/data/v2/manifest.json*', async route => {
      if (first) { first = false; await gate; }
      await route.continue();
    });
    await page.goto(ALL, { waitUntil: 'commit' });
    const button = page.getByRole('button', { name: 'Check for updates' });
    await expect(button).toBeDisabled();
    release();
    await expect(button).toBeEnabled();
    await expect(page.locator('.roster-grid')).toBeVisible();
  });

  test('reports up to date when the snapshot id is unchanged', async ({ page }) => {
    await page.goto(ALL);
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await expect(page.locator('#update-notice')).toContainText('Up to date');
  });

  test('reloads when a newer snapshot has been published', async ({ page }) => {
    await page.goto(ALL);
    await page.evaluate(() => { window.__beforeReload = true; });
    let calls = 0;
    await page.route('**/data/v2/manifest.json*', async route => {
      calls += 1;
      const res = await route.fetch();
      const manifest = JSON.parse(await res.text());
      manifest.snapshotId = `${manifest.snapshotId}-newer`;
      await route.fulfill({ response: res, body: JSON.stringify(manifest) });
    });
    // Arm the listener BEFORE clicking: waitForLoadState resolves at once on
    // an already-loaded page, so it cannot observe the reload.
    const reloaded = page.waitForEvent('load');
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await reloaded;
    await expect(page.locator('.roster-grid')).toBeVisible();
    // A real navigation happened: the in-memory marker is gone.
    expect(await page.evaluate(() => window.__beforeReload)).toBeUndefined();
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});

test('switching back to a guild whose first load is still in flight never shows the other guild', async ({ page }) => {
  // Hold deaths-edge's roster; let riot-act's through at once.
  let release;
  const gate = new Promise(r => { release = r; });
  let held = 0;
  await page.route('**/data/v2/guilds/deaths-edge.json*', async route => {
    if (held === 0) { held += 1; await gate; }
    await route.continue();
  });
  await page.goto(ALL, { waitUntil: 'commit' });
  await expect(page.locator('#guild-switcher button').first()).toBeVisible();
  await page.getByRole('button', { name: 'Riot Act' }).click();
  await expect(page.locator('#guild-title')).toContainText('Riot');
  await expect(page.locator('.char-card').first()).toBeVisible();
  await page.getByRole('button', { name: 'Deaths Edge' }).click();
  // A's request is still held: the view must be a loading state, not B's cards.
  // (The title is slug-derived until A's roster lands, hence the optional apostrophe.)
  await expect(page.locator('#guild-title')).toHaveText(/Death'?s Edge/);
  await expect(page.locator('.char-card')).toHaveCount(0);
  await expect(page.locator('.empty-state')).toContainText('Loading roster');
  release();
  await expect(page.locator('.char-card')).toHaveCount(2);
  await expect(page.locator('.char-name').first()).toHaveText('Decillin');
});

test('header realm and region come from the snapshot, not constants', async ({ page }) => {
  await page.goto(ALL);
  await expect(page.locator('#guild-subtitle')).toHaveText('Onyxia-US · Guild Dashboard');
  await expect(page.locator('#guild-title')).toHaveText("Death's Edge");
});
