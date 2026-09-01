'use strict';
// PR5 scenarios: canonical serialization and churn elimination — unchanged
// data must produce byte-identical files (stable hashes, no git diffs) across
// runs, in both output layers, while real changes still propagate.
//
// Run with: node --test scripts/test/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const { startFixtureApi, startFakeOauth } = require('./helpers/fixture-server');
const { canonicalStringify, contentEquals } = require('../lib/canonical');

const SCRIPT = path.join(__dirname, '..', 'build-snapshot.js');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

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

test('canonicalStringify is key-order independent; contentEquals ignores volatile timestamps', () => {
  assert.equal(canonicalStringify({ b: 1, a: { d: 2, c: [3] } }), canonicalStringify({ a: { c: [3], d: 2 }, b: 1 }));
  assert.ok(contentEquals(
    { name: 'X', updatedAt: '2026-01-01T00:00:00Z', lastUpdated: 'a', sourceUpdatedAt: 'b' },
    { name: 'X', updatedAt: '2026-02-02T00:00:00Z', lastUpdated: 'c', sourceUpdatedAt: 'd' },
  ));
  assert.ok(!contentEquals({ name: 'X', level: 90 }, { name: 'X', level: 91 }));
});

test('an unchanged second run produces byte-identical data files in both layers', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr5-stable-'));
  const files = [
    'v2/guilds/deaths-edge.json',
    'v2/characters/deaths-edge/us-onyxia-207690001.json',
    'v2/collections/deaths-edge/index.json',
    'v2/raid-catalog.json',
    'guild-deaths-edge.json',
    'raid-deaths-edge.json',
    'collections-deaths-edge.json',
  ];
  try {
    let oauth = await startFakeOauth();
    let api = await startFixtureApi();
    try { assert.equal((await runSnapshot(outDir, api, oauth)).code, 0); }
    finally { oauth.server.close(); api.server.close(); }
    const before = Object.fromEntries(files.map(f => [f, sha(path.join(outDir, f))]));
    const genBefore = fs.readFileSync(path.join(outDir, 'generated-at.json'), 'utf8');

    await new Promise(r => setTimeout(r, 1100)); // ensure a different wall-clock second
    oauth = await startFakeOauth();
    api = await startFixtureApi();
    let r;
    try { r = await runSnapshot(outDir, api, oauth); }
    finally { oauth.server.close(); api.server.close(); }
    assert.equal(r.code, 0, r.stderr);

    for (const f of files) {
      assert.equal(sha(path.join(outDir, f)), before[f], `${f} must be byte-identical when nothing changed`);
    }
    assert.notEqual(fs.readFileSync(path.join(outDir, 'generated-at.json'), 'utf8'), genBefore,
      'generated-at.json is the freshness signal and always updates');
    assert.ok(r.stdout.includes('unchanged — not rewritten'), 'legacy writes are skipped when unchanged');

    // The manifest's per-file hashes must match the reused bytes exactly, and
    // sourceUpdatedAt must not advance when the roster data did not change.
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'v2/manifest.json'), 'utf8'));
    assert.equal(manifest.files['guilds/deaths-edge.json'].sha256, before['v2/guilds/deaths-edge.json']);
    const roster = JSON.parse(fs.readFileSync(path.join(outDir, 'v2/guilds/deaths-edge.json'), 'utf8'));
    assert.equal(manifest.guilds['deaths-edge'].sourceUpdatedAt, roster.updatedAt,
      'manifest sourceUpdatedAt must reflect the staged (reused) roster, not the current run');
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
});

test('a real data change still produces new bytes and a new hash', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr5-change-'));
  const charFile = 'v2/characters/deaths-edge/us-onyxia-207690001.json';
  try {
    let oauth = await startFakeOauth();
    let api = await startFixtureApi();
    try { assert.equal((await runSnapshot(outDir, api, oauth)).code, 0); }
    finally { oauth.server.close(); api.server.close(); }
    const before = sha(path.join(outDir, charFile));

    oauth = await startFakeOauth();
    api = await startFixtureApi({
      mutate: fixtures => { fixtures['/profile/wow/character/onyxia/decillin'].equipped_item_level = 215; },
    });
    try { assert.equal((await runSnapshot(outDir, api, oauth)).code, 0); }
    finally { oauth.server.close(); api.server.close(); }

    assert.notEqual(sha(path.join(outDir, charFile)), before, 'changed data must produce a new file');
    const char = JSON.parse(fs.readFileSync(path.join(outDir, charFile), 'utf8'));
    assert.equal(char.detail.averageIlvl, 215);
    const legacy = JSON.parse(fs.readFileSync(path.join(outDir, 'guild-deaths-edge.json'), 'utf8'));
    assert.equal(legacy.members.find(m => m.name === 'Decillin').averageIlvl, 215, 'legacy layer sees the change too');
  } finally { fs.rmSync(outDir, { recursive: true, force: true }); }
});
