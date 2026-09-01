'use strict';
// Unit tests for the safe-error sanitizer. Run with: node --test scripts/test/
const test = require('node:test');
const assert = require('node:assert/strict');

const SENTINEL_ID = 'sentinel-client-id-1234567890';
const SENTINEL_SECRET = 'sentinel-secret-abcdefghijklmnop';
process.env.BLIZZARD_CLIENT_ID = SENTINEL_ID;
process.env.BLIZZARD_CLIENT_SECRET = SENTINEL_SECRET;

const { redact, safeCode, toSafeError, formatSafeError } = require('../lib/safe-error');

const B64_PAIR = Buffer.from(`${SENTINEL_ID}:${SENTINEL_SECRET}`).toString('base64');
const B64_SECRET = Buffer.from(SENTINEL_SECRET).toString('base64');
const B64_ID = Buffer.from(SENTINEL_ID).toString('base64');

function assertClean(str) {
  for (const leak of [SENTINEL_SECRET, SENTINEL_ID, B64_PAIR, B64_SECRET, B64_ID]) {
    assert.ok(!str.includes(leak), `output leaked a credential form: ${leak.slice(0, 8)}…`);
  }
}

// A realistic axios-shaped 401 whose config/request carry the credentials in
// several forms, mirroring what axios actually serializes.
function fakeAxios401() {
  const err = new Error(`Request failed with status code 401 ${SENTINEL_SECRET}`);
  err.isAxiosError = true;
  err.code = 'ERR_BAD_REQUEST';
  err.config = {
    method: 'post',
    url: `https://oauth.battle.net/token?client_id=${SENTINEL_ID}`,
    auth: { username: SENTINEL_ID, password: SENTINEL_SECRET },
    headers: { Authorization: `Basic ${B64_PAIR}` },
    data: `grant_type=client_credentials&client_secret=${SENTINEL_SECRET}`,
  };
  err.response = {
    status: 401,
    headers: { 'www-authenticate': 'Basic' },
    data: { error: 'unauthorized', error_description: 'Bad credentials' },
  };
  return err;
}

test('redact strips raw and Base64 credential forms', () => {
  const dirty = `a=${SENTINEL_SECRET} b=${SENTINEL_ID} c=${B64_PAIR} d=${B64_SECRET} e=${B64_ID}`;
  const clean = redact(dirty);
  assertClean(clean);
  assert.ok(clean.includes('[REDACTED]'));
});

test('formatSafeError on an axios 401 keeps only code/status/method/pathname', () => {
  const line = formatSafeError(fakeAxios401());
  assertClean(line);
  assert.ok(line.includes('HTTP_401'));
  assert.ok(line.includes('status=401'));
  assert.ok(line.includes('POST'));
  assert.ok(line.includes('/token'));
  assert.ok(!line.includes('client_id='), 'query string must be dropped');
  assert.ok(!line.includes('Authorization'));
  assert.ok(!line.includes('Bad credentials'), 'response bodies must not be logged');
});

test('toSafeError never exposes config, headers, or response objects', () => {
  const safe = toSafeError(fakeAxios401());
  const json = JSON.stringify(safe);
  assertClean(json);
  assert.equal(safe.config, undefined);
  assert.equal(safe.response, undefined);
  assert.equal(safe.message, undefined, 'HTTP error messages are dropped entirely');
});

test('network errors classify as NETWORK_*', () => {
  const err = new Error('connect ECONNREFUSED 127.0.0.1:443');
  err.code = 'ECONNREFUSED';
  assert.equal(safeCode(err), 'NETWORK_ECONNREFUSED');
});

test('non-network system errors classify as SYS_*, never NETWORK_*', () => {
  for (const code of ['ENOSPC', 'EACCES', 'EMFILE']) {
    const err = new Error(`${code}: boom`);
    err.code = code;
    assert.equal(safeCode(err), `SYS_${code}`);
  }
});

test('plain error messages are kept but redacted', () => {
  const err = new Error(`disk full while writing ${SENTINEL_SECRET}`);
  const line = formatSafeError(err);
  assertClean(line);
  assert.ok(line.includes('disk full'));
});
