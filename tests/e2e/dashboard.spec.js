'use strict';
// Functional browser coverage for the dashboard, against a snapshot built by
// the real pipeline from fixtures.
//
// Fixture roster (deaths-edge): Decillin (90, ilvl 209), Farshore (85, ilvl
// 150, another realm), Revän (80, ilvl 95), Kel'thar (75, ilvl 98), plus a
// level-5 member the pipeline filters out entirely. Every guild member is
// listed by default; logins are old, so the "seen lately" scope is empty.

const { test, expect } = require('@playwright/test');
const { stubRenders } = require('./helpers');

const ALL = '/?guild=deaths-edge&scope=all';

test.beforeEach(async ({ page }) => { await stubRenders(page); });

test.describe('roster', () => {
  test('lists every guild member, highest level first', async ({ page }) => {
    await page.goto('/?guild=deaths-edge');
    await expect(page.locator('.char-card')).toHaveCount(4);
    const names = await page.locator('.char-name').allTextContents();
    // Level, then item level within a level. Kel'thar's item level (98) is
    // higher than Revän's (95), but Revän is the higher level: item level is
    // never compared across levels.
    expect(names).toEqual(['Decillin', 'Farshore', 'Revän', "Kel'thar"]);
  });

  test('the seen-lately scope is a filter, never the default', async ({ page }) => {
    await page.goto('/?guild=deaths-edge&scope=active');
    await expect(page.locator('.empty-state')).toContainText('Nobody has been on lately');
    await expect(page.locator('.char-card')).toHaveCount(0);
    await page.getByRole('button', { name: /^Everyone/ }).click();
    await expect(page.locator('.char-card')).toHaveCount(4);
    await expect(page).not.toHaveURL(/scope=/);
  });

  test('search and class filters narrow the list', async ({ page }) => {
    await page.goto(ALL);
    await page.fill('#search', 'warlock');
    await expect(page.locator('.char-card')).toHaveCount(1);
    await expect(page.locator('.char-name')).toHaveText('Revän');
    await page.fill('#search', '');
    await page.getByRole('button', { name: 'Class, race, level' }).click();
    await page.getByRole('button', { name: 'Death Knight', exact: true }).click();
    await expect(page.locator('.char-name')).toHaveText('Decillin');
  });

  test('sorting by name reorders the list and round-trips through the URL', async ({ page }) => {
    await page.goto(ALL);
    await page.selectOption('#sort', 'name');
    await expect(page).toHaveURL(/sort=name/);
    expect(await page.locator('.char-name').allTextContents())
      .toEqual(['Decillin', 'Farshore', "Kel'thar", 'Revän']);
    // An old link's sort=ilvl is the level sort now, not an error.
    await page.goto(`${ALL}&sort=ilvl`);
    await expect(page.locator('.char-name').first()).toHaveText('Decillin');
    await expect(page.locator('#sort')).toHaveValue('level');
  });

  test('freshness pill reports a fresh snapshot and no stale banner', async ({ page }) => {
    await page.goto(ALL);
    await expect(page.locator('#freshness')).toHaveClass(/is-fresh/);
    await expect(page.locator('#stale-banner')).toBeHidden();
  });
});

