'use strict';
// The redesign's own guarantees: the Retail / Forever game switch, the
// Forever coming-soon state, the retired readiness feature, the stage, the
// honest-data rules, keyboard focus across re-renders, and no sideways
// scroll at phone, tablet and desktop widths.

const { test, expect } = require('@playwright/test');
const { stubRenders, blockFonts, overflowsSideways } = require('./helpers');

const ALL = '/?guild=deaths-edge&scope=all';

test.beforeEach(async ({ page }) => {
  await blockFonts(page);
  await stubRenders(page);
});

test.describe('game switch', () => {
  test('Retail is the default and Forever is one press away', async ({ page }) => {
    await page.goto(ALL);
    const retail = page.getByRole('button', { name: 'Retail', exact: true });
    const forever = page.getByRole('button', { name: 'Forever', exact: true });
    await expect(page.locator('html')).toHaveAttribute('data-game', 'retail');
    await expect(retail).toHaveAttribute('aria-pressed', 'true');
    await expect(forever).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.char-card')).toHaveCount(4);

    await forever.click();
    await expect(page).toHaveURL(/[?&]game=forever/);
    await expect(page.locator('html')).toHaveAttribute('data-game', 'forever');
    await expect(forever).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: 'Coming soon' })).toBeVisible();
    await expect(page.locator('.char-card')).toHaveCount(0);

    await retail.click();
    await expect(page).not.toHaveURL(/game=/);
    await expect(page.locator('html')).toHaveAttribute('data-game', 'retail');
    await expect(page.locator('.char-card')).toHaveCount(4);
  });

  test('?game=forever and ?game=retail are deep links', async ({ page }) => {
    await page.goto('/?game=forever');
    await expect(page.locator('html')).toHaveAttribute('data-game', 'forever');
    await expect(page.getByRole('heading', { name: 'Coming soon' })).toBeVisible();
    await expect(page).toHaveTitle(/Forever/);

    await page.goto('/?game=retail&guild=riot-act');
    await expect(page.locator('html')).toHaveAttribute('data-game', 'retail');
    await expect(page.locator('#guild-title')).toHaveText('Riot Act');
    await expect(page.locator('.char-card').first()).toBeVisible();
  });

  test('the game is set before first paint, so a Forever link never flashes Retail', async ({ page }) => {
    // Hold the module script: only the inline head script has run.
    let release;
    const gate = new Promise(r => { release = r; });
    await page.route('**/js/main.js', async route => { await gate; await route.continue(); });
    await page.goto('/?game=forever', { waitUntil: 'commit' });
    await expect(page.locator('html')).toHaveAttribute('data-game', 'forever');
    release();
    await expect(page.getByRole('heading', { name: 'Coming soon' })).toBeVisible();
  });

  test('Back and Forward move between the games', async ({ page }) => {
    await page.goto(ALL);
    await page.getByRole('button', { name: 'Forever', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-game', 'forever');
    await page.goBack();
    await expect(page.locator('html')).toHaveAttribute('data-game', 'retail');
    await expect(page.locator('.char-card')).toHaveCount(4);
    await page.goForward();
    await expect(page.locator('html')).toHaveAttribute('data-game', 'forever');
    await expect(page.getByRole('heading', { name: 'Coming soon' })).toBeVisible();
  });

  test('switching to Forever and back keeps the guild and the view', async ({ page }) => {
    await page.goto('/?guild=riot-act&tab=leaderboard&metric=quests');
    await page.getByRole('button', { name: 'Forever', exact: true }).click();
    await expect(page).toHaveURL(/game=forever/);
    await expect(page).toHaveURL(/guild=riot-act/);
    await page.getByRole('button', { name: 'Back to Retail' }).click();
    await expect(page.locator('#guild-title')).toHaveText('Riot Act');
    await expect(page.getByRole('tab', { name: 'Leaderboard' })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/metric=quests/);
  });
});

