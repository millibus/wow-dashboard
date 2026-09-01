'use strict';
// Builds the snapshot the browser tests run against: the REAL pipeline
// (scripts/build-snapshot.js) driven by the fixture Blizzard API, written to a
// temp dir. Nothing here talks to Blizzard, and no credentials are involved.
//
// Reusing the production builder means the e2e suite exercises the exact file
// shapes the site ships — a schema change that breaks the UI fails here.

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const REPO = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, '.site-data');

async function buildFixtureSite() {
  const { startFixtureApi, startFakeOauth } = require(
    path.join(REPO, 'scripts/test/helpers/fixture-server'));

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const oauth = await startFakeOauth();
  const api = await startFixtureApi();
  try {
    const { code, stderr } = await new Promise(resolve => {
      execFile(process.execPath, [path.join(REPO, 'scripts/build-snapshot.js')], {
        env: {
          ...process.env,
          BLIZZARD_CLIENT_ID: 'fixture-id',
          BLIZZARD_CLIENT_SECRET: 'fixture-secret',
          BLIZZARD_OAUTH_URL: oauth.url,
          BLIZZARD_API_BASE: api.base,
          SNAPSHOT_OUT_DIR: OUT,
          GITHUB_OUTPUT: '',
        },
        timeout: 120000,
      }, (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr }));
    });
    if (code !== 0) throw new Error(`fixture snapshot build failed (${code}): ${stderr}`);
  } finally {
    oauth.server.close();
    api.server.close();
  }
  return OUT;
}

module.exports = { buildFixtureSite, OUT };

if (require.main === module) {
  buildFixtureSite().then(dir => console.log(`fixture snapshot at ${dir}`))
    .catch(err => { console.error(err.message); process.exit(1); });
}