test.describe('character detail', () => {
  test('opens, lists gear, and restores focus on close', async ({ page }) => {
    await page.goto(ALL);
    await page.locator('.char-card', { hasText: 'Decillin' }).click();
    const dialog = page.locator('#detail-dialog');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(page.locator('.detail-title')).toHaveText('Decillin');
    // equipped_item_level is authoritative — cosmetic slots never drag it down.
    await expect(page.locator('.detail-ilvl b')).toHaveText('209');
    await expect(page.locator('.gear-table tbody tr').nth(2)).toBeVisible();
    expect(await page.locator('.gear-table tbody tr').count()).toBeGreaterThanOrEqual(3);

    // Focus must stay inside the dialog after the async detail load re-renders it.
    expect(await page.evaluate(() =>
      document.getElementById('detail-dialog').contains(document.activeElement))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(dialog).not.toHaveAttribute('open', '');
    expect(await page.evaluate(() => document.activeElement?.className || '')).toContain('char-card');
  });

  test('is deep-linkable and survives a reload', async ({ page }) => {
    await page.goto(ALL);
    await page.locator('.char-card', { hasText: 'Decillin' }).click();
    await expect(page).toHaveURL(/char=us-onyxia-207690001/);
    await page.reload();
    await expect(page.locator('.detail-title')).toHaveText('Decillin');
  });
});

test.describe('leaderboard', () => {
  test('ranks item level only among characters at the level cap, and switches metric', async ({ page }) => {
    await page.goto(`${ALL}&tab=leaderboard`);
    const firstRow = page.locator('.lb-table tbody tr').first();
    await expect(firstRow).toContainText('Decillin');
    await expect(firstRow.locator('.num')).toHaveText('209');
    // Only Decillin is level 90 (the cap comes from the manifest). The other
    // three have item levels too, but on other scales: counted, not ranked.
    await expect(page.locator('.lb-table tbody tr')).toHaveCount(1);
    await expect(page.locator('#view')).toContainText('3 characters are below level 90 and not ranked');

    await page.getByRole('button', { name: 'Deaths', exact: true }).click();
    await expect(page).toHaveURL(/metric=deaths/);
    await expect(page.locator('.lb-table tbody tr').first()).toContainText('123');
    // Every member is eligible for a lifetime metric, whatever their level.
    expect(await page.locator('.lb-table tbody tr').count()).toBeGreaterThan(1);
  });

  test('renders unknown values as an em dash, never zero', async ({ page }) => {
    await page.goto(`${ALL}&tab=leaderboard&metric=quests`);
    const cells = await page.locator('.lb-table tbody .num').allTextContents();
    for (const cell of cells) expect(cell === '0').toBe(false);
  });
});

test.describe('raids', () => {
  test('builds the boss matrix from the discovered catalog', async ({ page }) => {
    await page.goto(`${ALL}&tab=raids`);
    await expect(page.locator('.tier-title h3')).toHaveText('Liberation of Undermine');
    // Two encounters discovered via the journal API in the fixtures.
    await expect(page.locator('.matrix thead th')).toHaveCount(3); // corner + 2 bosses
    await expect(page.locator('.matrix tbody tr')).toHaveCount(2);
    const vexieCell = page.locator('.matrix tbody tr').first().locator('.matrix-cell').first();
    await expect(vexieCell).toHaveText('4');
    await expect(vexieCell).toHaveClass(/is-killed/);
  });

  test('a raid nobody has a kill in shows its encounters, not a grid of dashes', async ({ page }) => {
    await page.route('**/data/v2/raids/deaths-edge.json*', async route => {
      const res = await route.fetch();
      const data = JSON.parse(await res.text());
      for (const m of data.members) m.tiers = [];
      await route.fulfill({ response: res, body: JSON.stringify(data) });
    });
    await page.goto(`${ALL}&tab=raids`);
    await expect(page.locator('.unopened')).toContainText('Nobody has a kill in here yet');
    await expect(page.locator('.boss-list .boss')).toHaveCount(2);
    await expect(page.locator('.boss-name').first()).toHaveText('Vexie and the Geargrinders');
    await expect(page.locator('.matrix')).toHaveCount(0);
    await expect(page.locator('.tier-meter-value b')).toHaveText(['0', '0', '0']);
  });

  test('difficulty switch changes the kill counts shown', async ({ page }) => {
    await page.goto(`${ALL}&tab=raids`);
    await page.getByRole('button', { name: 'Heroic', exact: true }).click();
    await expect(page).toHaveURL(/diff=heroic/);
    const cells = page.locator('.matrix tbody tr').first().locator('.matrix-cell');
    await expect(cells.first()).toHaveText('1');   // one heroic Vexie kill
    await expect(cells.nth(1)).toHaveText('—');    // no heroic Cauldron kill recorded
  });
});

test.describe('collections', () => {
  test('loads one character at a time and filters by rarity', async ({ page }) => {
    await page.goto(`${ALL}&tab=collections`);
    await expect(page.locator('.collection-item')).toHaveCount(2);
    await page.getByRole('button', { name: 'Epic' }).click();
    await expect(page.locator('.collection-item')).toHaveCount(1);
    await expect(page.locator('.collection-name')).toHaveText('Anubisath Idol');
  });

  test('switches between pets and mounts', async ({ page }) => {
    await page.goto(`${ALL}&tab=collections`);
    await page.getByRole('button', { name: 'Mounts' }).click();
    await expect(page).toHaveURL(/kind=mounts/);
    await expect(page.locator('.collection-name').first()).toHaveText('Invincible');
  });

  test('a slow index shows loading, never "nothing was published"', async ({ page }) => {
    await page.route('**/collections/deaths-edge/index.json*', async route => {
      await new Promise(r => setTimeout(r, 1200));
      await route.continue();
    });
    await page.goto(`${ALL}&tab=collections`);
    await expect(page.locator('.empty-state')).toContainText('Loading collections');
    await expect(page.locator('.empty-state')).not.toContainText('No collection data');
    await expect(page.locator('.collection-item').first()).toBeVisible();
  });
});

test.describe('navigation', () => {
  test('back and forward restore the previous view', async ({ page }) => {
    await page.goto(ALL);
    await page.getByRole('tab', { name: 'Raids' }).click();
    await expect(page.locator('.tier-head')).toBeVisible();
    await page.goBack();
    await expect(page.locator('.roster-grid')).toBeVisible();
    await page.goForward();
    await expect(page.locator('.tier-head')).toBeVisible();
  });

  test('arrow keys move between tabs', async ({ page }) => {
    await page.goto(ALL);
    await page.getByRole('tab', { name: 'Roster' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Leaderboard' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Leaderboard' })).toBeFocused();
  });

  test('switching guild clears the previous guild data', async ({ page }) => {
    await page.goto(`${ALL}&tab=raids`);
    await page.getByRole('button', { name: 'Riot Act' }).click();
    await expect(page).toHaveURL(/guild=riot-act/);
    await expect(page.locator('#guild-title')).toContainText('Riot');
    // The raid view must reflect the new guild, not the old roster's raiders.
    await expect(page.locator('.matrix tbody tr, .empty-state')).not.toContainText('Decillin');
  });
});

