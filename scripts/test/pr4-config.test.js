'use strict';
// PR4 scenarios: dynamic raid-catalog discovery with cadence + carry-forward,
// tracked-character policy, collections/raids cadence reuse, level-cap drift
// guard, and id-first life-stat matching with a logged name fallback.
//
// Run with: node --test scripts/test/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { startFixtureApi, startFakeOauth } = require('./helpers/fixture-server');
const { validateV2Dir } = require('../validate-snapshot-v2');

const SCRIPT = path.join(__dirname, '..', 'build-snapshot.js');
const REAL_CONFIG = path.join(__dirname, '..', '..', 'config', 'dashboard-config.json');

function makeConfig(dir, mutate) {
  const cfg = JSON.parse(fs.readFileSync(REAL_CONFIG, 'utf8'));
  mutate?.(cfg);
  const p = path.join(dir, 'dashboard-config.json');
  fs.writeFileSync(p, JSON.stringify(cfg));
  return p;
}

function runSnapshot(outDir, api, oauth, extraEnv = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT], {
      env: {
        ...process.env,
        BLIZZARD_CLIENT_ID: 'fixture-id',
        BLIZZARD_CLIENT_SECRET: 'fixture-secret',
        BLIZZARD_OAUTH_URL: oauth.url,
        BLIZZARD_API_BASE: api.base,
        BLIZZARD_RETRY_BASE_MS: '10',
        SNAPSHOT_OUT_DIR: outDir,
        GITHUB_OUTPUT: '',
        ...extraEnv,
      },
      timeout: 60000,
    }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

const readV2 = (outDir, rel) => JSON.parse(fs.readFileSync(path.join(outDir, 'v2', rel), 'utf8'));

test('raid catalog is discovered from the journal API and drives both output layers', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr4-cat-'));
  const oauth = await startFakeOauth();
  const api = await startFixtureApi();
  try {
    const r = await runSnapshot(outDir, api, oauth);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(api.hits['/data/wow/journal-expansion/505'] >= 1, 'journal expansion queried');

    const catalog = readV2(outDir, 'raid-catalog.json');
    assert.equal(catalog.tiers[0].name, 'Liberation of Undermine');
    assert.equal(catalog.tiers[0].short, 'LoU', 'override applied');
    assert.equal(catalog.tiers[0].season, 'TWW S2', 'override applied');
    assert.equal(catalog.tiers[0].bosses.length, 2, 'bosses come from the journal, not hardcoded');

    const manifest = readV2(outDir, 'manifest.json');
    assert.equal(manifest.catalog.status, 'fresh');
    assert.equal(manifest.catalog.tiers, 1);

    const legacy = JSON.parse(fs.readFileSync(path.join(outDir, 'raid-deaths-edge.json'), 'utf8'));
    assert.equal(legacy.tiers[0].name, 'Liberation of Undermine');
    assert.equal(legacy.tiers[0].bosses.length, 2, 'legacy tiers derive from the discovered catalog');
  } finally { oauth.server.close(); api.server.close(); fs.rmSync(outDir, { recursive: true, force: true }); }
});

test('catalog discovery failure carries the previous catalog forward with a warning', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr4-catfail-'));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr4-cfg-'));
  // catalog cadence 0 forces a re-discovery on every run.
  const cfgPath = makeConfig(cfgDir, c => { c.cadencesHours.catalog = 0; });
  try {
    let oauth = await startFakeOauth();
    let api = await startFixtureApi();
    try { assert.equal((await runSnapshot(outDir, api, oauth, { SNAPSHOT_CONFIG_PATH: cfgPath })).code, 0); }
    finally { oauth.server.close(); api.server.close(); }

    oauth = await startFakeOauth();
    api = await startFixtureApi({ overrides: { '/data/wow/journal-expansion/505': { status: 500 } } });
    let r;
    try { r = await runSnapshot(outDir, api, oauth, { SNAPSHOT_CONFIG_PATH: cfgPath }); }
    finally { oauth.server.close(); api.server.close(); }
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.includes('CATALOG_DISCOVERY_FAILED'), `expected warning, got: ${r.stdout}`);
    const catalog = readV2(outDir, 'raid-catalog.json');
    assert.equal(catalog.tiers[0].name, 'Liberation of Undermine', 'previous catalog carried forward');
    assert.equal(readV2(outDir, 'manifest.json').catalog.status, 'carried_forward');
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); fs.rmSync(cfgDir, { recursive: true, force: true }); }
});

