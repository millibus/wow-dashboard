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
  fetchRaidCatalog,
  batched,
  RAID_TIERS,
  formatMetrics,
  getLifeStatFallbacks,
  realmSlug,
} = require('./lib/blizzard');
const { toSafeError, logSafeError, redact, safeCode } = require('./lib/safe-error');
const v2 = require('./lib/snapshot-v2');
const { validateV2Dir } = require('./validate-snapshot-v2');
const { loadConfig } = require('./lib/config');

// Load env from api/.env if present (local dev convenience)
try { require('dotenv').config({ path: path.join(__dirname, '..', 'api', '.env') }); } catch (_) {}

const CONFIG = loadConfig();
require('./lib/blizzard').setRegion(CONFIG.region);
const GUILDS = Object.fromEntries(CONFIG.guilds.map(g => [g.slug, g]));

// SNAPSHOT_OUT_DIR is a test seam (write into a temp dir); production never sets it.
const OUT_DIR = process.env.SNAPSHOT_OUT_DIR || path.join(__dirname, '..', 'docs', 'data');
// SNAPSHOT_TRACKED_PATH is a test seam; production never sets it.
const OWNER_CONFIG = process.env.SNAPSHOT_TRACKED_PATH
  || path.join(__dirname, '..', 'config', 'tracked-characters.json');

// Legacy files: minified (kills the 28k-line hourly diffs) and skipped when
// content is unchanged ignoring volatile timestamps — no churn, smaller repo.
// generated-at.json is the exception: its changing ts IS the freshness signal.
const { canonicalStringify, contentEquals } = require('./lib/canonical');
function writeJson(filename, data) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const filePath = path.join(OUT_DIR, filename);
  if (filename !== 'generated-at.json') {
    try {
      if (contentEquals(JSON.parse(fs.readFileSync(filePath, 'utf8')), data)) {
        console.log(`  ${filename} unchanged — not rewritten`);
        return;
      }
    } catch (_) { /* no previous file or unparsable — write fresh */ }
  }
  fs.writeFileSync(filePath, canonicalStringify(data) + '\n');
  const sizeKb = (fs.statSync(filePath).size / 1024).toFixed(1);
  console.log(`  wrote ${filename} (${sizeKb} KB)`);
}

// Discover the current expansion's raid catalog, on its own cadence, carrying
// forward the previous catalog on failure or catastrophic shrink. With neither
// a fresh discovery nor a previous catalog, the built-in fallback keeps the
// raid feature limping instead of silently empty.
async function resolveCatalog(prev, warnings) {
  const cadenceMs = CONFIG.cadencesHours.catalog * 3600e3;
  const prevCatalog = prev?.catalog || null;
  if (prevCatalog?.fetchedAt && Date.now() - Date.parse(prevCatalog.fetchedAt) < cadenceMs) {
    return { ...prevCatalog, status: 'fresh' }; // within cadence — reuse is not degradation
  }
  try {
    const c = await fetchRaidCatalog(CONFIG.activeExpansionId, CONFIG.tierOverrides);
    if (!c.tiers.length) throw new Error('CATALOG_EMPTY');
    if (prevCatalog?.tiers?.length && c.tiers.length < prevCatalog.tiers.length * 0.5) {
      warnings.push(`CATALOG_SHRINK: discovery returned ${c.tiers.length} tiers vs previous ${prevCatalog.tiers.length}; carrying previous catalog forward`);
      return { ...prevCatalog, status: 'carried_forward' };
    }
    return { ...c, status: 'fresh', fetchedAt: new Date().toISOString() };
  } catch (err) {
    if (prevCatalog) {
      warnings.push(`CATALOG_DISCOVERY_FAILED (${safeCode(err)}): carrying previous catalog forward`);
      return { ...prevCatalog, status: 'carried_forward' };
    }
    warnings.push(`CATALOG_DISCOVERY_FAILED (${safeCode(err)}): no previous catalog; using built-in fallback tiers`);
    return { expansionId: CONFIG.activeExpansionId, tiers: RAID_TIERS, status: 'carried_forward', fetchedAt: null };
  }
}