test.describe('degraded data', () => {
  test('a stale snapshot raises the banner and the stale pill', async ({ page }) => {
    // Rewrite publishedAt in flight — the page must react to the data it is
    // actually served, without any build step.
    await page.route('**/data/v2/manifest.json*', async route => {
      const res = await route.fetch();
      const manifest = JSON.parse(await res.text());
      manifest.publishedAt = new Date(Date.now() - 3 * 86400e3).toISOString();
      await route.fulfill({ response: res, body: JSON.stringify(manifest) });
    });
    await page.goto(ALL);
    await expect(page.locator('#freshness')).toHaveClass(/is-stale/);
    await expect(page.locator('#stale-banner')).toBeVisible();
    await expect(page.locator('#stale-banner')).toContainText('3 days old');
  });

  test('an unreachable manifest shows an explicit offline state', async ({ page }) => {
    await page.route('**/data/v2/manifest.json*', route => route.fulfill({ status: 503, body: 'nope' }));
    await page.goto(ALL);
    await expect(page.locator('.empty-state')).toContainText('unavailable');
    await expect(page.locator('#stale-banner')).toBeVisible();
    // Not a dead end: the previous (V1) dashboard may still load.
    await expect(page.getByRole('link', { name: 'Open the previous dashboard' })).toHaveAttribute('href', /\/v1\/$/);
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });
});
