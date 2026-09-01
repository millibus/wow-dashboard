'use strict';
// Transactional V2 snapshot layer.
//
// Consumes per-guild fetch results (produced by scripts/build-snapshot.js in a
// single Blizzard pass), merges them against the previous published V2 snapshot
// (component-level carry-forward), builds the whole tree in a STAGING
// directory, and publishes it atomically. Every required component ends up in
// exactly one of three states: fresh | carried_forward | unavailable.
//
// Roster rules:
// - A fresh roster response is authoritative for membership: characters no
//   longer on it are removed (their files are simply not staged).
// - If the roster request failed, the ENTIRE previous guild is carried forward.
// - A new member whose detail fetches failed gets a basic roster summary with
//   details marked unavailable — never fabricated zeros.
// - The previous snapshot is validated before being trusted as last-known-good.
//
// Sanity guards (bypass only via the workflow_dispatch sanity override, which
// never bypasses schema validation): minimum member floor and a max-shrink
// guard vs the previous published roster.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 2;
const REGION = 'us';
const EXPECTED_REFRESH_MINUTES = 60;
const LIMITS = { minMembers: 2, maxShrinkPercent: 40 }; // → config/dashboard-config.json in PR4

function identityKey(m) { return `${REGION}-${m.realmSlug}-${m.id}`; }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function loadOwnerConfig(configPath) {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const byId = new Map();
    const byName = new Map();
    for (const c of cfg.characters || []) {
      if (c.id) byId.set(String(c.id), c.owner);
      if (c.name) byName.set(c.name.toLowerCase(), c.owner);
    }
    return { byId, byName };
  } catch (_) {
    return { byId: new Map(), byName: new Map() };
  }
}

function resolveOwner(ownerCfg, member) {
  if (member.id && ownerCfg.byId.has(String(member.id))) return ownerCfg.byId.get(String(member.id));
  return ownerCfg.byName.get(member.name.toLowerCase()) || null;
}

// Load and structurally sanity-check the previous published snapshot; an
// unreadable or inconsistent one is treated as absent, never trusted.
function loadPrevSnapshot(v2Root) {
  try {
    // Full validation — including manifest hash checks — before trusting
    // anything as last-known-good: a corrupted-but-parsable file must never be
    // carried forward and re-hashed into a valid-looking snapshot.
    const { validateV2Dir } = require('../validate-snapshot-v2');
    if (!fs.existsSync(v2Root) || validateV2Dir(v2Root).length > 0) return null;

    const manifest = JSON.parse(fs.readFileSync(path.join(v2Root, 'manifest.json'), 'utf8'));
    if (manifest.schemaVersion !== SCHEMA_VERSION || typeof manifest.guilds !== 'object') return null;
    const readJson = rel => {
      try { return JSON.parse(fs.readFileSync(path.join(v2Root, rel), 'utf8')); }
      catch (_) { return null; }
    };
    const guilds = {};
    for (const [slug, g] of Object.entries(manifest.guilds)) {
      // A guild published as unavailable legitimately has no files — skip it
      // rather than distrusting every OTHER guild's last-known-good data.
      if (g.status === 'unavailable') continue;
      const roster = readJson(`guilds/${slug}.json`);
      if (!roster || !Array.isArray(roster.members)) return null; // inconsistent → distrust everything
      guilds[slug] = {
        meta: g,
        roster,
        raids: readJson(`raids/${slug}.json`),
        collectionsIndex: readJson(`collections/${slug}/index.json`),
        readCharacter: key => readJson(`characters/${slug}/${key}.json`),
        readCollection: key => readJson(`collections/${slug}/${key}.json`),
      };
    }
    return { manifest, guilds };
  } catch (_) {
    return null;
  }
}

function summarizeMember(m, detail, owner) {
  const s = detail?.stats || {};
  const eq = Array.isArray(detail?.equipment) ? detail.equipment : null;
  return {
    id: m.id,
    name: m.name,
    realmSlug: m.realmSlug,
    region: REGION,
    rank: m.rank,
    level: detail?.level ?? m.level ?? 0,
    className: detail?.className || null,
    spec: detail?.spec || null,
    race: detail?.race || null,
    faction: detail?.faction || null,
    ilvl: detail?.averageIlvl ?? null,
    lastLogin: detail?.lastLogin ?? null,
    // null, not 0, when unknown — an unavailable member must never look like
    // one with zero achievement points.
    achievementPoints: detail?.achievementPoints ?? null,
    avatarUrl: detail?.avatarUrl ?? null,
    owner,
    stats: { crit: s.crit ?? null, haste: s.haste ?? null, mastery: s.mastery ?? null, vers: s.vers ?? null },
    lifeStats: detail?.lifeStats ?? null,
    equipmentSummary: eq ? {
      count: eq.length,
      emptySockets: eq.filter(i => i.hasEmptySocket).length,
      unenchanted: eq.filter(i => i.enchantCount === 0).length,
    } : null,
  };
}

