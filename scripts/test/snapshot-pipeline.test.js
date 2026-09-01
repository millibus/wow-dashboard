'use strict';
// End-to-end: run the real build-snapshot.js against the synthetic fixture API,
// writing into a temp dir, then validate the output with the real validator.
// Exercises URL-encoded character names (apostrophe, non-ASCII), the level
// filter, raid tier matching, and the validation gate.
//
// Run with: node --test scripts/test/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { startFixtureApi, startFakeOauth } = require('./helpers/fixture-server');
const { validateDir } = require('../validate-snapshot');

const SCRIPT = path.join(__dirname, '..', 'build-snapshot.js');

function runSnapshot(env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT], { env: { ...process.env, ...env }, timeout: 60000 },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

test('full pipeline against fixtures produces a valid snapshot', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-snap-'));
  const oauth = await startFakeOauth();
  const api = await startFixtureApi();
  try {
    const { code, stdout, stderr } = await runSnapshot({
      BLIZZARD_CLIENT_ID: 'fixture-id',
      BLIZZARD_CLIENT_SECRET: 'fixture-secret',
      BLIZZARD_OAUTH_URL: oauth.url,
      BLIZZARD_API_BASE: api.base,
      SNAPSHOT_OUT_DIR: outDir,
      GITHUB_OUTPUT: '',
    });
    assert.equal(code, 0, `pipeline should succeed, stderr: ${stderr}`);
    assert.ok(stdout.includes('OAuth preflight: ok'));

    const problems = validateDir(outDir);
    assert.deepEqual(problems, [], `validator found problems: ${problems.join('; ')}`);

    const guild = JSON.parse(fs.readFileSync(path.join(outDir, 'guild-deaths-edge.json'), 'utf8'));
    const names = guild.members.map(m => m.name).sort();
    assert.deepEqual(names, ['Decillin', "Kel'thar", 'Revän'], 'level<10 members filtered, encoded names fetched');
    const decillin = guild.members.find(m => m.name === 'Decillin');
    assert.ok(decillin.equipment.length >= 3, 'equipment populated');
    assert.equal(decillin.lifeStats.totalDeaths, 123, 'achievement stats mapped');

    const raid = JSON.parse(fs.readFileSync(path.join(outDir, 'raid-deaths-edge.json'), 'utf8'));
    const withKills = raid.members.filter(m => m.tiers.length > 0);
    assert.ok(withKills.length >= 1, 'raid tiers must not be empty when kills exist');
    const vexie = withKills[0].tiers[0].bosses.find(b => b.short === 'Vexie');
    assert.equal(vexie.kills.normal, 4);
    assert.equal(vexie.kills.heroic, 1);

    const riot = JSON.parse(fs.readFileSync(path.join(outDir, 'guild-riot-act.json'), 'utf8'));
    assert.equal(riot.members.length, 2, 'second guild also built');

    const collections = JSON.parse(fs.readFileSync(path.join(outDir, 'collections-deaths-edge.json'), 'utf8'));
    assert.ok(collections.Decillin.mounts.total === 2);
  } finally {
    oauth.server.close();
    api.server.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('validator rejects an empty or credential-tainted snapshot', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-bad-'));
  try {
    fs.writeFileSync(path.join(dir, 'generated-at.json'), JSON.stringify({ ts: 'not-a-date' }));
    fs.writeFileSync(path.join(dir, 'guild-deaths-edge.json'),
      JSON.stringify({ guild: "Death's Edge", realm: 'Onyxia', members: [], lastUpdated: new Date().toISOString() }));
    fs.writeFileSync(path.join(dir, 'raid-deaths-edge.json'),
      JSON.stringify({ tiers: [], members: [], note: 'Authorization: Basic abc' }));
    const problems = validateDir(dir);
    assert.ok(problems.some(p => p.includes('ts must be')), 'bad timestamp caught');
    assert.ok(problems.some(p => p.includes('non-empty array')), 'empty roster caught');
    assert.ok(problems.some(p => p.includes('forbidden string')), 'credential-shaped string caught');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
