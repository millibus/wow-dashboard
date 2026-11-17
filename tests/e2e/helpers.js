'use strict';
// Shared helpers for the browser tests.

// A 2x2 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII=',
  'base64');

// The fixture characters do not exist on Blizzard's render service, so left
// alone every avatar and full-body render would 404 against the real CDN.
// Answer those requests locally instead: the suite stays offline, and the
// stage and portraits are exercised with images that actually load.
//   stubRenders(page)                    — every render loads
//   stubRenders(page, { fail: /regex/ }) — matching URLs fail to load
async function stubRenders(page, { fail = null } = {}) {
  await page.route(/^https:\/\/render\.worldofwarcraft\.com\//, route => {
    if (fail && fail.test(route.request().url())) return route.abort();
    return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });
}

// The page's Google Fonts stylesheet is render-blocking, and Chrome holds
// script execution on it. A slow or sandboxed font CDN must not be able to
// delay the app's own boot: fail the font requests instantly and let the
// fallback stack render.
async function blockFonts(page) {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
}

// True when the document is wider than the viewport (a sideways scroll).
function overflowsSideways(page) {
  return page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

module.exports = { stubRenders, blockFonts, overflowsSideways };
