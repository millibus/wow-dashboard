'use strict';
// Scenario tests for the transactional V2 snapshot layer: fresh builds,
// component-level carry-forward, whole-guild carry-forward on roster failure,
// sanity guards + override, roster removal, orphan-free publishes, and
// distrust of a corrupt previous snapshot. Each scenario runs the REAL
// build-snapshot.js as a child process against the fixture API.
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
const DECILLIN = 'us-onyxia-207690001';

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

function readV2(outDir, rel) {
  return JSON.parse(fs.readFileSync(path.join(outDir, 'v2', rel), 'utf8'));
}

async function freshRun(outDir) {
  const oauth = await startFakeOauth();
  const api = await startFixtureApi();
  try {
    const r = await runSnapshot(outDir, api, oauth);
    assert.equal(r.code, 0, `fresh run must succeed: ${r.stderr}`);
    return r;
  } finally { oauth.server.close(); api.server.close(); }
}

test('fresh run publishes a valid V2 snapshot with stable-identity files', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-fresh-'));
  try {
    await freshRun(outDir);
    assert.deepEqual(validateV2Dir(path.join(outDir, 'v2')), []);

    const manifest = readV2(outDir, 'manifest.json');
    assert.equal(manifest.overallStatus, 'ok');
    assert.equal(manifest.guilds['deaths-edge'].status, 'fresh');

    // The manifest carries the config projection the V2 frontend renders from
    // — the UI must never hardcode these.
    assert.ok(manifest.config, 'manifest.config projection present');
    assert.equal(typeof manifest.config.levelCap, 'number');
    assert.equal(typeof manifest.config.archiveThresholdDays, 'number');
    assert.deepEqual(manifest.config.guilds.map(g => g.slug).sort(), ['deaths-edge', 'riot-act']);
    assert.ok(Array.isArray(manifest.config.owners));
    // Readiness thresholds are config, never frontend constants — the scoring
    // view reads them from here.
    for (const key of ['minLevel', 'ilvlFloor', 'ilvlTarget', 'readyScore', 'watchScore']) {
      assert.equal(typeof manifest.config.readiness[key], 'number', `readiness.${key} projected`);
    }

    const roster = readV2(outDir, 'guilds/deaths-edge.json');
    const decillin = roster.members.find(m => m.name === 'Decillin');
    assert.equal(decillin.id, 207690001);
    assert.equal(decillin.owner, 'user1', 'owner resolved from config/tracked-characters.json');
    assert.equal(decillin.components.details, 'fresh');

    const char = readV2(outDir, `characters/deaths-edge/${DECILLIN}.json`);
    assert.ok(char.detail.equipment.length >= 3);
    assert.equal(char.detail.averageIlvl, 209, 'equipped_item_level is authoritative (no shirt averaging)');

    const idx = readV2(outDir, 'collections/deaths-edge/index.json');
    assert.equal(idx.characters[DECILLIN].mounts.total, 2);
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
});

test('equipment outage carries the component forward instead of publishing empty gear', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-carry-'));
  try {
    await freshRun(outDir);
    const oauth = await startFakeOauth();
    const api = await startFixtureApi({
      overrides: { '/profile/wow/character/onyxia/decillin/equipment': { status: 500 } },
    });
    try {
      const r = await runSnapshot(outDir, api, oauth);
      assert.equal(r.code, 0, `degraded run still publishes: ${r.stderr}`);
    } finally { oauth.server.close(); api.server.close(); }

    assert.deepEqual(validateV2Dir(path.join(outDir, 'v2')), []);
    const manifest = readV2(outDir, 'manifest.json');
    assert.equal(manifest.overallStatus, 'degraded');
    assert.ok(manifest.guilds['deaths-edge'].counts.carriedForward >= 1);

    const char = readV2(outDir, `characters/deaths-edge/${DECILLIN}.json`);
    assert.ok(char.detail.equipment.length >= 3, 'previous equipment carried forward, never emptied');

    // Legacy layer benefits too: Decillin keeps non-empty equipment.
    const legacy = JSON.parse(fs.readFileSync(path.join(outDir, 'guild-deaths-edge.json'), 'utf8'));
    const legacyDecillin = legacy.members.find(m => m.name === 'Decillin');
    assert.ok(legacyDecillin.equipment.length >= 3, 'the Viral bug class is dead in legacy output too');
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
});