test.describe('Forever (coming soon)', () => {
  test('is a designed state with no characters, no sample data and no dates', async ({ page }) => {
    await page.goto('/?game=forever&guild=deaths-edge');
    await expect(page.locator('#stage')).toHaveClass(/is-forever/);
    await expect(page.locator('#guild-title')).toHaveText('Forever');
    await expect(page.locator('#view')).toContainText('There is no Forever guild so far');
    // Nothing from the Retail roster leaks in, and nothing is invented.
    const text = await page.locator('body').innerText();
    for (const name of ['Decillin', 'Revän', 'Farshore', "Kel'thar"]) expect(text).not.toContain(name);
    expect(text).not.toMatch(/sample/i);
    expect(text).not.toMatch(/\b20\d\d\b/);
    expect(text).not.toMatch(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i);
    await expect(page.locator('.fig, .char-card, .lb-table, .matrix')).toHaveCount(0);
  });

  test('hides the Retail-only chrome: tabs, guild switch, freshness, toolbar', async ({ page }) => {
    await page.goto('/?game=forever');
    await expect(page.getByRole('heading', { name: 'Coming soon' })).toBeVisible();
    await expect(page.locator('#tabs')).toBeHidden();
    await expect(page.locator('#bottom-nav')).toBeHidden();
    await expect(page.locator('#guild-switcher')).toBeHidden();
    await expect(page.locator('#freshness')).toBeHidden();
    await expect(page.locator('#refresh')).toBeHidden();
    await expect(page.locator('#search')).toBeHidden();
    await expect(page.locator('#stale-banner')).toBeHidden();
  });

  test('loads none of the character art', async ({ page }) => {
    const renders = [];
    page.on('request', req => { if (/render\.worldofwarcraft\.com/.test(req.url())) renders.push(req.url()); });
    await page.goto('/?game=forever');
    await expect(page.getByRole('heading', { name: 'Coming soon' })).toBeVisible();
    await page.waitForTimeout(400);
    expect(renders).toEqual([]);
  });

  test('still renders when the Retail snapshot is unreachable', async ({ page }) => {
    await page.route('**/data/v2/manifest.json*', route => route.fulfill({ status: 503, body: 'nope' }));
    await page.goto('/?game=forever');
    await expect(page.getByRole('heading', { name: 'Coming soon' })).toBeVisible();
    await expect(page.locator('#stale-banner')).toBeHidden();
  });

  test('a sheet deep link does not open over the coming-soon page', async ({ page }) => {
    await page.goto('/?game=forever&guild=deaths-edge&char=us-onyxia-207690001');
    await expect(page.getByRole('heading', { name: 'Coming soon' })).toBeVisible();
    await expect(page.locator('#detail-dialog')).not.toHaveAttribute('open', '');
  });
});

