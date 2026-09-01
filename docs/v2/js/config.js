// Static presentation constants only. Everything data-driven (guilds, level
// cap, archive threshold, owners) comes from the snapshot manifest's `config`
// projection — the UI never hardcodes those.

export const DATA_BASE = '../data/v2/';

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

export const OWNER_COLORS = {
  user1: '#e8c96a',
  user2: '#7db3e8',
  user3: '#9ae87d',
};

export const TABS = [
  { id: 'roster', label: 'Roster' },
  { id: 'raids', label: 'Raids' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'collections', label: 'Collections' },
];

// Freshness thresholds against manifest.publishedAt.
export const FRESHNESS = {
  freshMaxMs: 2 * 3600e3,   // < 2h: fresh
  agingMaxMs: 24 * 3600e3,  // 2–24h: aging; > 24h: stale banner (warn)
  alertMaxMs: 7 * 86400e3,  // > 7d: stale banner (alert)
};

export function classColor(className) {
  return CLASS_COLORS[className] || '#c8a84b';
}

export function ownerColor(owner) {
  return OWNER_COLORS[owner] || '#6b7186';
}
