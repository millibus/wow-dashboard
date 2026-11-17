// URL <-> state sync. Only the query string is touched, so deep links work at
// both the Pages subpath (/wow-dashboard/) and a custom-domain root.
// Navigation (game, guild, tab, open character) uses pushState; rapid-fire
// filter / search / sort changes use replaceState so Back doesn't replay
// keystrokes. popstate applies the URL without writing history again.

const NAV_KEYS = ['game', 'guild', 'tab', 'char'];
const FILTER_KEYS = ['q', 'sort', 'scope', 'owners', 'classes', 'races', 'minlvl', 'compare',
  'metric', 'tier', 'diff', 'pc', 'kind', 'rarity', 'fav'];

export const SORTS = ['level', 'recent', 'name', 'class', 'rank'];
export const SCOPES = ['all', 'active', 'archive'];

export function readUrl() {
  const p = new URLSearchParams(location.search);
  const tierId = Number(p.get('tier'));
  const minLevel = Number(p.get('minlvl'));
  // De-duplicated: ?compare=k,k would otherwise open a self-comparison.
  const compareKeys = [...new Set((p.get('compare') || '').split(',').filter(Boolean))].slice(0, 2);
  return {
    // ?game=forever is the only value that leaves Retail; ?game=retail and
    // anything unrecognised are Retail.
    game: p.get('game') === 'forever' ? 'forever' : 'retail',
    guild: p.get('guild') || null,
    // The tab as written: main.js maps retired or unknown tabs (the old
    // ?tab=readiness links) onto the roster.
    tab: p.get('tab') || 'roster',
    detailKey: p.get('char') || null,
    search: p.get('q') || '',
    // Old links carry sort=ilvl; item level is only comparable at the level
    // cap, so that order is now the level sort (level, then item level).
    sort: SORTS.includes(p.get('sort')) ? p.get('sort') : 'level',
    scope: SCOPES.includes(p.get('scope')) ? p.get('scope') : 'all',
    owners: new Set((p.get('owners') || '').split(',').filter(Boolean)),
    classes: new Set((p.get('classes') || '').split(',').filter(Boolean)),
    races: new Set((p.get('races') || '').split(',').filter(Boolean)),
    minLevel: Number.isFinite(minLevel) && minLevel > 0 ? minLevel : 0,
    compareMode: p.has('compare'),
    compareKeys,
    category: p.get('metric') || 'ilvl',
    tierId: Number.isFinite(tierId) && tierId > 0 ? tierId : null,
    difficulty: p.get('diff') || 'normal',
    collectionKey: p.get('pc') || null,
    collectionKind: p.get('kind') || 'pets',
    rarity: p.get('rarity') || null,
    favoritesOnly: p.get('fav') === '1',
  };
}

export function buildQuery(s) {
  const p = new URLSearchParams();
  // Retail is the default game and stays out of the URL; Forever is explicit.
  if (s.game === 'forever') p.set('game', 'forever');
  if (s.guild) p.set('guild', s.guild);
  if (s.tab && s.tab !== 'roster') p.set('tab', s.tab);
  if (s.detailKey) p.set('char', s.detailKey);
  if (s.search) p.set('q', s.search);
  if (s.sort && s.sort !== 'level') p.set('sort', s.sort);
  if (s.scope && s.scope !== 'all') p.set('scope', s.scope);
  if (s.owners?.size) p.set('owners', [...s.owners].sort().join(','));
  if (s.classes?.size) p.set('classes', [...s.classes].sort().join(','));
  if (s.races?.size) p.set('races', [...s.races].sort().join(','));
  if (s.minLevel) p.set('minlvl', String(s.minLevel));
  // `compare` present = compare mode on; its value = the picked keys, so a
  // two-character comparison is itself a shareable link.
  if (s.tab === 'roster' && s.compareMode) p.set('compare', (s.compareKeys || []).join(','));
  // Per-view state is only carried in the URL while its own tab is open, so a
  // deep link stays about what the reader is actually looking at.
  if (s.tab === 'leaderboard' && s.category && s.category !== 'ilvl') p.set('metric', s.category);
  if (s.tab === 'raids') {
    if (s.tierId) p.set('tier', String(s.tierId));
    if (s.difficulty && s.difficulty !== 'normal') p.set('diff', s.difficulty);
  }
  if (s.tab === 'collections') {
    if (s.collectionKey) p.set('pc', s.collectionKey);
    if (s.collectionKind && s.collectionKind !== 'pets') p.set('kind', s.collectionKind);
    if (s.rarity) p.set('rarity', s.rarity);
    if (s.favoritesOnly) p.set('fav', '1');
  }
  const q = p.toString();
  return q ? `?${q}` : '';
}

let applyingPopstate = false;

export function syncUrl(state, changedKeys) {
  if (applyingPopstate) return;
  const query = buildQuery(state);
  if (query === location.search) return;
  const url = location.pathname + query + location.hash;
  // Opening a comparison is navigation (Back should close it); picking the
  // first of the two is not.
  const isNav = changedKeys.some(k => k === 'game' || k === 'guild' || k === 'tab' || k === 'detailKey')
    || (changedKeys.includes('compareKeys') && (state.compareKeys || []).length === 2);
  if (isNav) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}

// Rewrite the address in place (no history entry). Used once at boot when a
// retired link — ?tab=readiness — was mapped onto the roster, so the address
// bar stops advertising a view that no longer exists.
export function normalizeUrl(state) {
  const query = buildQuery(state);
  if (query !== location.search) history.replaceState(null, '', location.pathname + query + location.hash);
}

// Wire popstate: `apply(urlState)` must update the store; the guard stops the
// resulting state change from being re-written into history.
export function onPopstate(apply) {
  window.addEventListener('popstate', () => {
    applyingPopstate = true;
    try { apply(readUrl()); }
    finally { applyingPopstate = false; }
  });
}

export { NAV_KEYS, FILTER_KEYS };
