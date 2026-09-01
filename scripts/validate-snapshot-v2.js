#!/usr/bin/env node
'use strict';
// Validate a V2 snapshot tree (staged or published). Dependency-free.
//
//   node scripts/validate-snapshot-v2.js [dir] [--allow-missing]
//
// The builder runs this against the STAGING directory before publishing —
// validation failure means nothing is published and last-known-good stays
// live. The workflow and CI run it again on the final tree. --allow-missing
// exits 0 when the directory does not exist (CI on a branch that has never
// produced V2 data). Schema validation is never bypassable by the sanity
// override.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Guild list comes from config/dashboard-config.json (fallback keeps the
// validator usable standalone if the config is unreadable).
let EXPECTED_GUILDS = ['deaths-edge', 'riot-act'];
try {
  EXPECTED_GUILDS = require('./lib/config').loadConfig().guilds.map(g => g.slug);
} catch (err) {
  // Loud fallback: a broken config must not silently shrink the guild list.
  console.error(`WARNING: dashboard config unreadable (${err.message}); validating against fallback guild list ${EXPECTED_GUILDS.join(', ')}`);
}
const FORBIDDEN = [/authorization/i, /bearer /i, /client_secret/i, /access_token/i];
const STATUSES = new Set(['fresh', 'degraded', 'carried_forward', 'unavailable']);

function walkJsonFiles(root) {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue; // never follow links out of the snapshot root
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.json')) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  })(root);
  return out;
}

// A manifest path must stay inside the snapshot directory.
function unsafeRel(rel) {
  return path.isAbsolute(rel) || rel.split('/').includes('..');
}

