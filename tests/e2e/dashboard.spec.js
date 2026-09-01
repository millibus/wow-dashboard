'use strict';
// Functional browser coverage for the V2 dashboard, against a snapshot built
// by the real pipeline from fixtures.
//
// Fixture roster (deaths-edge): Decillin (user1, 90, ilvl 209), Revän (user3,
// 80, ilvl 95), Kel'thar (UNOWNED — must never appear), plus a level-5 member
// the pipeline filters out entirely. Logins are old, so `scope=all` is the
// default entry point for roster assertions.

const { test, expect } = require('@playwright/test');

const ALL = '/v2/?guild=deaths-edge&scope=all';

test.describe('roster', () => {
  test('shows owned characters only, sorted by item level', async ({ page }) => {
    await page.goto(ALL);
    await expect(page.locator('.char-card')).toHaveCount(2);
    const names = await page.locator('.char-name').allTextContents();
    expect(names).toEqual(['Decillin', 'Revän']);
    // The guild roster contains Kel'thar, but no owner maps to them.
    expect(names).not.toContain("Kel'thar");
  });

  test('active scope hides characters past the archive threshold', async ({ page }) => {
    await page.goto('/v2/?guild=deaths-edge');
    await expect(page.locator('.empty-state')).toContainText('No characters match');
  });

  test('search and class filters narrow the grid', async ({ page }) => {
    await page.goto(ALL);
    await page.fill('#search', 'warlock');
    await expect(page.locator('.char-card')).toHaveCount(1);
    await expect(page.locator('.char-name')).toHaveText('Revän');
    await page.fill('#search', '');
    await page.getByRole('button', { name: 'Death Knight', exact: true }).click();
    await expect(page.locator('.char-name')).toHaveText('Decillin');
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

test.describe('readiness', () => {
  test('scores from config thresholds and lists concrete actions', async ({ page }) => {
    await page.goto(`${ALL}&tab=readiness`);
    await expect(page.locator('.readiness-card')).toHaveCount(2);
    const card = page.locator('.readiness-card', { hasText: 'Decillin' });
    // ilvl 209 is far below the configured 610 target, so it must not read "ready".
    await expect(card).toHaveClass(/risk-risk/);
    await expect(card.locator('.readiness-actions')).toContainText('610');
  });

  test('status filter narrows the grid', async ({ page }) => {
    await page.goto(`${ALL}&tab=readiness`);
    await page.getByRole('button', { name: /^At risk \(/ }).click();
    await expect(page.locator('.readiness-card')).toHaveCount(2);
    await expect(page).toHaveURL(/risk=risk/);
  });
});

test.describe('leaderboard', () => {
  test('ranks by item level and switches metric', async ({ page }) => {
    await page.goto(`${ALL}&tab=leaderboard`);
    const firstRow = page.locator('.lb-table tbody tr').first();
    await expect(firstRow).toContainText('Decillin');
    await expect(firstRow.locator('.num')).toHaveText('209');

    await page.getByRole('button', { name: 'Deaths', exact: true }).click();
    await expect(page).toHaveURL(/metric=deaths/);
    await expect(page.locator('.lb-table tbody tr').first()).toContainText('123');
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
    await expect(page.locator('.tier-title h2')).toHaveText('Liberation of Undermine');
    // Two encounters discovered via the journal API in the fixtures.
    await expect(page.locator('.matrix thead th')).toHaveCount(3); // corner + 2 bosses
    await expect(page.locator('.matrix tbody tr')).toHaveCount(2);
    const vexieCell = page.locator('.matrix tbody tr').first().locator('.matrix-cell').first();
    await expect(vexieCell).toHaveText('4');
    await expect(vexieCell).toHaveClass(/is-killed/);
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
    await expect(page.getByRole('tab', { name: 'Readiness' })).toHaveAttribute('aria-selected', 'true');
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
  });
});