// Merge one guild's fetch result with the previous snapshot.
// Returns { status, roster, characters: Map<key, detailFile>, collections:
//           Map<key, file>, collectionsIndex, raids, counts, errors }
function mergeGuild(slug, result, prevGuild, ownerCfg, opts) {
  const now = new Date().toISOString();
  const counts = { attempted: 0, succeeded: 0, failed: 0, carriedForward: 0 };
  const errors = [];

  // Roster failed entirely → carry the whole previous guild forward.
  if (result.status === 'roster_failed') {
    if (!prevGuild) {
      return { status: 'unavailable', errors: [result.error || 'ROSTER_FAILED'], counts };
    }
    const characters = new Map();
    const collections = new Map();
    for (const member of prevGuild.roster.members) {
      const key = identityKey(member);
      const c = prevGuild.readCharacter(key);
      if (c) characters.set(key, c);
      const col = prevGuild.readCollection(key);
      if (col) collections.set(key, col);
    }
    counts.carriedForward = prevGuild.roster.members.length;
    return {
      status: 'carried_forward',
      roster: { ...prevGuild.roster, carriedForwardAt: now },
      characters, collections,
      collectionsIndex: prevGuild.collectionsIndex || { characters: {} },
      raids: prevGuild.raids || { members: [] },
      counts, errors: [result.error || 'ROSTER_FAILED'],
    };
  }

  // Sanity guards against a catastrophically shrunken fresh roster.
  const freshCount = result.members.length;
  const prevCount = prevGuild ? prevGuild.roster.members.length : null;
  const floorBroken = freshCount < LIMITS.minMembers;
  const shrinkBroken = prevCount !== null && freshCount < prevCount * (1 - LIMITS.maxShrinkPercent / 100);
  if ((floorBroken || shrinkBroken) && !opts.sanityOverride) {
    const reason = floorBroken
      ? `SANITY_MEMBER_FLOOR (${freshCount} < ${LIMITS.minMembers})`
      : `SANITY_ROSTER_SHRINK (${freshCount} vs previous ${prevCount})`;
    if (prevGuild) {
      const carried = mergeGuild(slug, { status: 'roster_failed', error: reason }, prevGuild, ownerCfg, opts);
      carried.errors = [reason];
      return carried;
    }
    return { status: 'unavailable', errors: [reason], counts };
  }

  const roster = { guild: result.guildName, slug, faction: result.faction, region: REGION, updatedAt: now, members: [] };
  const characters = new Map();
  const collections = new Map();
  const collectionsIndex = { characters: {} };
  const raids = { members: [] };
  let guildDegraded = false;

  for (const m of result.members) {
    counts.attempted += 1;
    const key = identityKey(m);
    const owner = resolveOwner(ownerCfg, m);
    const prevChar = prevGuild ? prevGuild.readCharacter(key) : null;

    // --- character detail: each PIECE ends up fresh | carried_forward |
    // unavailable. An unavailable piece with nothing to carry becomes null in
    // the published detail — never a fabricated empty array or zeroed object.
    const PIECES = {
      equipment: { fields: ['equipment'], has: d => Array.isArray(d.equipment) },
      statistics: { fields: ['stats'], has: d => !!d.stats },
      media: { fields: ['avatarUrl', 'mainRawUrl'], has: d => d.avatarUrl !== undefined },
      achievements: { fields: ['lifeStats'], has: d => !!d.lifeStats },
    };
    let detail = m.detail;
    const pieceStatus = { profile: 'unavailable' };
    if (detail) {
      pieceStatus.profile = 'fresh';
      counts.succeeded += 1;
      for (const [piece, spec] of Object.entries(PIECES)) {
        if (m.detail.sources?.[piece] !== 'unavailable') {
          pieceStatus[piece] = 'fresh';
        } else if (prevChar?.detail && spec.has(prevChar.detail)) {
          for (const f of spec.fields) detail = { ...detail, [f]: prevChar.detail[f] };
          if (piece === 'equipment') detail.averageIlvl = detail.averageIlvl || prevChar.detail.averageIlvl;
          pieceStatus[piece] = 'carried_forward';
          counts.carriedForward += 1;
          guildDegraded = true;
        } else {
          for (const f of spec.fields) detail = { ...detail, [f]: null };
          pieceStatus[piece] = 'unavailable';
          guildDegraded = true;
        }
      }
    } else if (prevChar?.detail) {
      detail = prevChar.detail;
      pieceStatus.profile = 'carried_forward';
      for (const piece of Object.keys(PIECES)) pieceStatus[piece] = 'carried_forward';
      counts.carriedForward += 1;
      guildDegraded = true;
    } else {
      for (const piece of Object.keys(PIECES)) pieceStatus[piece] = 'unavailable';
      counts.failed += 1;
      guildDegraded = true;
    }
    const detailStatus = pieceStatus.profile === 'unavailable' ? 'unavailable'
      : Object.values(pieceStatus).every(s => s === 'fresh') ? 'fresh'
      : 'carried_forward';

    // --- collections ---
    let col = m.collections;
    let colStatus = col ? 'fresh' : 'unavailable';
    if (!col && prevGuild) {
      const prevCol = prevGuild.readCollection(key);
      if (prevCol) { col = prevCol; colStatus = 'carried_forward'; counts.carriedForward += 1; guildDegraded = true; }
    }
    if (!col && m.collectionsAttempted) guildDegraded = true;

    // --- raids ---
    let raid = m.raid && !m.raid.error ? m.raid : null;
    let raidStatus = raid ? 'fresh' : 'unavailable';
    if (!raid && prevGuild?.raids) {
      const prevRaid = (prevGuild.raids.members || []).find(r => r.id === m.id);
      if (prevRaid) { raid = prevRaid; raidStatus = 'carried_forward'; counts.carriedForward += 1; guildDegraded = true; }
    }
    if (m.raid?.error) { errors.push(m.raid.error); guildDegraded = true; }

    const summary = summarizeMember(m, detail, owner);
    summary.components = {
      details: detailStatus,
      ...pieceStatus,
      collections: m.collectionsAttempted || col ? colStatus : 'not_tracked',
      raids: m.raidAttempted || raid ? raidStatus : 'not_tracked',
    };
    roster.members.push(summary);

    if (detail) {
      const { sources, ...detailClean } = detail;
      characters.set(key, {
        identity: { id: m.id, name: m.name, realmSlug: m.realmSlug, region: REGION },
        status: detailStatus,
        components: pieceStatus,
        sourceUpdatedAt: pieceStatus.profile === 'carried_forward' ? (prevChar?.sourceUpdatedAt || null) : now,
        detail: detailClean,
      });
    }
    if (col) {
      collections.set(key, { identity: { id: m.id, name: m.name }, status: colStatus, pets: col.pets, mounts: col.mounts });
      collectionsIndex.characters[key] = {
        name: m.name,
        pets: { total: col.pets?.total ?? 0, unique: col.pets?.unique ?? 0 },
        mounts: { total: col.mounts?.total ?? 0 },
        status: colStatus,
      };
    }
    if (raid) raids.members.push({ id: m.id, name: m.name, status: raidStatus, tiers: raid.tiers || [] });
  }

  return { status: guildDegraded ? 'degraded' : 'fresh', roster, characters, collections, collectionsIndex, raids, counts, errors };
}