function validateV2Dir(dir) {
  const errors = [];
  const err = (file, msg) => errors.push(`${file}: ${msg}`);

  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); }
  catch (_) { return [`${dir}: manifest.json missing or unparsable`]; }

  if (manifest.schemaVersion !== 2) err('manifest.json', `schemaVersion must be 2, got ${manifest.schemaVersion}`);
  for (const field of ['snapshotId', 'startedAt', 'publishedAt', 'overallStatus', 'region']) {
    if (!manifest[field]) err('manifest.json', `${field} missing`);
  }
  if (!['ok', 'degraded', 'failed'].includes(manifest.overallStatus)) {
    err('manifest.json', `overallStatus invalid: ${manifest.overallStatus}`);
  }
  if (typeof manifest.guilds !== 'object' || manifest.guilds === null) {
    err('manifest.json', 'guilds missing');
    return errors;
  }
  for (const slug of EXPECTED_GUILDS) {
    if (!manifest.guilds[slug]) err('manifest.json', `guild ${slug} missing from manifest`);
  }

  // Every file listed must exist with a matching hash; every json file in the
  // tree must be listed (no orphans survive a publish).
  const listed = manifest.files || {};
  for (const [rel, meta] of Object.entries(listed)) {
    if (unsafeRel(rel)) { err(rel, 'manifest path escapes the snapshot directory'); continue; }
    const full = path.join(dir, rel);
    if (!fs.existsSync(full)) { err(rel, 'listed in manifest but missing'); continue; }
    const buf = fs.readFileSync(full);
    if (crypto.createHash('sha256').update(buf).digest('hex') !== meta.sha256) err(rel, 'hash mismatch with manifest');
  }
  for (const rel of walkJsonFiles(dir)) {
    if (rel === 'manifest.json') continue;
    if (!listed[rel]) err(rel, 'orphan file not listed in manifest');
    const raw = fs.readFileSync(path.join(dir, rel), 'utf8');
    for (const re of FORBIDDEN) {
      if (re.test(raw)) err(rel, `contains forbidden string matching ${re}`);
    }
  }

  for (const [slug, g] of Object.entries(manifest.guilds)) {
    if (!STATUSES.has(g.status)) err('manifest.json', `guild ${slug} status invalid: ${g.status}`);
    if (g.status === 'unavailable') continue;

    let roster;
    let rosterRaw;
    try {
      rosterRaw = fs.readFileSync(path.join(dir, `guilds/${slug}.json`), 'utf8');
      roster = JSON.parse(rosterRaw);
    } catch (_) { err(`guilds/${slug}.json`, 'missing or unparsable'); continue; }
    // Performance budget: the roster summary is the initial page load — it
    // must stay small without opening detail files.
    if (rosterRaw.length > 200000) {
      err(`guilds/${slug}.json`, `roster summary is ${rosterRaw.length} bytes — exceeds the 200KB initial-load budget`);
    }
    if (!Array.isArray(roster.members) || roster.members.length < 1) {
      err(`guilds/${slug}.json`, 'members must be a non-empty array');
      continue;
    }
    const COMPONENT_STATES = new Set(['fresh', 'carried_forward', 'unavailable', 'not_tracked']);
    roster.members.forEach((m, i) => {
      if (typeof m.id !== 'number') err(`guilds/${slug}.json`, `members[${i}].id must be a number (stable identity)`);
      if (!m.name) err(`guilds/${slug}.json`, `members[${i}].name missing`);
      if (!m.realmSlug) err(`guilds/${slug}.json`, `members[${i}].realmSlug missing`);
      if (!m.components) { err(`guilds/${slug}.json`, `members[${i}].components missing`); return; }
      for (const [comp, state] of Object.entries(m.components)) {
        if (!COMPONENT_STATES.has(state)) {
          err(`guilds/${slug}.json`, `members[${i}].components.${comp} has undocumented state '${state}'`);
        }
      }
    });

    for (const rel of Object.values(g.files || {})) {
      if (!fs.existsSync(path.join(dir, rel))) err(rel, `guild ${slug} references missing file`);
    }

    // Character files: identity + detail shape.
    const charDir = path.join(dir, 'characters', slug);
    if (fs.existsSync(charDir)) {
      for (const f of fs.readdirSync(charDir)) {
        let c;
        try { c = JSON.parse(fs.readFileSync(path.join(charDir, f), 'utf8')); }
        catch (_) { err(`characters/${slug}/${f}`, 'unparsable'); continue; }
        if (!c.identity || typeof c.identity.id !== 'number') err(`characters/${slug}/${f}`, 'identity.id missing');
        // null = piece explicitly unavailable (never a fabricated empty array).
        if (!c.detail || (c.detail.equipment !== null && !Array.isArray(c.detail.equipment))) {
          err(`characters/${slug}/${f}`, 'detail.equipment must be an array or null');
        }
        if (`${manifest.region}-${c.identity.realmSlug}-${c.identity.id}.json` !== f) {
          err(`characters/${slug}/${f}`, 'filename does not match identity key');
        }
      }
    }

    // Collections index entries must point at existing per-character files.
    try {
      const idx = JSON.parse(fs.readFileSync(path.join(dir, `collections/${slug}/index.json`), 'utf8'));
      for (const key of Object.keys(idx.characters || {})) {
        if (!fs.existsSync(path.join(dir, 'collections', slug, `${key}.json`))) {
          err(`collections/${slug}/index.json`, `entry ${key} has no backing file`);
        }
      }
    } catch (_) { err(`collections/${slug}/index.json`, 'missing or unparsable'); }
  }

  return errors;
}

if (require.main === module) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const allowMissing = process.argv.includes('--allow-missing');
  const dir = args[0] || path.join(__dirname, '..', 'docs', 'data', 'v2');
  if (!fs.existsSync(dir)) {
    if (allowMissing) { console.log(`V2 snapshot dir ${dir} absent — skipping (allowed).`); process.exit(0); }
    console.error(`V2 snapshot dir ${dir} does not exist`);
    process.exit(1);
  }
  const problems = validateV2Dir(dir);
  if (problems.length) {
    console.error(`V2 snapshot validation FAILED (${problems.length} problems):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`V2 snapshot validation passed for ${dir}`);
}

module.exports = { validateV2Dir, EXPECTED_GUILDS };
