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
const { bnet, realmSlug, setRegion, profileNs, staticNs } = require('./lib/blizzard');
const { redact } = require('./lib/safe-error');
const { loadConfig } = require('./lib/config');

const CONFIG = loadConfig();
setRegion(CONFIG.region);
const CHARS_PER_GUILD = 2;
// FIXTURES_OUT lets the capture workflow write to a temp path and upload it
// as an artifact instead of touching the repo.
const OUT = process.env.FIXTURES_OUT || path.join(__dirname, 'fixtures', 'blizzard-fixtures.json');

async function main() {
  const fixtures = {};
  const record = async (p) => { fixtures[decodeURIComponent(p.split('?')[0])] = await bnet(p); };

  for (const g of CONFIG.guilds) {
    const rosterPath = `/data/wow/guild/${g.realm}/${g.slug}/roster?namespace=${profileNs()}`;
    await record(rosterPath);
    const roster = fixtures[`/data/wow/guild/${g.realm}/${g.slug}/roster`];
    const picks = (roster.members || [])
      .filter(m => (m.character?.level || 0) >= CONFIG.minMemberLevel)
      .slice(0, CHARS_PER_GUILD);
    for (const m of picks) {
      const slug = realmSlug(m.character.realm?.slug || g.realm);
      const name = encodeURIComponent(m.character.name.toLowerCase());
      const base = `/profile/wow/character/${slug}/${name}`;
      for (const suffix of ['', '/equipment', '/statistics', '/character-media',
        '/achievements/statistics', '/collections/pets', '/collections/mounts', '/encounters/raids']) {
        try { await record(`${base}${suffix}?namespace=${profileNs()}`); }
        catch (_) { console.warn(`skipped ${base}${suffix} (fetch failed)`); }
      }
    }
  }

  // The journal endpoints the raid-catalog discovery depends on — the shape
  // guessed for the synthetic fixtures (raids vs instances) gets settled here.
  if (CONFIG.activeExpansionId) {
    try {
      await record(`/data/wow/journal-expansion/${CONFIG.activeExpansionId}?namespace=${staticNs()}`);
      const exp = fixtures[`/data/wow/journal-expansion/${CONFIG.activeExpansionId}`];
      for (const raid of (exp.raids || exp.instances || []).slice(0, 2)) {
        await record(`/data/wow/journal-instance/${raid.id}?namespace=${staticNs()}`);
      }
    } catch (_) { console.warn('skipped journal endpoints (fetch failed)'); }
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
