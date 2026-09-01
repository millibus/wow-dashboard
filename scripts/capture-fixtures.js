#!/usr/bin/env node
'use strict';
// Capture REAL Blizzard responses as deterministic test fixtures, replacing the
// synthetic set in scripts/fixtures/blizzard-fixtures.json. Run locally with
// valid credentials (never in CI):
//
//   BLIZZARD_CLIENT_ID=... BLIZZARD_CLIENT_SECRET=... node scripts/capture-fixtures.js
//
// Records the roster for each guild plus the full endpoint set for the first
// N characters per guild, keyed by decoded pathname. Responses contain no
// credentials, but the output is scanned anyway and the write refuses if any
// credential form appears.

const fs = require('fs');
const path = require('path');
const { bnet, realmSlug } = require('../api/blizzard');
const { redact } = require('./lib/safe-error');

const CHARS_PER_GUILD = 2;
const GUILDS = [
  { slug: 'deaths-edge', realm: 'onyxia' },
  { slug: 'riot-act', realm: 'onyxia' },
];
const OUT = path.join(__dirname, 'fixtures', 'blizzard-fixtures.json');

async function main() {
  const fixtures = {};
  const record = async (p) => { fixtures[decodeURIComponent(p.split('?')[0])] = await bnet(p); };

  for (const g of GUILDS) {
    const rosterPath = `/data/wow/guild/${g.realm}/${g.slug}/roster?namespace=profile-us`;
    await record(rosterPath);
    const roster = fixtures[`/data/wow/guild/${g.realm}/${g.slug}/roster`];
    const picks = (roster.members || [])
      .filter(m => (m.character?.level || 0) >= 10)
      .slice(0, CHARS_PER_GUILD);
    for (const m of picks) {
      const slug = realmSlug(m.character.realm?.slug || g.realm);
      const name = encodeURIComponent(m.character.name.toLowerCase());
      const base = `/profile/wow/character/${slug}/${name}`;
      for (const suffix of ['', '/equipment', '/statistics', '/character-media',
        '/achievements/statistics', '/collections/pets', '/collections/mounts', '/encounters/raids']) {
        try { await record(`${base}${suffix}?namespace=profile-us`); }
        catch (_) { console.warn(`skipped ${base}${suffix} (fetch failed)`); }
      }
    }
  }

  const json = JSON.stringify(fixtures, null, 2) + '\n';
  if (redact(json) !== json) {
    console.error('Refusing to write fixtures: output contains a credential form.');
    process.exit(1);
  }
  fs.writeFileSync(OUT, json);
  console.log(`wrote ${OUT}: ${Object.keys(fixtures).length} endpoints`);
}

main().catch((err) => {
  const { logSafeError } = require('./lib/safe-error');
  logSafeError('Fixture capture failed', err);
  process.exit(1);
});
