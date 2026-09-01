'use strict';
// Loader for config/dashboard-config.json — the single source of truth for
// expansion- and guild-shaped constants (region, activeExpansionId, level cap,
// guilds, limits, cadences, tier overrides, life-stat definitions).
//
// SNAPSHOT_CONFIG_PATH is a test seam (point at a modified copy); production
// never sets it. Missing fields fall back to safe defaults so a partially
// edited config degrades loudly in review, not silently at runtime.

const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(__dirname, '..', '..', 'config', 'dashboard-config.json');

const DEFAULTS = {
  region: 'us',
  activeExpansionId: null,
  levelCap: 90,
  raidMinLevel: 80,
  archiveThresholdDays: 30,
  guilds: [],
  limits: { minMembers: 2, maxShrinkPercent: 40, raidMemberCap: 60 },
  cadencesHours: { raids: 4, collections: 24, catalog: 24 },
  expensive: { trackedOnly: true },
  tierOverrides: {},
  lifeStatDefs: [],
  readiness: {
    minLevel: 80, ilvlFloor: 520, ilvlTarget: 610,
    belowLevelPenalty: 25, readyScore: 80, watchScore: 60,
  },
};

let cached = null;
let cachedPath = null;

function loadConfig() {
  const p = process.env.SNAPSHOT_CONFIG_PATH || DEFAULT_PATH;
  if (cached && cachedPath === p) return cached;
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (err) { throw new Error(`dashboard config unreadable at ${p}: ${err.message}`); }
  cached = {
    ...DEFAULTS,
    ...raw,
    limits: { ...DEFAULTS.limits, ...(raw.limits || {}) },
    cadencesHours: { ...DEFAULTS.cadencesHours, ...(raw.cadencesHours || {}) },
    expensive: { ...DEFAULTS.expensive, ...(raw.expensive || {}) },
    readiness: { ...DEFAULTS.readiness, ...(raw.readiness || {}) },
  };
  cachedPath = p;
  return cached;
}

module.exports = { loadConfig, DEFAULT_PATH };
