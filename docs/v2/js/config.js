// Static presentation constants only. Everything data-driven (guilds, level
// cap, archive threshold, owners) comes from the snapshot manifest's `config`
// projection — the UI never hardcodes those.

export const DATA_BASE = '../data/v2/';

// Canonical Blizzard class colors — used for NON-TEXT accents only (card
// rails, swatches, monogram tints, meter fills), where contrast minimums do
// not apply and the identity should be exact.
export const CLASS_COLORS = {
  'Death Knight': '#C41E3A',
  'Demon Hunter': '#A330C9',
  'Druid': '#FF7C0A',
  'Evoker': '#33937F',
  'Hunter': '#AAD372',
  'Mage': '#3FC7EB',
  'Monk': '#00FF98',
  'Paladin': '#F48CBA',
  'Priest': '#FFFFFF',
  'Rogue': '#FFF468',
  'Shaman': '#0070DD',
  'Warlock': '#8788EE',
  'Warrior': '#C69B3A',
};

// Same hues, lightened just far enough to clear WCAG AA (4.5:1) on the darkest
// surface a character name sits on. Four classes needed it; the rest are the
// canonical value unchanged. Use these wherever the color paints TEXT.
export const CLASS_INK = {
  ...CLASS_COLORS,
  'Death Knight': '#D66275',
  'Demon Hunter': '#B962D6',
  'Evoker': '#379582',
  'Shaman': '#2E8AE3',
};

export const OWNER_COLORS = {
  user1: '#e8c96a',
  user2: '#7db3e8',
  user3: '#9ae87d',
};

export const TABS = [
  { id: 'roster', label: 'Roster' },
  { id: 'readiness', label: 'Readiness' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'raids', label: 'Raids' },
  { id: 'collections', label: 'Collections' },
];

// Raid difficulties, lowest first. `key` matches the kill counters in
// raids/{slug}.json; `color` drives the tier progress meters.
export const DIFFICULTIES = [
  { key: 'normal', label: 'Normal', color: 'var(--green)' },
  { key: 'heroic', label: 'Heroic', color: 'var(--gold-light)' },
  { key: 'mythic', label: 'Mythic', color: '#a330c9' },
];

// Fallback only — manifest.config.readiness is authoritative.
export const READINESS_DEFAULTS = {
  minLevel: 80, ilvlFloor: 520, ilvlTarget: 610,
  belowLevelPenalty: 25, readyScore: 80, watchScore: 60,
};

// Freshness thresholds against manifest.publishedAt.
export const FRESHNESS = {
  freshMaxMs: 2 * 3600e3,   // < 2h: fresh
  agingMaxMs: 24 * 3600e3,  // 2–24h: aging; > 24h: stale banner (warn)
  alertMaxMs: 7 * 86400e3,  // > 7d: stale banner (alert)
};

export function classColor(className) {
  return CLASS_COLORS[className] || '#c8a84b';
}

// Readable class color for text.
export function classInk(className) {
  return CLASS_INK[className] || '#e8c96a';
}

export function ownerColor(owner) {
  return OWNER_COLORS[owner] || '#6b7186';
}
