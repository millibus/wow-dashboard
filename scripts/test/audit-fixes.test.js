'use strict';
// Regression coverage for the post-audit fixes:
// - connected-realm members are fetched on THEIR realm and keyed by it
// - life stats: a present-but-zero statistic is 0, an absent one is null,
//   and a definition matching no character raises LIFE_STAT_UNMATCHED
// - the run log offers statistic ids to backfill for name-matched keys
// - the guild's realm display name reaches both output layers
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { startFixtureApi, startFakeOauth } = require('./helpers/fixture-server');

const SCRIPT = path.join(__dirname, '..', 'build-snapshot.js');
const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'dashboard-config.json');

function runSnapshot(outDir, api, oauth, extraEnv = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT], {
      env: {
        ...process.env,
        BLIZZARD_CLIENT_ID: 'fixture-id',
        BLIZZARD_CLIENT_SECRET: 'fixture-secret',
        BLIZZARD_OAUTH_URL: oauth.url,
        BLIZZARD_API_BASE: api.base,
        SNAPSHOT_OUT_DIR: outDir,
        GITHUB_OUTPUT: '',
        ...extraEnv,
      },
      timeout: 60000,
    }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

const readV2 = (outDir, rel) => JSON.parse(fs.readFileSync(path.join(outDir, 'v2', rel), 'utf8'));

test('connected-realm members are fetched on their own realm and keyed by it', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-realm-'));
  const oauth = await startFakeOauth();
  const api = await startFixtureApi();
  try {
    const r = await runSnapshot(outDir, api, oauth);
    assert.equal(r.code, 0, r.stderr);

    // The profile call went to the member's realm, never the guild's.
    assert.ok(api.hits['/profile/wow/character/thrall/farshore'] >= 1, 'fetched on thrall');
    assert.equal(api.hits['/profile/wow/character/onyxia/farshore'], undefined, 'never looked up on onyxia');

    const roster = readV2(outDir, 'guilds/deaths-edge.json');
    const far = roster.members.find(m => m.name === 'Farshore');
    assert.equal(far.realmSlug, 'thrall');
    assert.equal(far.className, 'Shaman', 'detail belongs to the right character');
    assert.ok(fs.existsSync(path.join(outDir, 'v2', 'characters', 'deaths-edge', 'us-thrall-207690005.json')),
      'character file keyed by the member realm');
    assert.ok(r.stdout.includes('1 member(s) on connected realms'));

    // Realm display name flows from the API into both layers.
    assert.equal(roster.realm, 'Onyxia');
    const legacy = JSON.parse(fs.readFileSync(path.join(outDir, 'guild-deaths-edge.json'), 'utf8'));
    assert.equal(legacy.realm, 'Onyxia');
    assert.equal(legacy.members.find(m => m.name === 'Farshore').realm, 'Thrall');
  } finally {
    oauth.server.close(); api.server.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('life stats: zero is 0, absent is null, and ids are offered for backfill', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-stats-'));
  const oauth = await startFakeOauth();
  const api = await startFixtureApi();
  try {
    const r = await runSnapshot(outDir, api, oauth);
    assert.equal(r.code, 0, r.stderr);

    const roster = readV2(outDir, 'guilds/deaths-edge.json');
    const far = roster.members.find(m => m.name === 'Farshore');
    assert.equal(far.lifeStats.totalDeaths, 0, 'a statistic present with quantity 0 is a real zero');
    assert.equal(far.lifeStats.questsCompleted, 310);
    assert.equal(far.lifeStats.deathsFromFalling, null, 'a statistic absent from the payload is unknown, not 0');
    assert.equal(far.lifeStats.raidsEntered, null, 'composite with no source statistics is unknown');
    assert.equal(far.lifeStats.bossesDefeated, null);

    const dec = roster.members.find(m => m.name === 'Decillin');
    assert.equal(dec.lifeStats.totalDeaths, 123);
    assert.equal(dec.lifeStats.bossesDefeated, 3, 'composite sums when its sources exist');

    // Every configured id is null today, so the run offers the observed ids.
    const m = r.stdout.match(/LIFE_STAT_ID_SUGGESTIONS: .*?(\{.*\})/);
    assert.ok(m, 'id suggestions printed');
    const hints = JSON.parse(m[1]);
    assert.equal(hints.totalDeaths, 60);
    assert.equal(hints.questsCompleted, 98);
    assert.ok(!r.stdout.includes('LIFE_STAT_UNMATCHED: no character had a statistic matching totalDeaths'));
  } finally {
    oauth.server.close(); api.server.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('a life-stat definition that matches no character raises LIFE_STAT_UNMATCHED', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-unmatched-'));
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  cfg.lifeStatDefs = [
    { key: 'totalDeaths', id: null, name: 'Total deaths' },
    // Simulates a Blizzard rename: the configured display name no longer exists.
    { key: 'questsCompleted', id: null, name: 'Quests finished (renamed)' },
  ];
  const cfgPath = path.join(outDir, 'config.json');
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  const oauth = await startFakeOauth();
  const api = await startFixtureApi();
  try {
    const r = await runSnapshot(outDir, api, oauth, { SNAPSHOT_CONFIG_PATH: cfgPath });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /LIFE_STAT_UNMATCHED: no character had a statistic matching questsCompleted/);
    assert.doesNotMatch(r.stdout, /LIFE_STAT_UNMATCHED: [^\n]*totalDeaths/);
    const roster = readV2(outDir, 'guilds/deaths-edge.json');
    for (const m of roster.members) {
      if (m.lifeStats) assert.equal(m.lifeStats.questsCompleted, null, `${m.name}: renamed stat is unknown, never 0`);
    }
  } finally {
    oauth.server.close(); api.server.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
