#!/usr/bin/env node
// Build static JSON snapshots of guild data for the GitHub Pages frontend.
// Runs hourly via .github/workflows/refresh-data.yml. Also runnable locally:
//   BLIZZARD_CLIENT_ID=... BLIZZARD_CLIENT_SECRET=... node scripts/build-snapshot.js
//
// One Blizzard fetch pass feeds TWO output layers:
//  - legacy files (docs/data/*.json) — the shapes the current frontend reads;
//    they keep generating until the V2 frontend becomes the default.
//  - V2 transactional snapshot (docs/data/v2/**) — stable character identity,
//    manifest with per-component status/counts/hashes, component-level
//    carry-forward from the previous published snapshot, staged + validated
//    before publishing (see scripts/lib/snapshot-v2.js).
//
// Guild isolation: one guild's roster failure never aborts the other guild and
// never discards good data — that guild is carried forward. Exit code is 1
// only when NOTHING publishable was produced.

const fs = require('fs');
const path = require('path');
const {
  bnet,
  getToken,
  fetchCharacter,
  fetchPets,
  fetchMounts,
  fetchRaidProgress,
  batched,
  RAID_TIERS,
  formatMetrics,
  realmSlug,
} = require('./lib/blizzard');
const { toSafeError, logSafeError, redact, safeCode } = require('./lib/safe-error');
const v2 = require('./lib/snapshot-v2');
const { validateV2Dir } = require('./validate-snapshot-v2');

// Load env from api/.env if present (local dev convenience)
try { require('dotenv').config({ path: path.join(__dirname, '..', 'api', '.env') }); } catch (_) {}

const GUILDS = {
  'deaths-edge': { slug: 'deaths-edge', realm: 'onyxia', faction: 'horde' },
  'riot-act':    { slug: 'riot-act',    realm: 'onyxia', faction: 'alliance' },
};

// SNAPSHOT_OUT_DIR is a test seam (write into a temp dir); production never sets it.
const OUT_DIR = process.env.SNAPSHOT_OUT_DIR || path.join(__dirname, '..', 'docs', 'data');
const OWNER_CONFIG = path.join(__dirname, '..', 'config', 'tracked-characters.json');

function writeJson(filename, data) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const filePath = path.join(OUT_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  const sizeKb = (fs.statSync(filePath).size / 1024).toFixed(1);
  console.log(`  wrote ${filename} (${sizeKb} KB)`);
}

// Fetch everything for one guild. Performs NO writes — returns a structured
// result the two writers consume. Throws only propagate as roster_failed.
async function fetchGuild(slug) {
  const cfg = GUILDS[slug];
  if (!cfg) throw new Error(`Unknown guild slug: ${slug}`);

  console.log(`\n[${slug}] fetching roster…`);
  let rosterData;
  try {
    rosterData = await bnet(`/data/wow/guild/${cfg.realm}/${slug}/roster?namespace=profile-us`);
  } catch (err) {
    logSafeError(`[${slug}] roster fetch failed`, err);
    return { status: 'roster_failed', slug, error: safeCode(err) };
  }
  const eligible = (rosterData.members || []).filter(m => (m.character?.level || 0) >= 10);
  console.log(`[${slug}] ${eligible.length} members at level 10+`);

  const members = eligible.map(e => ({
    id: e.character?.id ?? null,
    name: e.character?.name,
    realmSlug: e.character?.realm?.slug || realmSlug(cfg.realm),
    rank: e.rank,
    level: e.character?.level || 0,
    detail: null,
    raid: null, raidAttempted: false,
    collections: null, collectionsAttempted: false,
  }));

  console.log(`[${slug}] fetching ${members.length} character details…`);
  await batched(members, 5, async (m) => {
    const full = await fetchCharacter(cfg.realm, m.name);
    if (full) {
      m.detail = full;
      if (!m.id && full.id) m.id = full.id;
    }
  }, 200);
  console.log(`[${slug}] ${members.filter(m => m.detail).length} characters populated`);

  // Raid + collections for level-80+ (member cap and cadence policy → PR4).
  const raidEligible = members.filter(m => (m.detail?.level ?? m.level) >= 80).slice(0, 35);
  console.log(`[${slug}] fetching raid progress + collections for ${raidEligible.length} members…`);
  await batched(raidEligible, 5, async (m) => {
    m.raidAttempted = true;
    m.raid = await fetchRaidProgress(cfg.realm, m.name);
  }, 200);
  await batched(raidEligible, 5, async (m) => {
    m.collectionsAttempted = true;
    const [pets, mounts] = await Promise.allSettled([
      fetchPets(cfg.realm, m.name),
      fetchMounts(cfg.realm, m.name),
    ]);
    if (pets.status === 'fulfilled' && mounts.status === 'fulfilled') {
      m.collections = { pets: pets.value, mounts: mounts.value };
    }
  }, 200);

  return {
    status: 'ok',
    slug,
    guildName: rosterData.guild?.name || slug,
    faction: cfg.faction,
    realm: cfg.realm,
    members: members.filter(m => m.id !== null && m.name),
  };
}