test('roster failure carries the whole guild forward while the other guild stays fresh', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-roster-'));
  try {
    await freshRun(outDir);
    const before = readV2(outDir, 'guilds/deaths-edge.json');

    const oauth = await startFakeOauth();
    const api = await startFixtureApi({
      overrides: { '/data/wow/guild/onyxia/deaths-edge/roster': { status: 500 } },
    });
    try {
      const r = await runSnapshot(outDir, api, oauth);
      assert.equal(r.code, 0, `degraded run still publishes: ${r.stderr}`);
    } finally { oauth.server.close(); api.server.close(); }

    assert.deepEqual(validateV2Dir(path.join(outDir, 'v2')), []);
    const manifest = readV2(outDir, 'manifest.json');
    assert.equal(manifest.guilds['deaths-edge'].status, 'carried_forward');
    assert.equal(manifest.guilds['riot-act'].status, 'fresh');
    const after = readV2(outDir, 'guilds/deaths-edge.json');
    assert.deepEqual(after.members.map(m => m.id).sort(), before.members.map(m => m.id).sort());
    assert.ok(fs.existsSync(path.join(outDir, 'v2', 'characters/deaths-edge', `${DECILLIN}.json`)));
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
});

test('shrunken roster trips the sanity guard; the override accepts it but never skips validation', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-shrink-'));
  const shrink = fixtures => {
    fixtures['/data/wow/guild/onyxia/deaths-edge/roster'] = {
      ...fixtures['/data/wow/guild/onyxia/deaths-edge/roster'],
      members: fixtures['/data/wow/guild/onyxia/deaths-edge/roster'].members.slice(0, 1),
    };
  };
  try {
    await freshRun(outDir);

    // Without override: guard trips, previous roster carried forward.
    let oauth = await startFakeOauth();
    let api = await startFixtureApi({ mutate: shrink });
    try { await runSnapshot(outDir, api, oauth); }
    finally { oauth.server.close(); api.server.close(); }
    let manifest = readV2(outDir, 'manifest.json');
    assert.equal(manifest.guilds['deaths-edge'].status, 'carried_forward');
    assert.ok(manifest.guilds['deaths-edge'].errors.some(e => e.includes('SANITY_')),
      `expected a sanity-guard error, got: ${manifest.guilds['deaths-edge'].errors}`);
    assert.equal(readV2(outDir, 'guilds/deaths-edge.json').members.length, 4);

    // With override: the 1-member roster is accepted and validated.
    oauth = await startFakeOauth();
    api = await startFixtureApi({ mutate: shrink });
    try { await runSnapshot(outDir, api, oauth, { SNAPSHOT_SANITY_OVERRIDE: '1' }); }
    finally { oauth.server.close(); api.server.close(); }
    assert.deepEqual(validateV2Dir(path.join(outDir, 'v2')), []);
    assert.equal(readV2(outDir, 'guilds/deaths-edge.json').members.length, 1);
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
});

test('a member removed from the roster is removed, and no orphan files survive', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-removed-'));
  try {
    await freshRun(outDir);
    const kelKey = "us-onyxia-207690002";
    assert.ok(fs.existsSync(path.join(outDir, 'v2', 'characters/deaths-edge', `${kelKey}.json`)));

    const oauth = await startFakeOauth();
    const api = await startFixtureApi({
      mutate: fixtures => {
        const roster = fixtures['/data/wow/guild/onyxia/deaths-edge/roster'];
        roster.members = roster.members.filter(m => m.character.name !== "Kel'thar");
      },
    });
    try { await runSnapshot(outDir, api, oauth, { SNAPSHOT_SANITY_OVERRIDE: '1' }); }
    finally { oauth.server.close(); api.server.close(); }

    assert.deepEqual(validateV2Dir(path.join(outDir, 'v2')), []);
    const roster = readV2(outDir, 'guilds/deaths-edge.json');
    assert.ok(!roster.members.some(m => m.name === "Kel'thar"), 'fresh roster is authoritative for membership');
    assert.ok(!fs.existsSync(path.join(outDir, 'v2', 'characters/deaths-edge', `${kelKey}.json`)),
      'removed member leaves no orphan character file');
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
});

