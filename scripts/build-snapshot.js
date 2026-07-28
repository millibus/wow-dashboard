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
  GUILDS,
  NAMESPACE,
  RAID_TIERS,
} = require('../api/blizzard');

// Load env from api/.env if present (local dev convenience)
try { require('dotenv').config({ path: path.join(__dirname, '..', 'api', '.env') }); } catch (_) {}

const OUT_DIR = path.join(__dirname, '..', 'docs', 'data');

// A partial run must never overwrite a good snapshot with a nearly-empty one:
// the workflow commits whatever lands on disk, and a rate-limited run used to
// publish an empty roster that looked freshly generated.
const MIN_RETAINED_FRACTION = 0.7;

function writeJson(filename, data) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const filePath = path.join(OUT_DIR, filename);
  const tmpPath = `${filePath}.tmp`;
  // Write-then-rename so a crash mid-write can't leave truncated JSON behind.
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmpPath, filePath);
  const sizeKb = (fs.statSync(filePath).size / 1024).toFixed(1);
  console.log(`  wrote ${filename} (${sizeKb} KB)`);
}

function readExisting(filename) {
  try {
    return JSON.parse(fs.readFileSync(path.join(OUT_DIR, filename), 'utf8'));
  } catch (_) {
    return null;
  }
}

// Object key order is part of the file's bytes. The collections map used to be
// keyed in whatever order the concurrent fetches finished, which rewrote ~1 MB
// of JSON every hour whether or not anything changed.
function sortKeys(obj) {
  return Object.fromEntries(Object.keys(obj).sort().map(k => [k, obj[k]]));
}

async function buildGuildSnapshot(slug) {
  const cfg = GUILDS[slug];
  if (!cfg) throw new Error(`Unknown guild slug: ${slug}`);

  console.log(`\n[${slug}] fetching roster…`);
  const rosterData = await bnet(`/data/wow/guild/${cfg.realm}/${slug}/roster?namespace=${NAMESPACE}`);
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

  const previous = readExisting(`guild-${slug}.json`);
  const previousCount = previous?.members?.length || 0;
  if (!populatedMembers.length) {
    throw new Error(`[${slug}] roster came back empty — refusing to overwrite the last good snapshot`);
  }
  if (previousCount && populatedMembers.length < previousCount * MIN_RETAINED_FRACTION) {
    throw new Error(
      `[${slug}] only ${populatedMembers.length} of ${previousCount} characters fetched ` +
      `(below ${Math.round(MIN_RETAINED_FRACTION * 100)}% of the previous snapshot) — ` +
      'treating this as a partial failure rather than publishing it',
    );
  }

  const guildPayload = {
    guild: rosterData.guild?.name || slug,
    realm: rosterData.guild?.realm?.name || cfg.realm,
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
  writeJson(`collections-${slug}.json`, sortKeys(collections));
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
