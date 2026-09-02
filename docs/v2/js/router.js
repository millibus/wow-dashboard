// URL <-> state sync. Only the query string is touched, so deep links work at
// both the Pages subpath (/wow-dashboard/v2/) and a custom-domain /v2/ root.
// Navigation (guild, tab, open character) uses pushState; rapid-fire filter /
// search / sort changes use replaceState so Back doesn't replay keystrokes.
// popstate applies the URL without writing history again.

const NAV_KEYS = ['guild', 'tab', 'char'];
const FILTER_KEYS = ['q', 'sort', 'scope', 'owners', 'classes', 'races', 'minlvl', 'compare',
  'risk', 'metric', 'tier', 'diff', 'pc', 'kind', 'rarity', 'fav'];

export function readUrl() {
  const p = new URLSearchParams(location.search);
  const tierId = Number(p.get('tier'));
  const minLevel = Number(p.get('minlvl'));
  // De-duplicated: ?compare=k,k would otherwise open a self-comparison.
  const compareKeys = [...new Set((p.get('compare') || '').split(',').filter(Boolean))].slice(0, 2);
  return {
    guild: p.get('guild') || null,
    tab: p.get('tab') || 'roster',
    detailKey: p.get('char') || null,
    search: p.get('q') || '',
    sort: p.get('sort') || 'ilvl',
    scope: p.get('scope') || 'active',
    owners: new Set((p.get('owners') || '').split(',').filter(Boolean)),
    classes: new Set((p.get('classes') || '').split(',').filter(Boolean)),
    races: new Set((p.get('races') || '').split(',').filter(Boolean)),
    minLevel: Number.isFinite(minLevel) && minLevel > 0 ? minLevel : 0,
    compareMode: p.has('compare'),
    compareKeys,
    risk: p.get('risk') || null,
    category: p.get('metric') || 'ilvl',
    tierId: Number.isFinite(tierId) && tierId > 0 ? tierId : null,
    difficulty: p.get('diff') || 'normal',
    collectionKey: p.get('pc') || null,
    collectionKind: p.get('kind') || 'pets',
    rarity: p.get('rarity') || null,
    favoritesOnly: p.get('fav') === '1',
  };
}

function buildQuery(s) {
  const p = new URLSearchParams();
  if (s.guild) p.set('guild', s.guild);
  if (s.tab && s.tab !== 'roster') p.set('tab', s.tab);
  if (s.detailKey) p.set('char', s.detailKey);
  if (s.search) p.set('q', s.search);
  if (s.sort && s.sort !== 'ilvl') p.set('sort', s.sort);
  if (s.scope && s.scope !== 'active') p.set('scope', s.scope);
  if (s.owners?.size) p.set('owners', [...s.owners].sort().join(','));
  if (s.classes?.size) p.set('classes', [...s.classes].sort().join(','));
  if (s.races?.size) p.set('races', [...s.races].sort().join(','));
  if (s.minLevel) p.set('minlvl', String(s.minLevel));
  // `compare` present = compare mode on; its value = the picked keys, so a
  // two-character comparison is itself a shareable link.
  if (s.tab === 'roster' && s.compareMode) p.set('compare', (s.compareKeys || []).join(','));
  // Per-view state is only carried in the URL while its own tab is open, so a
  // deep link stays about what the reader is actually looking at.
  if (s.tab === 'readiness' && s.risk) p.set('risk', s.risk);
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
  const url = location.pathname + query;
  // Opening a comparison is navigation (Back should close it); picking the
  // first of the two is not.
  const isNav = changedKeys.some(k => k === 'guild' || k === 'tab' || k === 'detailKey')
    || (changedKeys.includes('compareKeys') && (state.compareKeys || []).length === 2);
  if (isNav) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
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
