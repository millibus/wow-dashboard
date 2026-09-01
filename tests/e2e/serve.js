'use strict';
// Static server for the browser tests. Serves the REAL docs/ tree at / (so
// /v2/ is the shipped source, not a copy) and the fixture-built snapshot at
// /data/, which is exactly the layout GitHub Pages publishes.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const DOCS = path.join(REPO, 'docs');
const DATA = path.join(__dirname, '.site-data');
const PORT = Number(process.env.E2E_PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// Resolve inside the allowed root or refuse — no traversal out of the tree.
function resolveWithin(root, rel) {
  const full = path.join(root, rel);
  const normalizedRoot = path.resolve(root) + path.sep;
  return path.resolve(full).startsWith(normalizedRoot) ? full : null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname;
  try {
    // Malformed percent-encoding throws; an uncaught throw here would take the
    // server down and fail the whole Playwright run.
    pathname = decodeURIComponent(url.pathname);
  } catch (_) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('bad request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const isData = pathname.startsWith('/data/');
  const root = isData ? DATA : DOCS;
  const rel = isData ? pathname.slice('/data/'.length) : pathname.slice(1);
  const file = resolveWithin(root, rel);

  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => console.log(`e2e server on http://127.0.0.1:${PORT}`));