// Fetch everything for one guild. Performs NO writes — returns a structured
// result the two writers consume. Throws only propagate as roster_failed.
// `reuse` marks components whose previous data is still within its cadence:
// those members are not refetched (unless they have no previous data at all).
async function fetchGuild(slug, catalog, prevGuild, reuse, ownerCfg) {
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
    const full = await fetchCharacter(cfg.realm, m.name, { lifeStatDefs: CONFIG.lifeStatDefs });
    if (full) {
      m.detail = full;
      if (!m.id && full.id) m.id = full.id;
    }
  }, 200);
  console.log(`[${slug}] ${members.filter(m => m.detail).length} characters populated`);

  // Expensive components (raids, collections) only for TRACKED characters at
  // raid level, capped loudly — never a silent slice.
  const tracked = m => !CONFIG.expensive.trackedOnly || v2.resolveOwner(ownerCfg, m) !== null;
  let expensive = members.filter(m => (m.detail?.level ?? m.level) >= CONFIG.raidMinLevel && tracked(m));
  if (expensive.length > CONFIG.limits.raidMemberCap) {
    console.log(`[${slug}] WARNING: ${expensive.length} eligible members exceed raidMemberCap=${CONFIG.limits.raidMemberCap}; truncating`);
    expensive = expensive.slice(0, CONFIG.limits.raidMemberCap);
  }

  // Cadence: within a component's window, only members with no previous data
  // are fetched (a new tracked member should not wait a day for collections).
  const needsFetch = (m, kind) => {
    if (!reuse[kind] || !prevGuild) return true;
    const key = v2.identityKey(m);
    if (kind === 'raids') return !(prevGuild.raids?.members || []).some(r => r.id === m.id);
    return !prevGuild.readCollection(key);
  };

  const raidTargets = expensive.filter(m => needsFetch(m, 'raids'));
  console.log(`[${slug}] fetching raid progress for ${raidTargets.length}/${expensive.length} tracked members${reuse.raids ? ' (within cadence: reusing the rest)' : ''}…`);
  await batched(raidTargets, 5, async (m) => {
    m.raidAttempted = true;
    m.raid = await fetchRaidProgress(cfg.realm, m.name, catalog);
  }, 200);

  const colTargets = expensive.filter(m => needsFetch(m, 'collections'));
  console.log(`[${slug}] fetching collections for ${colTargets.length}/${expensive.length} tracked members${reuse.collections ? ' (within cadence: reusing the rest)' : ''}…`);
  await batched(colTargets, 5, async (m) => {
    m.collectionsAttempted = true;
    const [pets, mounts] = await Promise.allSettled([
      fetchPets(cfg.realm, m.name),
      fetchMounts(cfg.realm, m.name),
    ]);
    if (pets.status === 'fulfilled' && mounts.status === 'fulfilled') {
      m.collections = { pets: pets.value, mounts: mounts.value };
    }
  }, 200);
  for (const m of expensive) m.expensiveEligible = true;

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
function writeLegacy(slug, merged, guildName, faction, catalogTiers) {
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
    tiers: catalogTiers,
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

  const warnings = [];
  const catalog = await resolveCatalog(prev, warnings);
  console.log(`Raid catalog: ${catalog.status}, ${catalog.tiers.length} tiers (expansion ${catalog.expansionId ?? '?'})`);

  const guildOutputs = {
    startedAt,
    guilds: {},
    warnings,
    catalog,
    uiConfig: {
      levelCap: CONFIG.levelCap,
      raidMinLevel: CONFIG.raidMinLevel,
      archiveThresholdDays: CONFIG.archiveThresholdDays,
      readiness: CONFIG.readiness,
      guilds: CONFIG.guilds.map(g => ({ slug: g.slug, faction: g.faction })),
      owners: (() => {
        try {
          const parsed = JSON.parse(fs.readFileSync(OWNER_CONFIG, 'utf8')).owners;
          return Array.isArray(parsed) ? parsed.filter(o => typeof o === 'string') : [];
        } catch (_) { return []; }
      })(),
    },
  };
  const legacyPlan = [];
  for (const slug of slugs) {
    const prevGuild = prev?.guilds?.[slug] || null;
    // A component's previous data within its cadence is reused, not refetched.
    const withinCadence = kind => {
      const at = prevGuild?.meta?.componentFetchedAt?.[kind];
      return Boolean(at && Date.now() - Date.parse(at) < CONFIG.cadencesHours[kind] * 3600e3);
    };
    const reuse = { raids: withinCadence('raids'), collections: withinCadence('collections') };

    let result;
    try {
      result = await fetchGuild(slug, catalog, prevGuild, reuse, ownerCfg);
    } catch (err) {
      logSafeError(`[${slug}] fetch failed`, err);
      result = { status: 'roster_failed', slug, error: safeCode(err) };
    }
    const merged = v2.mergeGuild(slug, result, prevGuild, ownerCfg, {
      sanityOverride,
      limits: CONFIG.limits,
      reuse,
      prevFetchedAt: prevGuild?.meta?.componentFetchedAt || {},
    });
    if (merged.errors?.length) console.log(`[${slug}] status=${merged.status} errors=${merged.errors.join(',')}`);
    else console.log(`[${slug}] status=${merged.status}`);

    // Level-cap drift guard: a new expansion raised the cap and the config
    // was not updated — warn loudly instead of silently miscounting.
    const maxLevel = Math.max(0, ...(merged.roster?.members || []).map(m => m.level || 0));
    if (maxLevel > CONFIG.levelCap) {
      warnings.push(`LEVEL_CAP_DRIFT: observed level ${maxLevel} in ${slug} exceeds configured levelCap ${CONFIG.levelCap} — update config/dashboard-config.json`);
    }

    guildOutputs.guilds[slug] = merged;
    if (merged.status !== 'unavailable') {
      legacyPlan.push({ slug, merged, guildName: merged.roster.guild, faction: merged.roster.faction || GUILDS[slug].faction });
    }
  }
  for (const w of warnings) console.log(`WARNING ${redact(w)}`);

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
    writeLegacy(slug, merged, guildName, faction, catalog.tiers);
  }
  writeJson('generated-at.json', { ts: new Date().toISOString() });

  const fallbacks = getLifeStatFallbacks();
  if (fallbacks.length) {
    console.log(`WARNING LIFE_STAT_NAME_FALLBACK: matched by display name instead of id: ${fallbacks.join(', ')} — backfill ids in config/dashboard-config.json`);
  }
  console.log(`\nAPI metrics: ${formatMetrics()}`);
  const degraded = Object.values(guildOutputs.guilds).some(g => g.status !== 'fresh');
  console.log(degraded ? 'Done (degraded — some components carried forward or unavailable).' : 'Done.');
}

main().catch(err => {
  recordFailureCode(toSafeError(err).code);
  logSafeError('Snapshot build failed', err);
  process.exit(1);
});