test('expensive components are fetched only for tracked characters', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr4-track-'));
  const oauth = await startFakeOauth();
  const api = await startFixtureApi();
  try {
    assert.equal((await runSnapshot(outDir, api, oauth)).code, 0);
    assert.ok(!api.hits['/profile/wow/character/onyxia/arkon/collections/pets'],
      'Arkon is untracked: no collections fetch');
    assert.ok(api.hits['/profile/wow/character/onyxia/grrumpy/collections/pets'] >= 1,
      'Grrumpy is tracked: collections fetched');

    const riot = readV2(outDir, 'guilds/riot-act.json');
    assert.equal(riot.members.find(m => m.name === 'Arkon').components.collections, 'not_tracked');
    assert.equal(riot.members.find(m => m.name === 'Grrumpy').components.collections, 'fresh');
  } finally { oauth.server.close(); api.server.close(); fs.rmSync(outDir, { recursive: true, force: true }); }
});

test('within-cadence collections and raids are reused without refetching, staying fresh', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr4-cadence-'));
  try {
    let oauth = await startFakeOauth();
    let api = await startFixtureApi();
    try { assert.equal((await runSnapshot(outDir, api, oauth)).code, 0); }
    finally { oauth.server.close(); api.server.close(); }

    oauth = await startFakeOauth();
    api = await startFixtureApi();
    let r;
    try { r = await runSnapshot(outDir, api, oauth); }
    finally { oauth.server.close(); api.server.close(); }
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!api.hits['/profile/wow/character/onyxia/decillin/collections/pets'],
      'collections within 24h cadence must not be refetched');
    assert.ok(!api.hits['/profile/wow/character/onyxia/decillin/encounters/raids'],
      'raids within 4h cadence must not be refetched');
    assert.ok(api.hits['/profile/wow/character/onyxia/decillin'] >= 1,
      'profile/details are hourly and always refetched');

    assert.deepEqual(validateV2Dir(path.join(outDir, 'v2')), []);
    const manifest = readV2(outDir, 'manifest.json');
    assert.equal(manifest.overallStatus, 'ok', 'cadence reuse is not degradation');
    assert.ok(manifest.guilds['deaths-edge'].counts.reusedWithinCadence >= 1);
    const roster = readV2(outDir, 'guilds/deaths-edge.json');
    assert.equal(roster.members.find(m => m.name === 'Decillin').components.collections, 'fresh');
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
});

test('a character removed from tracking drops to not_tracked instead of carrying stale data forever', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr4-untrack-'));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr4-untrackcfg-'));
  const tracked = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'tracked-characters.json'), 'utf8'));
  tracked.characters = tracked.characters.filter(c => c.name !== 'Decillin');
  const trackedPath = path.join(cfgDir, 'tracked-characters.json');
  fs.writeFileSync(trackedPath, JSON.stringify(tracked));
  try {
    let oauth = await startFakeOauth();
    let api = await startFixtureApi();
    try { assert.equal((await runSnapshot(outDir, api, oauth)).code, 0); }
    finally { oauth.server.close(); api.server.close(); }

    oauth = await startFakeOauth();
    api = await startFixtureApi();
    let r;
    try { r = await runSnapshot(outDir, api, oauth, { SNAPSHOT_TRACKED_PATH: trackedPath }); }
    finally { oauth.server.close(); api.server.close(); }
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(validateV2Dir(path.join(outDir, 'v2')), []);

    const roster = readV2(outDir, 'guilds/deaths-edge.json');
    const decillin = roster.members.find(m => m.name === 'Decillin');
    assert.equal(decillin.components.collections, 'not_tracked', 'untracked member must not carry stale collections');
    assert.equal(decillin.components.raids, 'not_tracked');
    assert.ok(!fs.existsSync(path.join(outDir, 'v2', 'collections/deaths-edge', 'us-onyxia-207690001.json')),
      'stale collection file must not be republished');
    const manifest = readV2(outDir, 'manifest.json');
    assert.equal(manifest.guilds['deaths-edge'].counts.carriedForward, 0,
      'deliberate exclusion is not carry-forward degradation');
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); fs.rmSync(cfgDir, { recursive: true, force: true }); }
});

