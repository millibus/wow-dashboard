#!/usr/bin/env node
'use strict';
// Data-independent verification of a fixture file: serve it as the Blizzard
// API, run the real pipeline against it, and validate BOTH output layers
// with the schema validators. Nothing here asserts specific characters or
// values, so it works for the synthetic fixtures and for a fresh capture of
// real responses alike.
//
//   node scripts/verify-fixtures.js [path/to/fixtures.json]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { startFixtureApi, startFakeOauth, DEFAULT_FIXTURES } = require('./test/helpers/fixture-server');
const { validateDir } = require('./validate-snapshot');
const { validateV2Dir } = require('./validate-snapshot-v2');

async function main() {
  const fixturesPath = path.resolve(process.argv[2] || DEFAULT_FIXTURES);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-fixtures-'));
  const oauth = await startFakeOauth();
  const api = await startFixtureApi({ fixturesPath });
  try {
    const run = await new Promise(resolve => {
      execFile(process.execPath, [path.join(__dirname, 'build-snapshot.js')], {
        env: {
          ...process.env,
          BLIZZARD_CLIENT_ID: 'fixture-id',
          BLIZZARD_CLIENT_SECRET: 'fixture-secret',
          BLIZZARD_OAUTH_URL: oauth.url,
          BLIZZARD_API_BASE: api.base,
          SNAPSHOT_OUT_DIR: outDir,
          GITHUB_OUTPUT: '',
        },
        timeout: 120000,
      }, (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr }));
    });
    process.stdout.write(run.stdout);
    if (run.code !== 0) {
      console.error(run.stderr);
      console.error(`verify-fixtures: pipeline exited ${run.code}`);
      process.exit(1);
    }
    const problems = [...validateDir(outDir), ...validateV2Dir(path.join(outDir, 'v2'))];
    if (problems.length) {
      console.error(`verify-fixtures: ${problems.length} validation problem(s):`);
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'v2', 'manifest.json'), 'utf8'));
    const guilds = Object.entries(manifest.guilds).map(([slug, g]) => `${slug}=${g.status}`).join(', ');
    console.log(`verify-fixtures: OK — ${fixturesPath} builds a valid snapshot (${manifest.overallStatus}; ${guilds})`);
  } finally {
    oauth.server.close();
    api.server.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

main().catch(err => { console.error(`verify-fixtures: ${err.message}`); process.exit(1); });