// Legacy writer — derives the old file shapes from the MERGED view, so
// carry-forward protects the legacy frontend too (no more silently-emptied
// equipment overwriting good data).
function writeLegacy(slug, merged, guildName, faction) {
  const legacyMembers = [];
  for (const summary of merged.roster.members) {
    const key = v2.identityKey(summary);
    const char = merged.characters.get(key);
    if (!char) continue; // details unavailable and nothing to carry: omit rather than fabricate
    // V2 uses null for explicitly-unavailable pieces; the legacy shape
    // predates that distinction and expects arrays/objects.
    const d = char.detail;
    legacyMembers.push({
      ...d,
      equipment: Array.isArray(d.equipment) ? d.equipment : [],
      stats: d.stats || {},
      lifeStats: d.lifeStats || {},
      rank: summary.rank,
    });
  }
  writeJson(`guild-${slug}.json`, {
    guild: guildName,
    realm: 'Onyxia',
    faction,
    members: legacyMembers,
    lastUpdated: new Date().toISOString(),
  });
  writeJson(`raid-${slug}.json`, {
    tiers: RAID_TIERS,
    members: merged.raids.members.map(r => ({ name: r.name, realm: 'Onyxia', tiers: r.tiers })),
  });
  const legacyCollections = {};
  for (const [, col] of merged.collections) {
    legacyCollections[col.identity.name] = { pets: col.pets, mounts: col.mounts };
  }
  writeJson(`collections-${slug}.json`, legacyCollections);
}

// Expose the failure class to the workflow's alert step (used as the
// incident-issue fingerprint). No-op outside GitHub Actions.
function recordFailureCode(code) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `failure_code=${code}\n`);
  }
}

// One token request before any data fetch. A 401/403 here means the client
// credentials themselves are bad — fail immediately with a compact code
// instead of hammering every endpoint and leaking failure details per call.
async function oauthPreflight() {
  try {
    await getToken();
    console.log('OAuth preflight: ok');
  } catch (err) {
    const status = err?.response?.status;
    if (err?.safeCode === 'AUTH_BAD_CREDENTIALS' || status === 401 || status === 403) {
      recordFailureCode('AUTH_BAD_CREDENTIALS');
      console.error(redact(
        `ERROR AUTH_BAD_CREDENTIALS: Blizzard rejected the OAuth client credentials (HTTP ${status}). ` +
        'Rotate BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET (see README) and re-run the workflow.'
      ));
    } else {
      const code = toSafeError(err).code;
      recordFailureCode(code);
      logSafeError('ERROR OAuth preflight failed before any data was fetched', err);
    }
    process.exit(1);
  }
}

async function main() {
  await oauthPreflight();

  const startedAt = new Date().toISOString();
  const sanityOverride = process.env.SNAPSHOT_SANITY_OVERRIDE === '1';
  if (sanityOverride) console.log('NOTE: sanity guards overridden for this run (schema validation still applies).');

  const slugs = Object.keys(GUILDS);
  console.log(`Building snapshots for: ${slugs.join(', ')}`);

  const prev = v2.loadPrevSnapshot(path.join(OUT_DIR, 'v2'));
  if (!prev) console.log('No valid previous V2 snapshot — carry-forward unavailable this run.');
  const ownerCfg = v2.loadOwnerConfig(OWNER_CONFIG);

  const guildOutputs = { startedAt, guilds: {} };
  const legacyPlan = [];
  for (const slug of slugs) {
    let result;
    try {
      result = await fetchGuild(slug);
    } catch (err) {
      logSafeError(`[${slug}] fetch failed`, err);
      result = { status: 'roster_failed', slug, error: safeCode(err) };
    }
    const merged = v2.mergeGuild(slug, result, prev?.guilds?.[slug] || null, ownerCfg, { sanityOverride });
    if (merged.errors?.length) console.log(`[${slug}] status=${merged.status} errors=${merged.errors.join(',')}`);
    else console.log(`[${slug}] status=${merged.status}`);
    guildOutputs.guilds[slug] = merged;
    if (merged.status !== 'unavailable') {
      legacyPlan.push({ slug, merged, guildName: merged.roster.guild, faction: merged.roster.faction || GUILDS[slug].faction });
    }
  }

  const anyPublishable = Object.values(guildOutputs.guilds).some(g => g.status !== 'unavailable');
  if (!anyPublishable) {
    recordFailureCode('SNAPSHOT_NOTHING_PUBLISHABLE');
    console.error('ERROR SNAPSHOT_NOTHING_PUBLISHABLE: no guild produced or carried forward valid data; nothing written.');
    process.exit(1);
  }

  // V2: stage → validate → publish atomically.
  const { stagingDir, manifest } = v2.buildStaging(OUT_DIR, guildOutputs);
  const problems = validateV2Dir(stagingDir);
  if (problems.length) {
    recordFailureCode('SNAPSHOT_VALIDATION_FAILED');
    console.error(`ERROR SNAPSHOT_VALIDATION_FAILED: staged V2 snapshot rejected (${problems.length} problems); nothing published.`);
    for (const p of problems.slice(0, 20)) console.error(`  - ${redact(p)}`);
    fs.rmSync(stagingDir, { recursive: true, force: true });
    process.exit(1);
  }
  v2.publishStaging(OUT_DIR, stagingDir);
  console.log(`\nV2 snapshot published: ${manifest.snapshotId} (${manifest.overallStatus}, ${Object.keys(manifest.files).length} files)`);

  // Legacy layer, derived from the same merged view.
  for (const { slug, merged, guildName, faction } of legacyPlan) {
    writeLegacy(slug, merged, guildName, faction);
  }
  writeJson('generated-at.json', { ts: new Date().toISOString() });

  console.log(`\nAPI metrics: ${formatMetrics()}`);
  const degraded = Object.values(guildOutputs.guilds).some(g => g.status !== 'fresh');
  console.log(degraded ? 'Done (degraded — some components carried forward or unavailable).' : 'Done.');
}

main().catch(err => {
  recordFailureCode(toSafeError(err).code);
  logSafeError('Snapshot build failed', err);
  process.exit(1);
});