test.describe('readiness is retired', () => {
  test('old readiness links land on the roster, not on an error', async ({ page }) => {
    await page.goto('/?guild=deaths-edge&tab=readiness&risk=risk');
    await expect(page.getByRole('tab', { name: 'Roster' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.char-card')).toHaveCount(4);
    await expect(page.locator('.empty-state')).toHaveCount(0);
    // The address bar stops advertising the retired view.
    await expect(page).not.toHaveURL(/readiness|risk=/);
    await expect(page).toHaveURL(/guild=deaths-edge/);
  });

  test('there is no readiness tab, score or verdict anywhere', async ({ page }) => {
    await page.goto(ALL);
    await expect(page.getByRole('tab')).toHaveText(['Roster', 'Leaderboard', 'Raids', 'Collections']);
    const banned = /readiness|raid-ready|at risk|\bwatch\b|\bscore\b/i;
    for (const tab of ['Roster', 'Leaderboard', 'Raids', 'Collections']) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.locator('#view')).not.toContainText('Loading');
      expect(await page.locator('body').innerText()).not.toMatch(banned);
    }
    await page.getByRole('tab', { name: 'Roster' }).click();
    await page.locator('.char-card', { hasText: 'Decillin' }).click();
    await page.waitForSelector('#detail-dialog[open] .gear-table');
    expect(await page.locator('#detail-dialog').innerText()).not.toMatch(banned);
    expect(await page.evaluate(() => document.querySelectorAll('[class*="risk"], [class*="readiness"]').length)).toBe(0);
  });

  test('the readiness module is gone', async ({ page }) => {
    const res = await page.request.get('/js/views/readiness.js');
    expect(res.status()).toBe(404);
  });
});

test.describe('the stage', () => {
  test('lines the guild up by level, then item level, and captions the front row', async ({ page }) => {
    await page.goto(ALL);
    await expect(page.locator('#stage')).toHaveClass(/is-full/);
    await expect(page.locator('.fig.is-loaded')).toHaveCount(4);
    // Front row, left to right, filled from the centre outwards: the highest
    // level (Decillin, 90) and the next (Farshore, 85) take the middle.
    await expect(page.locator('#stage-captions .cap-name')).toHaveText(['Revän', 'Decillin', 'Farshore', "Kel'thar"]);
    // Item level is only quoted at the level cap.
    await expect(page.locator('#stage-captions .cap', { hasText: 'Decillin' }).locator('.cap-sub')).toHaveText('Level 90 · ilvl 209');
    await expect(page.locator('#stage-captions .cap', { hasText: 'Farshore' }).locator('.cap-sub')).toHaveText('Level 85');
    await expect(page.locator('.stage-legend')).toContainText('highest level, then item level');
  });

  test('every figure is a labelled button that opens the sheet, with explicit image dimensions', async ({ page }) => {
    await page.goto(ALL);
    const fig = page.getByRole('button', { name: /^Decillin, level 90/ });
    await expect(fig).toBeVisible();
    const img = fig.locator('img');
    await expect(img).toHaveAttribute('width', '1600');
    await expect(img).toHaveAttribute('height', '1200');
    await expect(img).toHaveAttribute('decoding', 'async');
    await expect(img).toHaveAttribute('alt', '');
    await fig.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#detail-dialog')).toHaveAttribute('open', '');
    await expect(page.locator('.detail-title')).toHaveText('Decillin');
    await page.keyboard.press('Escape');
    await expect(fig).toBeFocused();
  });

  test('a render that fails to load is dropped, and the stage closes the gap', async ({ page }) => {
    await page.unroute(/^https:\/\/render\.worldofwarcraft\.com\//);
    await stubRenders(page, { fail: /207690001-main-raw/ });
    await page.goto(ALL);
    await expect(page.locator('.fig.is-loaded')).toHaveCount(3);
    await expect(page.locator('.fig')).toHaveCount(3);
    await expect(page.locator('#stage-captions')).not.toContainText('Decillin');
    // The roster row is unaffected: the stage is not the only way in.
    await expect(page.locator('.char-card', { hasText: 'Decillin' })).toBeVisible();
  });

  test('with no renders at all the stage is the name alone, and the roster still lists everyone', async ({ page }) => {
    await page.unroute(/^https:\/\/render\.worldofwarcraft\.com\//);
    await stubRenders(page, { fail: /./ });
    await page.goto(ALL);
    await expect(page.locator('#stage')).toHaveClass(/is-bare/);
    await expect(page.locator('.fig')).toHaveCount(0);
    await expect(page.locator('#stage-captions')).toBeHidden();
    await expect(page.locator('#guild-title')).toBeVisible();
    await expect(page.locator('.char-card')).toHaveCount(4);
    // Avatars fall back to initials rather than broken images.
    await expect(page.locator('.char-card .arch.is-empty').first()).toHaveText('D');
  });

  test('the other views get a slim masthead with no figures', async ({ page }) => {
    await page.goto(`${ALL}&tab=leaderboard`);
    await expect(page.locator('#stage')).toHaveClass(/is-slim/);
    await expect(page.locator('.fig')).toHaveCount(0);
    await expect(page.locator('#guild-title')).toHaveText("Death's Edge");
    const stage = await page.locator('#stage').boundingBox();
    expect(stage.height).toBeLessThan(200);
  });

  test('caps how many full renders load, and loads fewer on a phone', async ({ page }) => {
    // A 40-member guild where everyone has a render.
    await page.route('**/data/v2/guilds/deaths-edge.json*', async route => {
      const res = await route.fetch();
      const roster = JSON.parse(await res.text());
      const seed = roster.members[0];
      roster.members = Array.from({ length: 40 }, (_, i) => ({
        ...seed, id: 300000000 + i, name: `Member${i}`, level: 90 - (i % 30), ilvl: 200 - i,
        avatarUrl: `https://render.worldofwarcraft.com/us/character/onyxia/0/${300000000 + i}-avatar.jpg`,
      }));
      await route.fulfill({ response: res, body: JSON.stringify(roster) });
    });
    const count = async () => {
      const urls = new Set();
      const onRequest = req => { if (/main-raw\.png/.test(req.url())) urls.add(req.url()); };
      page.on('request', onRequest);
      await page.goto(ALL);
      await expect(page.locator('.fig.is-loaded').first()).toBeVisible();
      await page.waitForTimeout(300);
      page.off('request', onRequest);
      return urls.size;
    };
    await page.setViewportSize({ width: 1440, height: 900 });
    const desktop = await count();
    await page.setViewportSize({ width: 390, height: 844 });
    const phone = await count();
    expect(desktop).toBeLessThanOrEqual(11);
    expect(phone).toBeLessThanOrEqual(5);
    expect(phone).toBeLessThan(desktop);
  });
});

test.describe('honest data', () => {
  test('owner ids are never shown; alts are grouped quietly on the sheet', async ({ page }) => {
    // Give Decillin's owner a second character so the grouping is visible.
    await page.route('**/data/v2/guilds/deaths-edge.json*', async route => {
      const res = await route.fetch();
      const roster = JSON.parse(await res.text());
      for (const m of roster.members) if (m.name === 'Farshore') m.owner = 'user1';
      await route.fulfill({ response: res, body: JSON.stringify(roster) });
    });
    await page.goto(ALL);
    await expect(page.locator('.char-card')).toHaveCount(4);
    expect(await page.locator('body').innerText()).not.toMatch(/user\d/i);
    await page.getByRole('button', { name: 'Class, race, level' }).click();
    // No labels in the manifest: no player filter is offered at all.
    await expect(page.locator('#filter-panel')).not.toContainText('Player');

    await page.locator('.char-card', { hasText: 'Decillin' }).click();
    await page.waitForSelector('#detail-dialog[open] .gear-table');
    const dialog = page.locator('#detail-dialog');
    await expect(dialog).toContainText('Same player, other characters');
    expect(await dialog.innerText()).not.toMatch(/user\d/i);
    // Stepping to the alt keeps the sheet open, and closing still returns
    // focus to the row the reader started from.
    await dialog.getByRole('button', { name: /Farshore/ }).click();
    await expect(page.locator('.detail-title')).toHaveText('Farshore');
    await expect(page).toHaveURL(/char=us-thrall-207690005/);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toHaveAttribute('open', '');
  });

  test('manifest owner labels are used when they exist', async ({ page }) => {
    await page.route('**/data/v2/manifest.json*', async route => {
      const res = await route.fetch();
      const manifest = JSON.parse(await res.text());
      manifest.config.owners = [{ id: 'user1', label: 'Aldous' }, { id: 'user3', label: 'Berit' }];
      await route.fulfill({ response: res, body: JSON.stringify(manifest) });
    });
    await page.goto(ALL);
    await page.getByRole('button', { name: 'Class, race, level' }).click();
    await page.getByRole('button', { name: 'Berit', exact: true }).click();
    await expect(page.locator('.char-name')).toHaveText(['Revän']);
    expect(await page.locator('body').innerText()).not.toMatch(/user\d/i);
  });

  test('a member the armory has nothing for is listed with dashes, and gets a sheet that says so', async ({ page }) => {
    let characterFetches = 0;
    await page.route('**/data/v2/characters/deaths-edge/us-onyxia-999.json*', route => { characterFetches += 1; return route.fulfill({ status: 404, body: '' }); });
    await page.route('**/data/v2/guilds/deaths-edge.json*', async route => {
      const res = await route.fetch();
      const roster = JSON.parse(await res.text());
      roster.members.push({
        id: 999, name: 'Nobodyhome', level: 32, rank: 5, region: 'us', realmSlug: 'onyxia',
        className: null, spec: null, race: null, ilvl: null, lastLogin: null, avatarUrl: null, owner: null,
        achievementPoints: null, equipmentSummary: null, lifeStats: null, faction: null,
        stats: { crit: null, haste: null, mastery: null, vers: null },
        components: { profile: 'unavailable', details: 'unavailable', equipment: 'unavailable', media: 'unavailable', statistics: 'unavailable', achievements: 'unavailable', raids: 'not_tracked', collections: 'not_tracked' },
      });
      await route.fulfill({ response: res, body: JSON.stringify(roster) });
    });
    await page.goto(ALL);
    const row = page.locator('.char-card', { hasText: 'Nobodyhome' });
    await expect(row).toContainText('No armory profile');
    await expect(row.locator('.fig-level b')).toHaveText('32');
    await expect(row.locator('.fig-ilvl b')).toHaveText('—');
    await expect(row.locator('.arch.is-empty')).toHaveText('N');
    // Listed last: lowest level.
    await expect(page.locator('.char-name').last()).toHaveText('Nobodyhome');

    await row.click();
    const dialog = page.locator('#detail-dialog');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(dialog).toContainText('The armory has no profile for Nobodyhome');
    await expect(dialog.locator('.detail-ilvl b')).toHaveText('—');
    await expect(dialog).not.toContainText('could not be loaded');
    await expect(dialog.locator('.gear-table')).toHaveCount(0);
    expect(characterFetches).toBe(0); // nothing to fetch, so nothing fetched
    expect(await dialog.innerText()).not.toMatch(/\b0\b/);
  });

  test('a guild with nobody at the level cap gets an explanation, not an item-level ladder', async ({ page }) => {
    await page.route('**/data/v2/guilds/deaths-edge.json*', async route => {
      const res = await route.fetch();
      const roster = JSON.parse(await res.text());
      for (const m of roster.members) if (m.level === 90) m.level = 88;
      await route.fulfill({ response: res, body: JSON.stringify(roster) });
    });
    await page.goto(`${ALL}&tab=leaderboard`);
    await expect(page.locator('.empty-state')).toContainText('Nobody is level 90 yet');
    await expect(page.locator('.lb-table')).toHaveCount(0);
    await page.getByRole('button', { name: 'See achievement points instead' }).click();
    await expect(page).toHaveURL(/metric=achievements/);
    await expect(page.locator('.lb-table tbody tr').first()).toBeVisible();
    // The roster's lead sentence says the same thing in words.
    await page.getByRole('tab', { name: 'Roster' }).click();
    await expect(page.locator('#stats')).toContainText('Highest level so far: 88 of 90');
  });

  test('roster portraits are lazy, async-decoded and sized', async ({ page }) => {
    await page.goto(ALL);
    const imgs = page.locator('.roster-grid .arch img');
    await expect(imgs).toHaveCount(4);
    for (const img of await imgs.all()) {
      await expect(img).toHaveAttribute('loading', 'lazy');
      await expect(img).toHaveAttribute('decoding', 'async');
      await expect(img).toHaveAttribute('width', /\d+/);
      await expect(img).toHaveAttribute('height', /\d+/);
    }
  });
});

test.describe('keyboard focus survives a re-render', () => {
  test('filter controls keep focus after they change the list', async ({ page }) => {
    await page.goto(ALL);
    const drawer = page.getByRole('button', { name: 'Class, race, level' });
    await drawer.focus();
    await page.keyboard.press('Enter');
    await expect(drawer).toBeFocused();
    await expect(drawer).toHaveAttribute('aria-expanded', 'true');

    const pill = page.getByRole('button', { name: 'Death Knight', exact: true });
    await pill.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.char-card')).toHaveCount(1);
    await expect(pill).toBeFocused();
    await expect(pill).toHaveAttribute('aria-pressed', 'true');

    const scope = page.getByRole('button', { name: /^Away longer/ });
    await scope.focus();
    await page.keyboard.press('Enter');
    await expect(scope).toBeFocused();
  });

  test('tabs, the guild switch and view filters keep focus', async ({ page }) => {
    await page.goto(ALL);
    const tab = page.getByRole('tab', { name: 'Leaderboard' });
    await tab.click();
    await expect(tab).toBeFocused();
    const metric = page.getByRole('button', { name: 'Quests', exact: true });
    await metric.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/metric=quests/);
    await expect(metric).toBeFocused();

    const guild = page.getByRole('button', { name: 'Riot Act', exact: true });
    await guild.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#guild-title')).toHaveText('Riot Act');
    await expect(guild).toBeFocused();
  });

  test('a compare pick keeps focus on the row that was picked', async ({ page }) => {
    await page.goto(`${ALL}&compare=`);
    const row = page.locator('.char-card', { hasText: 'Decillin' });
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    await expect(row).toBeFocused();
  });

  test('when the focused control disappears, focus lands on the view, not the top of the page', async ({ page }) => {
    await page.goto(`${ALL}&q=zzzz`);
    const clear = page.getByRole('button', { name: 'Clear filters' });
    await clear.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.char-card')).toHaveCount(4);
    await expect(page.locator('#view')).toBeFocused();
  });

  test('every interactive control shows a focus ring', async ({ page }) => {
    await page.goto(ALL);
    await expect(page.locator('.char-card').first()).toBeVisible();
    for (const locator of [
      page.getByRole('button', { name: 'Forever', exact: true }),
      page.getByRole('button', { name: 'Riot Act', exact: true }),
      page.getByRole('tab', { name: 'Roster' }),
      page.getByRole('button', { name: /^Everyone/ }),
      page.locator('.char-card').first(),
      page.locator('.fig').first(),
    ]) {
      await locator.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab'); // arrive by keyboard so :focus-visible applies
      const ring = await locator.evaluate(node => {
        const s = getComputedStyle(node);
        return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
      });
      expect(ring.style).not.toBe('none');
      expect(ring.width).toBeGreaterThanOrEqual(2);
    }
  });
});

test.describe('layout', () => {
  const ROUTES = [
    ['roster', ALL, '.roster-grid'],
    ['roster with filters open', `${ALL}&classes=Death+Knight`, '#filter-panel:not([hidden])'],
    ['leaderboard', `${ALL}&tab=leaderboard&metric=quests`, '.lb-table'],
    ['raids', `${ALL}&tab=raids`, '.matrix'],
    ['collections', `${ALL}&tab=collections`, '.collection-grid'],
    ['character sheet', `${ALL}&char=us-onyxia-207690001`, '#detail-dialog[open] .gear-table'],
    ['compare', `${ALL}&compare=us-onyxia-207690001,us-onyxia-207690003`, '#compare-dialog[open] tbody tr'],
    ['Forever', '/?game=forever', '.forever'],
  ];
  // 390 is a phone, 820 a tablet (the old site overflowed between 770 and
  // 920), 1440 a laptop. 769 and 900 sit just past the layout breakpoints.
  for (const [width, height] of [[390, 844], [769, 1024], [820, 1180], [900, 800], [1440, 900]]) {
    test(`nothing scrolls sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      for (const [name, url, ready] of ROUTES) {
        await page.goto(url);
        await page.waitForSelector(ready);
        expect(await overflowsSideways(page), `${name} at ${width}px`).toBe(false);
      }
    });
  }

  test('nothing scrolls sideways with a long roster and long names', async ({ page }) => {
    await page.route('**/data/v2/guilds/deaths-edge.json*', async route => {
      const res = await route.fetch();
      const roster = JSON.parse(await res.text());
      const seed = roster.members[0];
      roster.members = Array.from({ length: 48 }, (_, i) => ({
        ...seed, id: 400000000 + i, name: i % 3 ? `Member${i}` : `Wwwwwwwwwwww${i}`,
        race: 'Highmountain Tauren', spec: 'Beast Mastery', level: 90 - (i % 40), ilvl: 300 + i,
      }));
      await route.fulfill({ response: res, body: JSON.stringify(roster) });
    });
    // Fonts are blocked in this file, so this also covers the fallback faces.
    for (const width of [320, 360, 390, 820, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(ALL);
      await expect(page.locator('.char-card')).toHaveCount(48);
      expect(await overflowsSideways(page), `${width}px`).toBe(false);
    }
  });

  test('on a 390x844 phone the first roster row is on screen without scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?guild=deaths-edge');
    await expect(page.locator('.fig.is-loaded').first()).toBeVisible();
    const row = await page.locator('.char-card').first().boundingBox();
    const nav = await page.locator('#bottom-nav').boundingBox();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // The whole first row sits above the bottom navigation.
    expect(row.y + row.height).toBeLessThanOrEqual(nav.y);
    // And the stage is still a stage: at least a third of the screen.
    const stage = await page.locator('#stage').boundingBox();
    expect(stage.height).toBeGreaterThanOrEqual(280);
  });

  test('the front row stands across the seam between the stage and the page', async ({ page }) => {
    await page.goto(ALL);
    await expect(page.locator('.fig.is-loaded')).toHaveCount(4);
    const stage = await page.locator('#stage').boundingBox();
    const fig = await page.locator('.fig.fig-r0').first().boundingBox();
    const seam = stage.y + stage.height;
    expect(fig.y).toBeLessThan(seam);
    expect(fig.y + fig.height).toBeGreaterThan(seam);
    // The captions sit on the page, directly under the seam.
    const caps = await page.locator('#stage-captions').boundingBox();
    expect(caps.y).toBeGreaterThanOrEqual(seam - 1);
  });
});

// Regressions found by the independent pre-release QA pass.
test.describe('pre-release QA fixes', () => {
  test('a game picked while the manifest is still loading is kept', async ({ page }) => {
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route('**/data/v2/manifest.json*', async route => { await held; await route.continue(); });
    await page.goto(ALL);
    await page.getByRole('button', { name: 'Forever', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-game', 'forever');
    release();
    // Boot has finished once the refresh button is enabled.
    await expect(page.locator('#refresh')).toBeEnabled();
    await expect(page.locator('html')).toHaveAttribute('data-game', 'forever');
    await expect(page).toHaveURL(/[?&]game=forever/);
    await expect(page.getByRole('heading', { name: 'Coming soon' })).toBeVisible();
  });

  test('item level only breaks ties between characters at the level cap', async ({ page }) => {
    await page.goto(ALL);
    await expect(page.locator('.char-card').first()).toBeVisible();
    const out = await page.evaluate(async () => {
      const { levelOrder } = await import('/js/views/roster.js');
      const m = (name, level, ilvl, lastLogin) => ({ name, level, ilvl, lastLogin });
      const names = (list, manifest) => list.sort(levelOrder(manifest)).map(x => x.name);
      const cap90 = { config: { levelCap: 90 } };
      return {
        belowCap: names([m('Geared', 80, 500, 1), m('Recent', 80, 100, 2)], cap90),
        atCap: names([m('Weak', 90, 100, 2), m('Strong', 90, 200, 1)], cap90),
        unknownCap: names([m('Recent', 90, 100, 2), m('Geared', 90, 200, 1)], { config: {} }),
      };
    });
    expect(out.belowCap).toEqual(['Recent', 'Geared']);
    expect(out.atCap).toEqual(['Strong', 'Weak']);
    expect(out.unknownCap).toEqual(['Recent', 'Geared']);
  });

  test('capped characters with unknown gear are not reported as nobody at the cap', async ({ page }) => {
    await page.route('**/data/v2/guilds/deaths-edge.json*', async route => {
      const roster = await (await route.fetch()).json();
      for (const m of roster.members) {
        if (m.level === 90) { m.ilvl = null; m.components = { ...m.components, equipment: 'unavailable' }; }
      }
      await route.fulfill({ json: roster });
    });
    await page.goto(`${ALL}&tab=leaderboard`);
    const empty = page.locator('.empty-state');
    await expect(empty).toContainText('Item levels are unknown right now');
    await expect(empty).toContainText('at level 90');
    await expect(empty).not.toContainText('Nobody is level 90');
  });

  test('a collection file with no pets list says unknown, never zero', async ({ page }) => {
    await page.route('**/data/v2/collections/deaths-edge/us-*.json*', async route => {
      const file = await (await route.fetch()).json();
      delete file.pets;
      await route.fulfill({ json: file });
    });
    await page.goto(`${ALL}&tab=collections`);
    await expect(page.locator('#view .empty-state')).toContainText('are not in this snapshot');
    await expect(page.locator('#view')).not.toContainText(/\b0\s*pets\b/i);
  });

  test('a slow first roster response cannot overwrite a newer snapshot', async ({ page }) => {
    // Hold the first roster request, let a refresh swap in a newer snapshot,
    // then release the old response: the newer roster must stay on screen.
    let releaseOld;
    const heldOld = new Promise(resolve => { releaseOld = resolve; });
    let rosterCalls = 0;
    let newer = false;
    await page.route('**/data/v2/manifest.json*', async route => {
      const manifest = await (await route.fetch()).json();
      if (newer) {
        manifest.snapshotId = `${manifest.snapshotId}-newer`;
        // No hash for the roster, so the app refetches it without a buster.
        delete manifest.files['guilds/deaths-edge.json'];
      }
      await route.fulfill({ json: manifest });
    });
    await page.route('**/data/v2/guilds/deaths-edge.json*', async route => {
      const call = ++rosterCalls;
      const roster = await (await route.fetch()).json();
      if (call === 1) { await heldOld; await route.fulfill({ json: roster }); return; }
      roster.members[0].name = 'Newername';
      await route.fulfill({ json: roster });
    });
    await page.goto(ALL);
    await expect(page.locator('#refresh')).toBeEnabled();
    newer = true;
    await page.locator('#refresh').click();
    await expect(page.locator('.char-card', { hasText: 'Newername' })).toBeVisible();
    releaseOld();
    await page.waitForTimeout(400);
    await expect(page.locator('.char-card', { hasText: 'Newername' })).toBeVisible();
  });

  test('an open character sheet follows a refresh to the newer snapshot', async ({ page }) => {
    let newer = false;
    await page.route('**/data/v2/manifest.json*', async route => {
      const manifest = await (await route.fetch()).json();
      if (newer) {
        manifest.snapshotId = `${manifest.snapshotId}-newer`;
        for (const rel of Object.keys(manifest.files)) {
          if (rel.startsWith('characters/deaths-edge/') || rel === 'guilds/deaths-edge.json') delete manifest.files[rel];
        }
      }
      await route.fulfill({ json: manifest });
    });
    await page.route('**/data/v2/characters/deaths-edge/*.json*', async route => {
      const file = await (await route.fetch()).json();
      if (newer && file.detail) file.detail.averageIlvl = 999;
      await route.fulfill({ json: file });
    });
    await page.goto(ALL);
    await page.locator('.char-card', { hasText: 'Decillin' }).click();
    const sheet = page.locator('#detail-dialog');
    await expect(sheet.locator('.detail-ilvl')).toContainText('209');
    newer = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(sheet.locator('.detail-ilvl')).toContainText('999');
    await expect(sheet).toBeVisible();
  });
});
