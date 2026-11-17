// Static presentation constants only. Everything data-driven (guilds, level
// cap, archive threshold, owners) comes from the snapshot manifest's `config`
// projection — the UI never hardcodes those.

export const DATA_BASE = 'data/v2/';

// Canonical Blizzard class colors. On the paper pages these are NON-TEXT
// accents only (dots, bars, portrait tints): several of them cannot reach AA
// contrast on ivory, so a class is always also named in ink.
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

// The two games the header switches between. Retail is the live site; Forever
// has no guild yet and renders a designed "coming soon" state, never data.
export const GAMES = ['retail', 'forever'];

export const TABS = [
  { id: 'roster', label: 'Roster' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'raids', label: 'Raids' },
  { id: 'collections', label: 'Collections' },
];

// Raid difficulties, lowest first. `key` matches the kill counters in
// raids/{slug}.json.
export const DIFFICULTIES = [
  { key: 'normal', label: 'Normal', short: 'N' },
  { key: 'heroic', label: 'Heroic', short: 'H' },
  { key: 'mythic', label: 'Mythic', short: 'M' },
];

// Freshness thresholds against manifest.publishedAt.
export const FRESHNESS = {
  freshMaxMs: 2 * 3600e3,   // < 2h: fresh
  agingMaxMs: 24 * 3600e3,  // 2–24h: aging; > 24h: stale banner (warn)
  alertMaxMs: 7 * 86400e3,  // > 7d: stale banner (alert)
};

// Auto-refresh: how often an open, visible tab re-checks the manifest, and how
// often relative ages ("Updated 5 min ago") are re-rendered. The manifest is a
// small no-store fetch, so polling it is cheap; data files are only refetched
// when the snapshot id actually changed.
export const AUTO_REFRESH = {
  pollMs: 5 * 60e3,
  tickMs: 60e3,
};

// The stage ("group photo"). Each full-body render is a 1600x1200 transparent
// PNG of roughly 300–900 KB, so the number loaded is capped per viewport:
// about 2.5 MB on a phone and 5.5 MB on a desktop, measured on the live data.
//
// The render service sends no CORS header, so a figure's bounds cannot be read
// from pixels in the browser. FOOT and HIT are one generic geometry derived
// from bounds measured offline across 57 renders: the feet land within about
// ±20px of y=984 and ±50px of x=808 in every one of them.
export const STAGE = {
  source: { w: 1600, h: 1200 },
  foot: { x: 808, y: 984 },
  hit: { x0: 620, y0: 330, x1: 1000, y1: 992 },
  tiers: [
    { minWidth: 1100, rows: [5, 6], scale: [0.43, 0.34], spacing: 196, lift: 74 },
    { minWidth: 700, rows: [4, 4], scale: [0.4, 0.32], spacing: 172, lift: 64 },
    { minWidth: 0, rows: [3, 2], scale: [0.3, 0.24], spacing: 118, lift: 46 },
  ],
};

// The sheet's arch: one generic crop of the same render (source pixels).
export const SHEET_CROP = { x: 440, y: 205, w: 690, h: 810 };

export function classColor(className) {
  return CLASS_COLORS[className] || '#9a917f';
}

// Owners arrive as opaque ids ("user1"). A label is shown only when the
// manifest supplies one — as `owners: [{ id, label }]` or `ownerLabels: {id:
// label}` — and never when it is just the id again.
export function ownerLabel(manifest, ownerId) {
  if (!ownerId) return null;
  const cfg = manifest?.config || {};
  let label = null;
  if (cfg.ownerLabels && typeof cfg.ownerLabels === 'object') label = cfg.ownerLabels[ownerId];
  if (!label && Array.isArray(cfg.owners)) {
    const entry = cfg.owners.find(o => o && typeof o === 'object' && o.id === ownerId);
    label = entry?.label || entry?.name || null;
  }
  if (typeof label !== 'string') return null;
  label = label.trim();
  if (!label || label === ownerId || /^user\d+$/i.test(label)) return null;
  return label;
}

export function levelCap(manifest) {
  const cap = manifest?.config?.levelCap;
  return Number.isFinite(cap) && cap > 0 ? cap : null;
}