test('an unavailable piece with no previous data publishes null, never fabricated empties', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-null-'));
  const oauth = await startFakeOauth();
  const api = await startFixtureApi({
    overrides: { '/profile/wow/character/onyxia/decillin/equipment': { status: 500 } },
  });
  try {
    const r = await runSnapshot(outDir, api, oauth); // first run: no previous snapshot exists
    assert.equal(r.code, 0, `degraded first run still publishes: ${r.stderr}`);
    assert.deepEqual(validateV2Dir(path.join(outDir, 'v2')), []);

    const char = readV2(outDir, `characters/deaths-edge/${DECILLIN}.json`);
    assert.equal(char.detail.equipment, null, 'unfilled unavailable piece must be null, not []');
    assert.equal(char.components.equipment, 'unavailable');
    assert.equal(char.components.profile, 'fresh');

    const roster = readV2(outDir, 'guilds/deaths-edge.json');
    const decillin = roster.members.find(m => m.name === 'Decillin');
    assert.equal(decillin.components.equipment, 'unavailable');
    assert.equal(decillin.equipmentSummary, null, 'no gear summary fabricated from nothing');
  } finally {
    oauth.server.close(); api.server.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('a previously-unavailable guild does not poison carry-forward for the others', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-unavail-'));
  try {
    // Run 1: riot-act roster down with NO previous snapshot → published as unavailable.
    let oauth = await startFakeOauth();
    let api = await startFixtureApi({
      overrides: { '/data/wow/guild/onyxia/riot-act/roster': { status: 500 } },
    });
    try {
      const r1 = await runSnapshot(outDir, api, oauth);
      assert.equal(r1.code, 0, `degraded run publishes: ${r1.stderr}`);
    } finally { oauth.server.close(); api.server.close(); }
    assert.equal(readV2(outDir, 'manifest.json').guilds['riot-act'].status, 'unavailable');
    assert.deepEqual(validateV2Dir(path.join(outDir, 'v2')), []);

    // Run 2: everything healthy — the previous snapshot must still be trusted.
    oauth = await startFakeOauth();
    api = await startFixtureApi();
    let r2;
    try { r2 = await runSnapshot(outDir, api, oauth); }
    finally { oauth.server.close(); api.server.close(); }
    assert.equal(r2.code, 0);
    assert.ok(!r2.stdout.includes('No valid previous V2 snapshot'),
      'one unavailable guild must not invalidate the whole previous snapshot');
    const manifest = readV2(outDir, 'manifest.json');
    assert.equal(manifest.guilds['deaths-edge'].status, 'fresh');
    assert.equal(manifest.guilds['riot-act'].status, 'fresh');
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
});

test('a corrupt previous snapshot is distrusted, and a fresh build still succeeds', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-corrupt-'));
  try {
    await freshRun(outDir);
    fs.writeFileSync(path.join(outDir, 'v2', 'manifest.json'), '{ not json');

    const oauth = await startFakeOauth();
    const api = await startFixtureApi();
    let r;
    try { r = await runSnapshot(outDir, api, oauth); }
    finally { oauth.server.close(); api.server.close(); }
    assert.equal(r.code, 0, `fresh rebuild must succeed: ${r.stderr}`);
    assert.ok(r.stdout.includes('No valid previous V2 snapshot'), 'corrupt prev must be distrusted');
    assert.deepEqual(validateV2Dir(path.join(outDir, 'v2')), []);
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
});
