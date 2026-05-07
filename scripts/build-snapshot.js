#!/usr/bin/env node
// Build static JSON snapshots of guild data for the GitHub Pages frontend.
// Runs hourly via .github/workflows/refresh-data.yml. Also runnable locally:
//   BLIZZARD_CLIENT_ID=... BLIZZARD_CLIENT_SECRET=... node scripts/build-snapshot.js
//
// Output: docs/data/{guild,raid,collections}-{slug}.json + generated-at.json

const fs = require('fs');
const path = require('path');
const {
  bnet,
  fetchCharacter,
  fetchPets,
  fetchMounts,
  fetchRaidProgress,
  batched,
  RAID_TIERS,
} = require('../api/blizzard');

// Load env from api/.env if present (local dev convenience)
try { require('dotenv').config({ path: path.join(__dirname, '..', 'api', '.env') }); } catch (_) {}

const GUILDS = {
  'deaths-edge': { slug: 'deaths-edge', realm: 'onyxia', faction: 'horde' },
  'riot-act':    { slug: 'riot-act',    realm: 'onyxia', faction: 'alliance' },
};

const OUT_DIR = path.join(__dirname, '..', 'docs', 'data');

function writeJson(filename, data) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const filePath = path.join(OUT_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  const sizeKb = (fs.statSync(filePath).size / 1024).toFixed(1);
  console.log(`  wrote ${filename} (${sizeKb} KB)`);
}

async function buildGuildSnapshot(slug) {
  const cfg = GUILDS[slug];
  if (!cfg) throw new Error(`Unknown guild slug: ${slug}`);

  console.log(`\n[${slug}] fetching roster…`);
  const rosterData = await bnet(`/data/wow/guild/${cfg.realm}/${slug}/roster?namespace=profile-us`);
  const eligible = (rosterData.members || []).filter(m => (m.character?.level || 0) >= 10);
  console.log(`[${slug}] ${eligible.length} members at level 10+`);

  // Full character details (mirrors /api/guild)
  console.log(`[${slug}] fetching ${eligible.length} character details (concurrency 5, 200ms spacing)…`);
  const members = await batched(
    eligible,
    5,
    async (m) => {
      const full = await fetchCharacter(cfg.realm, m.character.name);
      if (!full) return null;
      return { ...full, rank: m.rank };
    },
    200,
  );
  const populatedMembers = members.filter(Boolean);
  console.log(`[${slug}] ${populatedMembers.length} characters populated`);

  const guildPayload = {
    guild: rosterData.guild?.name || slug,
    realm: 'Onyxia',
    faction: cfg.faction,
    members: populatedMembers,
    lastUpdated: new Date().toISOString(),
  };
  writeJson(`guild-${slug}.json`, guildPayload);

  // Raid progress for level-80+, capped at 35 members (mirrors /api/guild/raid-progress)
  const raidEligible = populatedMembers.filter(m => m.level >= 80).slice(0, 35);
  console.log(`[${slug}] fetching raid progress for ${raidEligible.length} level-80 members…`);
  const raidResults = await batched(
    raidEligible,
    5,
    m => fetchRaidProgress(cfg.realm, m.name),
    200,
  );
  writeJson(`raid-${slug}.json`, { tiers: RAID_TIERS, members: raidResults });

  // Pets + mounts collections (one file per guild keyed by character name)
  console.log(`[${slug}] fetching pets+mounts for ${raidEligible.length} members…`);
  const collections = {};
  await batched(
    raidEligible,
    5,
    async (m) => {
      const [pets, mounts] = await Promise.allSettled([
        fetchPets(cfg.realm, m.name),
        fetchMounts(cfg.realm, m.name),
      ]);
      collections[m.name] = {
        pets: pets.status === 'fulfilled' ? pets.value : { total: 0, unique: 0, pets: [] },
        mounts: mounts.status === 'fulfilled' ? mounts.value : { total: 0, mounts: [] },
      };
    },
    200,
  );
  writeJson(`collections-${slug}.json`, collections);
}

async function main() {
  const slugs = Object.keys(GUILDS);
  console.log(`Building snapshots for: ${slugs.join(', ')}`);

  for (const slug of slugs) {
    await buildGuildSnapshot(slug);
  }

  writeJson('generated-at.json', { ts: new Date().toISOString() });
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Snapshot build failed:', err);
  process.exit(1);
});
