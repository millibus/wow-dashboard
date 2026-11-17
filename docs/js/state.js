// Minimal pub-sub store. One state object; set() merges a patch and notifies
// subscribers with (state, changedKeys) so views can skip irrelevant updates.

const state = {
  manifest: null,
  game: 'retail',       // retail | forever (Forever is a coming-soon state)
  guild: null,          // active guild slug
  roster: null,         // loaded guilds/{slug}.json
  tab: 'roster',
  search: '',
  sort: 'level',
  scope: 'all',         // all | active | archive (by last login)
  owners: new Set(),    // empty = all
  classes: new Set(),   // empty = all
  races: new Set(),     // empty = all
  minLevel: 0,          // 0 = any
  filtersOpen: false,   // the class / race / level drawer
  detailKey: null,      // identity key of the open character sheet
  loadError: null,

  // Compare mode: pick two roster rows, see them side by side.
  compareMode: false,
  compareKeys: [],      // 0–2 identity keys; the dialog opens at 2

  // Leaderboard
  category: 'ilvl',

  // Raids
  catalog: undefined,   // undefined = not loaded, null = unavailable
  raids: null,
  tierId: null,
  difficulty: 'normal',

  // Collections
  collectionsIndex: null,
  collectionKey: null,
  collectionKind: 'pets',
  rarity: null,
  favoritesOnly: false,
  collections: {},      // identity key -> file | null (loading) | 'error'
};

const listeners = new Set();

export function getState() { return state; }

export function setState(patch) {
  const changed = [];
  for (const [k, v] of Object.entries(patch)) {
    if (state[k] !== v) { state[k] = v; changed.push(k); }
  }
  if (changed.length) for (const fn of listeners) fn(state, changed);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