test('journal payloads listing raids under `instances` are also accepted', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr4-shape-'));
  const oauth = await startFakeOauth();
  const api = await startFixtureApi({
    mutate: fixtures => {
      const exp = fixtures['/data/wow/journal-expansion/505'];
      exp.instances = exp.raids;
      delete exp.raids;
    },
  });
  try {
    const r = await runSnapshot(outDir, api, oauth);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!r.stdout.includes('CATALOG_DISCOVERY_FAILED'), `discovery must succeed on the alternate shape: ${r.stdout}`);
    assert.equal(readV2(outDir, 'raid-catalog.json').tiers[0].name, 'Liberation of Undermine');
  } finally { oauth.server.close(); api.server.close(); fs.rmSync(outDir, { recursive: true, force: true }); }
});

test('the configured region threads through to identities and the manifest', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr4-region-'));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr4-regioncfg-'));
  const cfgPath = makeConfig(cfgDir, c => { c.region = 'eu'; });
  const oauth = await startFakeOauth();
  const api = await startFixtureApi();
  try {
    const r = await runSnapshot(outDir, api, oauth, { SNAPSHOT_CONFIG_PATH: cfgPath });
    assert.equal(r.code, 0, r.stderr);
    const manifest = readV2(outDir, 'manifest.json');
    assert.equal(manifest.region, 'eu');
    assert.ok(fs.existsSync(path.join(outDir, 'v2', 'characters/deaths-edge', 'eu-onyxia-207690001.json')),
      'identity keys carry the configured region');
    assert.deepEqual(validateV2Dir(path.join(outDir, 'v2')), []);
  } finally { oauth.server.close(); api.server.close(); fs.rmSync(outDir, { recursive: true, force: true }); fs.rmSync(cfgDir, { recursive: true, force: true }); }
});

test('level-cap drift produces a loud warning in output and manifest', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr4-drift-'));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr4-driftcfg-'));
  const cfgPath = makeConfig(cfgDir, c => { c.levelCap = 80; }); // fixtures have level-90s
  const oauth = await startFakeOauth();
  const api = await startFixtureApi();
  try {
    const r = await runSnapshot(outDir, api, oauth, { SNAPSHOT_CONFIG_PATH: cfgPath });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.includes('LEVEL_CAP_DRIFT'), `expected drift warning, got: ${r.stdout}`);
    assert.ok(readV2(outDir, 'manifest.json').warnings.some(w => w.includes('LEVEL_CAP_DRIFT')));
  } finally { oauth.server.close(); api.server.close(); fs.rmSync(outDir, { recursive: true, force: true }); fs.rmSync(cfgDir, { recursive: true, force: true }); }
});

test('life stats match by id first; a wrong id falls back to name with a logged warning', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr4-stats-'));
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr4-statscfg-'));
  // Fixture 'Total deaths' has id 60; configure a wrong id to force the fallback.
  const cfgPath = makeConfig(cfgDir, c => {
    c.lifeStatDefs.find(d => d.key === 'totalDeaths').id = 4242;
    c.lifeStatDefs.find(d => d.key === 'questsCompleted').id = 98; // correct id → id match
  });
  const oauth = await startFakeOauth();
  const api = await startFixtureApi();
  try {
    const r = await runSnapshot(outDir, api, oauth, { SNAPSHOT_CONFIG_PATH: cfgPath });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stdout.includes('LIFE_STAT_NAME_FALLBACK') && r.stdout.includes('totalDeaths'),
      `expected fallback warning naming totalDeaths, got: ${r.stdout}`);
    assert.ok(!/LIFE_STAT_NAME_FALLBACK.*questsCompleted/.test(r.stdout), 'id-matched keys are not flagged');
    const key = 'us-onyxia-207690001';
    const char = readV2(outDir, `characters/deaths-edge/${key}.json`);
    assert.equal(char.detail.lifeStats.totalDeaths, 123, 'value still resolved via name fallback');
    assert.equal(char.detail.lifeStats.questsCompleted, 2500, 'value resolved via id');
  } finally { oauth.server.close(); api.server.close(); fs.rmSync(outDir, { recursive: true, force: true }); fs.rmSync(cfgDir, { recursive: true, force: true }); }
});
