'use strict';
// Accessibility scans. Playwright alone asserts nothing about a11y — the axe
// engine does the work, so every view (and the modal) is scanned against WCAG
// 2.1 A/AA. A regression here fails CI like any other bug.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BASE = '/v2/?guild=deaths-edge&scope=all';

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
  ['readiness', `${BASE}&tab=readiness`, '.readiness-grid'],
  ['leaderboard', `${BASE}&tab=leaderboard`, '.lb-table'],
  ['raids', `${BASE}&tab=raids`, '.matrix'],
  ['collections', `${BASE}&tab=collections`, '.collection-grid'],
]) {
  test(`${name} view has no detectable WCAG A/AA violations`, async ({ page }) => {
    await page.goto(url);
    await page.waitForSelector(ready);
    const results = await scan(page);
    expect(describeViolations(results)).toBe('');
  });
}

test('the character dialog has no detectable WCAG A/AA violations', async ({ page }) => {
  await page.goto(BASE);
  await page.locator('.char-card', { hasText: 'Decillin' }).click();
  await page.waitForSelector('#detail-dialog[open] .gear-table');
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
