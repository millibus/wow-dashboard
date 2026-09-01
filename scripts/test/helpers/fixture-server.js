'use strict';
// Serves scripts/fixtures/blizzard-fixtures.json as a fake Blizzard API for
// tests: lookup is by decoded pathname (query strings ignored), unknown paths
// 404. Also provides a fake OAuth endpoint. Used with the BLIZZARD_API_BASE /
// BLIZZARD_OAUTH_URL env seams in scripts/lib/blizzard.js.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_FIXTURES = path.join(__dirname, '..', '..', 'fixtures', 'blizzard-fixtures.json');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// opts.mutate(fixtures) may edit the fixture map (its return value, if any,
// replaces it); opts.overrides[pathname] = { status, body } forces a response
// for that decoded pathname. Both exist so tests can simulate partial outages.
async function startFixtureApi(opts = {}) {
  const { fixturesPath = DEFAULT_FIXTURES, mutate, overrides = {} } = opts;
  let fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
  if (mutate) fixtures = mutate(fixtures) || fixtures;
  const hits = {}; // decoded pathname → request count, for cadence assertions
  const server = http.createServer((req, res) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://x').pathname; }
    catch (_) { pathname = String(req.url).split('?')[0]; }
    try { pathname = decodeURIComponent(pathname); } catch (_) { /* keep encoded */ }
    hits[pathname] = (hits[pathname] || 0) + 1;
    const override = overrides[pathname];
    if (override) {
      res.writeHead(override.status || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(override.body || { forced: true }));
      return;
    }
    const body = fixtures[pathname];
    if (body === undefined) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 404, detail: 'Not Found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await listen(server);
  return { server, base: `http://127.0.0.1:${server.address().port}`, hits };
}

async function startFakeOauth() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ access_token: 'fixture-token', expires_in: 3600 }));
  });
  await listen(server);
  return { server, url: `http://127.0.0.1:${server.address().port}/token` };
}

module.exports = { startFixtureApi, startFakeOauth, DEFAULT_FIXTURES };
