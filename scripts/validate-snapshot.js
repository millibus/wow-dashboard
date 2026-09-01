#!/usr/bin/env node
'use strict';
// Validate a built snapshot directory before it is committed/deployed.
// Dependency-free by design (runs in the hourly workflow with no extra install).
//
//   node scripts/validate-snapshot.js [dir]   (default: docs/data)
//
// Checks shape and basic sanity of every guild/raid/collections file plus
// generated-at.json, requires the full guild/raid/collections file set for
// every expected guild, and scans raw file text for credential-shaped strings.
// Exits 1 with a list of problems; a failed validation means the workflow
// commits nothing and last-known-good data stays live.

const fs = require('fs');
const path = require('path');

// The frontend requests these fixed slugs; a snapshot missing any of the three
// files for either guild would break the public site. Moves to
// config/dashboard-config.json in a later PR.
const EXPECTED_GUILDS = ['deaths-edge', 'riot-act'];

function isStr(v) { return typeof v === 'string' && v.length > 0; }
function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

// Strings that must never appear in published data, whatever the source.
const FORBIDDEN = [/authorization/i, /bearer /i, /client_secret/i, /access_token/i];

function validateMember(err, file, m, i) {
  if (!isStr(m.name)) err(file, `members[${i}].name missing`);
  if (!isNum(m.level)) err(file, `members[${i}].level missing`);
  if (!isStr(m.className)) err(file, `members[${i}].className missing`);
  if (!Array.isArray(m.equipment)) err(file, `members[${i}].equipment must be an array`);
  if (typeof m.stats !== 'object' || m.stats === null) err(file, `members[${i}].stats missing`);
}

function validateGuildFile(err, file, data) {
  if (!isStr(data.guild)) err(file, 'guild name missing');
  if (!isStr(data.realm)) err(file, 'realm missing');
  if (!Array.isArray(data.members) || data.members.length < 1) {
    err(file, 'members must be a non-empty array');
    return;
  }
  if (!isStr(data.lastUpdated) || Number.isNaN(Date.parse(data.lastUpdated))) {
    err(file, 'lastUpdated must be an ISO timestamp');
  }
  data.members.forEach((m, i) => validateMember(err, file, m, i));
}

function validateRaidFile(err, file, data) {
  if (!Array.isArray(data.tiers)) err(file, 'tiers must be an array');
  if (!Array.isArray(data.members)) { err(file, 'members must be an array'); return; }
  data.members.forEach((m, i) => {
    if (!isStr(m.name)) err(file, `members[${i}].name missing`);
    if (!Array.isArray(m.tiers)) err(file, `members[${i}].tiers must be an array`);
  });
}

function validateCollectionsFile(err, file, data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    err(file, 'must be an object keyed by character name');
    return;
  }
  for (const [name, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== 'object') { err(file, `${name}: entry must be an object`); continue; }
    if (!entry.pets || !isNum(entry.pets.total) || !Array.isArray(entry.pets.pets)) {
      err(file, `${name}: pets shape invalid`);
    }
    if (!entry.mounts || !isNum(entry.mounts.total) || !Array.isArray(entry.mounts.mounts)) {
      err(file, `${name}: mounts shape invalid`);
    }
  }
}

function validateDir(dir, expectedGuilds = EXPECTED_GUILDS) {
  const errors = [];
  const err = (file, msg) => errors.push(`${file}: ${msg}`);

  let names;
  try { names = fs.readdirSync(dir).filter(f => f.endsWith('.json')); }
  catch (_) { errors.push(`${dir}: not a readable directory`); return errors; }

  if (!names.includes('generated-at.json')) err('generated-at.json', 'missing');
  for (const slug of expectedGuilds) {
    for (const prefix of ['guild', 'raid', 'collections']) {
      const expected = `${prefix}-${slug}.json`;
      if (!names.includes(expected)) err(expected, 'missing — the frontend requests this file');
    }
  }

  for (const name of names) {
    const full = path.join(dir, name);
    const raw = fs.readFileSync(full, 'utf8');
    for (const re of FORBIDDEN) {
      if (re.test(raw)) err(name, `contains forbidden string matching ${re}`);
    }
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { err(name, 'not valid JSON'); continue; }

    if (name === 'generated-at.json') {
      if (!isStr(data.ts) || Number.isNaN(Date.parse(data.ts))) err(name, 'ts must be an ISO timestamp');
    } else if (name.startsWith('guild-')) {
      validateGuildFile(err, name, data);
    } else if (name.startsWith('raid-')) {
      validateRaidFile(err, name, data);
    } else if (name.startsWith('collections-')) {
      validateCollectionsFile(err, name, data);
    }
  }
  return errors;
}

if (require.main === module) {
  const dir = process.argv[2] || path.join(__dirname, '..', 'docs', 'data');
  const problems = validateDir(dir);
  if (problems.length) {
    console.error(`Snapshot validation FAILED (${problems.length} problems):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`Snapshot validation passed for ${dir}`);
}

module.exports = { validateDir, EXPECTED_GUILDS };
