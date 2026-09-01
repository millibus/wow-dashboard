'use strict';
// Transport-policy tests for scripts/lib/blizzard.js, run against local HTTP
// servers. Each test runs the client in a CHILD process so env-based config
// (fast retries, small limits) and module state (token cache, metrics) are
// isolated per test.
//
// Covers: auth-token 401 vs resource 401, timeout, 429 Retry-After (seconds
// and HTTP-date), retry exhaustion, max global concurrency, token-refresh
// locking.
//
// Run with: node --test scripts/test/
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { execFile } = require('node:child_process');
const path = require('node:path');

const LIB = path.join(__dirname, '..', 'lib', 'blizzard.js');

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Run a snippet in a child process with the client preloaded as `blizzard`.
function runClient(code, env) {
  const script = `
    const blizzard = require(${JSON.stringify(LIB)});
    (async () => { ${code} })().then(
      (out) => { console.log('RESULT:' + JSON.stringify(out ?? null)); },
      (err) => { console.log('ERR:' + JSON.stringify({ code: err.safeCode || err.code, status: err.response && err.response.status, message: String(err.message).slice(0, 80) })); process.exitCode = 1; },
    );
  `;
  return new Promise((resolve) => {
    execFile(process.execPath, ['-e', script], {
      env: {
        ...process.env,
        BLIZZARD_CLIENT_ID: 'test-id',
        BLIZZARD_CLIENT_SECRET: 'test-secret',
        BLIZZARD_RETRY_BASE_MS: '20',
        BLIZZARD_TIMEOUT_MS: '500',
        BLIZZARD_DEADLINE_MS: '10000',
        ...env,
      },
      timeout: 30000,
    }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
  });
}

function okJson(res, body) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const TOKEN_OK = { access_token: 'tok-1', expires_in: 3600 };

test('token-endpoint 401 is fatal AUTH_BAD_CREDENTIALS with no retries', async () => {
  let tokenRequests = 0;
  const oauth = await listen((req, res) => {
    tokenRequests += 1;
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
  });
  try {
    const { stdout } = await runClient('await blizzard.getToken();', {
      BLIZZARD_OAUTH_URL: `http://127.0.0.1:${oauth.address().port}/token`,
    });
    assert.ok(stdout.includes('"code":"AUTH_BAD_CREDENTIALS"'), `got: ${stdout}`);
    assert.equal(tokenRequests, 1, 'a 401 on the token endpoint must never be retried');
  } finally { oauth.close(); }
});

test('resource 401 re-auths once and retries once', async () => {
  let tokens = 0;
  const oauth = await listen((req, res) => { tokens += 1; okJson(res, { access_token: `tok-${tokens}`, expires_in: 3600 }); });
  let apiHits = 0;
  const api = await listen((req, res) => {
    apiHits += 1;
    if (req.headers.authorization === 'Bearer tok-2') return okJson(res, { fine: true });
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  try {
    const { stdout } = await runClient("return await blizzard.bnet('/x');", {
      BLIZZARD_OAUTH_URL: `http://127.0.0.1:${oauth.address().port}/token`,
      BLIZZARD_API_BASE: `http://127.0.0.1:${api.address().port}`,
    });
    assert.ok(stdout.includes('RESULT:{"fine":true}'), `got: ${stdout}`);
    assert.equal(tokens, 2, 'exactly one re-auth');
    assert.equal(apiHits, 2, 'exactly one retry after re-auth');
  } finally { oauth.close(); api.close(); }
});

test('timeout aborts the request and eventually fails with a network code', async () => {
  const oauth = await listen((req, res) => okJson(res, TOKEN_OK));
  const api = await listen(() => { /* never respond */ });
  try {
    const { stdout } = await runClient("return await blizzard.bnet('/slow');", {
      BLIZZARD_OAUTH_URL: `http://127.0.0.1:${oauth.address().port}/token`,
      BLIZZARD_API_BASE: `http://127.0.0.1:${api.address().port}`,
      BLIZZARD_TIMEOUT_MS: '100',
      BLIZZARD_DEADLINE_MS: '2000',
    });
    assert.ok(stdout.startsWith('ERR:'), `should fail, got: ${stdout}`);
    assert.ok(/ETIMEDOUT|ABORT_ERR|UND_ERR/.test(stdout), `should carry a timeout/network code, got: ${stdout}`);
  } finally { oauth.close(); api.close(); }
});

test('429 honors Retry-After in seconds, then succeeds', async () => {
  const oauth = await listen((req, res) => okJson(res, TOKEN_OK));
  let hits = 0;
  let gapMs = 0;
  let last = 0;
  const api = await listen((req, res) => {
    hits += 1;
    const now = Date.now();
    if (hits === 2) gapMs = now - last;
    last = now;
    if (hits === 1) {
      res.writeHead(429, { 'Retry-After': '1' });
      res.end('{}');
      return;
    }
    okJson(res, { ok: true });
  });
  try {
    const { stdout } = await runClient("return await blizzard.bnet('/limited');", {
      BLIZZARD_OAUTH_URL: `http://127.0.0.1:${oauth.address().port}/token`,
      BLIZZARD_API_BASE: `http://127.0.0.1:${api.address().port}`,
    });
    assert.ok(stdout.includes('RESULT:{"ok":true}'), `got: ${stdout}`);
    assert.equal(hits, 2);
    assert.ok(gapMs >= 950, `waited only ${gapMs}ms; Retry-After: 1 must dominate the 20ms backoff`);
  } finally { oauth.close(); api.close(); }
});

test('429 honors an HTTP-date Retry-After', async () => {
  const oauth = await listen((req, res) => okJson(res, TOKEN_OK));
  let hits = 0;
  let gapMs = 0;
  let last = 0;
  const api = await listen((req, res) => {
    hits += 1;
    const now = Date.now();
    if (hits === 2) gapMs = now - last;
    last = now;
    if (hits === 1) {
      // HTTP dates truncate milliseconds, so +2500ms can parse as little as
      // ~1501ms in the future — the assertion below must stay under that floor.
      res.writeHead(429, { 'Retry-After': new Date(Date.now() + 2500).toUTCString() });
      res.end('{}');
      return;
    }
    okJson(res, { ok: true });
  });
  try {
    const { stdout } = await runClient("return await blizzard.bnet('/limited');", {
      BLIZZARD_OAUTH_URL: `http://127.0.0.1:${oauth.address().port}/token`,
      BLIZZARD_API_BASE: `http://127.0.0.1:${api.address().port}`,
    });
    assert.ok(stdout.includes('RESULT:{"ok":true}'), `got: ${stdout}`);
    assert.ok(gapMs >= 1200, `waited only ${gapMs}ms after an HTTP-date Retry-After`);
  } finally { oauth.close(); api.close(); }
});

test('retries exhaust after 3 attempts on persistent 500s, and 404 never retries', async () => {
  const oauth = await listen((req, res) => okJson(res, TOKEN_OK));
  let hits500 = 0;
  let hits404 = 0;
  const api = await listen((req, res) => {
    if (req.url.startsWith('/gone')) {
      hits404 += 1;
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    hits500 += 1;
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  try {
    const env = {
      BLIZZARD_OAUTH_URL: `http://127.0.0.1:${oauth.address().port}/token`,
      BLIZZARD_API_BASE: `http://127.0.0.1:${api.address().port}`,
    };
    const r1 = await runClient("return await blizzard.bnet('/broken');", env);
    assert.ok(r1.stdout.includes('"status":500'), `got: ${r1.stdout}`);
    assert.equal(hits500, 4, '1 attempt + 3 retries');

    const r2 = await runClient("return await blizzard.bnet('/gone');", env);
    assert.ok(r2.stdout.includes('"status":404'), `got: ${r2.stdout}`);
    assert.equal(hits404, 1, '404 must not be retried');
  } finally { oauth.close(); api.close(); }
});

test('a Retry-After beyond the overall deadline fails fast instead of sleeping past it', async () => {
  const oauth = await listen((req, res) => okJson(res, TOKEN_OK));
  let hits = 0;
  const api = await listen((req, res) => {
    hits += 1;
    res.writeHead(429, { 'Retry-After': '30' });
    res.end('{}');
  });
  try {
    const started = Date.now();
    const { stdout } = await runClient("return await blizzard.bnet('/swamped');", {
      BLIZZARD_OAUTH_URL: `http://127.0.0.1:${oauth.address().port}/token`,
      BLIZZARD_API_BASE: `http://127.0.0.1:${api.address().port}`,
      BLIZZARD_DEADLINE_MS: '300',
    });
    const elapsed = Date.now() - started;
    assert.ok(stdout.includes('"status":429'), `should fail with the 429, got: ${stdout}`);
    assert.equal(hits, 1, 'no retry may start when the wait cannot fit the deadline');
    assert.ok(elapsed < 5000, `failed fast (took ${elapsed}ms) instead of sleeping 30s`);
  } finally { oauth.close(); api.close(); }
});

test('global limiter bounds concurrency and token refresh is locked to one request', async () => {
  let tokenRequests = 0;
  const oauth = await listen((req, res) => {
    tokenRequests += 1;
    setTimeout(() => okJson(res, TOKEN_OK), 50); // slow token: a stampede would pile up here
  });
  let inFlight = 0;
  let peak = 0;
  const api = await listen((req, res) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    setTimeout(() => { inFlight -= 1; okJson(res, { ok: true }); }, 30);
  });
  try {
    const { stdout } = await runClient(`
      await Promise.all(Array.from({ length: 20 }, (_, i) => blizzard.bnet('/c/' + i)));
      return blizzard.getMetrics();
    `, {
      BLIZZARD_OAUTH_URL: `http://127.0.0.1:${oauth.address().port}/token`,
      BLIZZARD_API_BASE: `http://127.0.0.1:${api.address().port}`,
      BLIZZARD_MAX_CONCURRENT: '4',
    });
    assert.ok(stdout.startsWith('RESULT:'), `got: ${stdout}`);
    const m = JSON.parse(stdout.slice('RESULT:'.length));
    assert.equal(tokenRequests, 1, '20 parallel calls must share one token request');
    assert.ok(peak <= 4, `server saw ${peak} concurrent requests; limit is 4`);
    assert.ok(m.maxConcurrent <= 4, `client metrics report maxConcurrent=${m.maxConcurrent}`);
    assert.equal(m.requests, 21, '20 API calls + 1 token request');
  } finally { oauth.close(); api.close(); }
});
