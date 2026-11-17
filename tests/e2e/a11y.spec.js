'use strict';
// Accessibility scans. Playwright alone asserts nothing about a11y — the axe
// engine does the work, so every view (and both dialogs, and the Forever
// state) is scanned against WCAG 2.1 A/AA. A regression here fails CI like
// any other bug.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { stubRenders } = require('./helpers');

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BASE = '/?guild=deaths-edge&scope=all';

// Renders are answered locally so the stage is scanned with its figures and
// captions in place, not in its empty fallback.
test.beforeEach(async ({ page }) => { await stubRenders(page); });

async function scan(page) {
  return new AxeBuilder({ page }).withTags(TAGS).analyze();
}

function describeViolations(results) {
  return results.violations
    .map(v => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.map(n => n.target.join(' ')).join('\n    ')}`)
    .join('\n');
}

for (const [name, url, ready] of [
  ['roster', BASE, '.roster-grid'],
  ['roster with the filter drawer open', `${BASE}&classes=Death+Knight`, '#filter-panel:not([hidden])'],
  ['leaderboard', `${BASE}&tab=leaderboard`, '.lb-table'],
  ['raids', `${BASE}&tab=raids`, '.matrix'],
  ['collections', `${BASE}&tab=collections`, '.collection-grid'],
  ['Forever (coming soon)', '/?game=forever', '.forever'],
]) {
  test(`${name} view has no detectable WCAG A/AA violations`, async ({ page }) => {
    await page.goto(url);
    await page.waitForSelector(ready);
    const results = await scan(page);
    expect(describeViolations(results)).toBe('');
  });
}

test('the roster with the stage populated has no detectable WCAG A/AA violations', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForSelector('.fig.is-loaded');
  await page.waitForSelector('#stage-captions .cap');
  const results = await scan(page);
  expect(describeViolations(results)).toBe('');
});

test('the character sheet has no detectable WCAG A/AA violations', async ({ page }) => {
  await page.goto(BASE);
  await page.locator('.char-card', { hasText: 'Decillin' }).click();
  await page.waitForSelector('#detail-dialog[open] .gear-table');
  const results = await scan(page);
  expect(describeViolations(results)).toBe('');
});

test('the compare dialog has no detectable WCAG A/AA violations', async ({ page }) => {
  await page.goto(`${BASE}&compare=us-onyxia-207690001,us-onyxia-207690003`);
  await page.waitForSelector('#compare-dialog[open] .compare-table tbody tr');
  const results = await scan(page);
  expect(describeViolations(results)).toBe('');
});

test('the raid view with no kills has no detectable WCAG A/AA violations', async ({ page }) => {
  await page.route('**/data/v2/raids/deaths-edge.json*', async route => {
    const res = await route.fetch();
    const data = JSON.parse(await res.text());
    for (const m of data.members) m.tiers = [];
    await route.fulfill({ response: res, body: JSON.stringify(data) });
  });
  await page.goto(`${BASE}&tab=raids`);
  await page.waitForSelector('.unopened .boss-list');
  const results = await scan(page);
  expect(describeViolations(results)).toBe('');
});

test('the stale banner state has no detectable WCAG A/AA violations', async ({ page }) => {
  await page.route('**/data/v2/manifest.json*', async route => {
    const res = await route.fetch();
    const manifest = JSON.parse(await res.text());
    manifest.publishedAt = new Date(Date.now() - 9 * 86400e3).toISOString(); // alert level
    await route.fulfill({ response: res, body: JSON.stringify(manifest) });
  });
  await page.goto(BASE);
  await page.waitForSelector('#stale-banner:not([hidden])');
  const results = await scan(page);
  expect(describeViolations(results)).toBe('');
});

test('keyboard users can reach the roster past the skip link', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForSelector('.roster-grid');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main/);
});
