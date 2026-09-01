'use strict';
// End-to-end proof that the snapshot pipeline's error paths cannot leak
// credentials: runs the real scripts/build-snapshot.js as a child process
// against local fake Blizzard endpoints, with sentinel credentials, and
// asserts neither the raw sentinels nor any Base64 form reach stdout/stderr.
//
// Run with: node --test scripts/test/
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'build-snapshot.js');
const SENTINEL_ID = 'sentinel-client-id-1234567890';
const SENTINEL_SECRET = 'sentinel-secret-abcdefghijklmnop';
const LEAK_FORMS = [
  SENTINEL_SECRET,
  SENTINEL_ID,
  Buffer.from(`${SENTINEL_ID}:${SENTINEL_SECRET}`).toString('base64'),
  Buffer.from(SENTINEL_SECRET).toString('base64'),
  Buffer.from(SENTINEL_ID).toString('base64'),
];

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function runSnapshot(env) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [SCRIPT],
      {
        env: {
          ...process.env,
          BLIZZARD_CLIENT_ID: SENTINEL_ID,
          BLIZZARD_CLIENT_SECRET: SENTINEL_SECRET,
          GITHUB_OUTPUT: '',
          ...env,
        },
        timeout: 30000,
      },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }),
    );
  });
}

function assertNoLeaks(output) {
  for (const leak of LEAK_FORMS) {
    assert.ok(!output.includes(leak), `pipeline output leaked a credential form: ${leak.slice(0, 8)}…`);
  }
  assert.ok(!/authorization/i.test(output), 'pipeline output mentioned an Authorization header');
  assert.ok(!output.includes('Bearer '), 'pipeline output leaked a bearer token');
}

test('OAuth 401 exits 1 with compact AUTH_BAD_CREDENTIALS and no credential leak', async () => {
  const oauth = await startServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized', error_description: 'Bad credentials' }));
  });
  try {
    const { code, stdout, stderr } = await runSnapshot({
      BLIZZARD_OAUTH_URL: `http://127.0.0.1:${oauth.address().port}/token`,
    });
    const output = stdout + stderr;
    assert.equal(code, 1, 'must exit non-zero');
    assert.ok(stderr.includes('AUTH_BAD_CREDENTIALS'), `stderr should carry the compact code, got: ${stderr}`);
    assert.ok(!stdout.includes('wrote '), 'no data files may be written on auth failure');
    assertNoLeaks(output);
  } finally {
    oauth.close();
  }
});

test('API failure after successful OAuth logs a safe classified error and no credential leak', async () => {
  const oauth = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ access_token: `tok-${SENTINEL_SECRET}`, expires_in: 3600 }));
  });
  const api = await startServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: `boom ${SENTINEL_SECRET}` }));
  });
  try {
    const { code, stdout, stderr } = await runSnapshot({
      BLIZZARD_OAUTH_URL: `http://127.0.0.1:${oauth.address().port}/token`,
      BLIZZARD_API_BASE: `http://127.0.0.1:${api.address().port}`,
    });
    const output = stdout + stderr;
    assert.equal(code, 1, 'must exit non-zero');
    assert.ok(stderr.includes('HTTP_500'), `stderr should classify the failure, got: ${stderr}`);
    assert.ok(stderr.includes('/roster'), 'stderr should carry the pathname');
    assert.ok(!output.includes(`tok-${SENTINEL_SECRET}`), 'access token must never be logged');
    assertNoLeaks(output);
  } finally {
    oauth.close();
    api.close();
  }
});