// Build the staging tree and return { stagingDir, manifest }.
function buildStaging(outRoot, guildOutputs) {
  const stagingDir = path.join(outRoot, `v2.staging-${process.pid}`);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });

  const files = {};
  const writeFile = (rel, data) => {
    const full = path.join(stagingDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const buf = Buffer.from(JSON.stringify(data));
    fs.writeFileSync(full, buf);
    files[rel] = { sha256: sha256(buf), bytes: buf.length };
  };

  const startedAt = guildOutputs.startedAt;
  const manifestGuilds = {};
  for (const [slug, g] of Object.entries(guildOutputs.guilds)) {
    if (g.status === 'unavailable') {
      manifestGuilds[slug] = { status: 'unavailable', errors: g.errors, counts: g.counts };
      continue;
    }
    writeFile(`guilds/${slug}.json`, g.roster);
    writeFile(`raids/${slug}.json`, g.raids);
    writeFile(`collections/${slug}/index.json`, g.collectionsIndex);
    for (const [key, char] of g.characters) writeFile(`characters/${slug}/${key}.json`, char);
    for (const [key, col] of g.collections) writeFile(`collections/${slug}/${key}.json`, col);
    manifestGuilds[slug] = {
      status: g.status,
      counts: g.counts,
      errors: g.errors.slice(0, 10),
      sourceUpdatedAt: g.roster.updatedAt || g.roster.carriedForwardAt || null,
      files: {
        roster: `guilds/${slug}.json`,
        raids: `raids/${slug}.json`,
        collectionsIndex: `collections/${slug}/index.json`,
      },
    };
  }

  const statuses = Object.values(manifestGuilds).map(g => g.status);
  const overallStatus = statuses.every(s => s === 'fresh') ? 'ok'
    : statuses.every(s => s === 'unavailable') ? 'failed'
    : 'degraded';

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    snapshotId: `${startedAt.replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`,
    startedAt,
    publishedAt: new Date().toISOString(),
    overallStatus,
    expectedRefreshMinutes: EXPECTED_REFRESH_MINUTES,
    region: REGION,
    guilds: manifestGuilds,
    files,
  };
  const manifestBuf = Buffer.from(JSON.stringify(manifest));
  fs.writeFileSync(path.join(stagingDir, 'manifest.json'), manifestBuf);
  return { stagingDir, manifest };
}

// Atomically replace outRoot/v2 with the staging tree.
function publishStaging(outRoot, stagingDir) {
  const v2Root = path.join(outRoot, 'v2');
  const old = path.join(outRoot, `v2.old-${process.pid}`);
  if (fs.existsSync(v2Root)) fs.renameSync(v2Root, old);
  fs.renameSync(stagingDir, v2Root);
  fs.rmSync(old, { recursive: true, force: true });
}

module.exports = {
  SCHEMA_VERSION, REGION, LIMITS,
  identityKey, loadOwnerConfig, loadPrevSnapshot,
  mergeGuild, buildStaging, publishStaging,
};
