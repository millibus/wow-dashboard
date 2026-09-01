// URL <-> state sync. Only the query string is touched, so deep links work at
// both the Pages subpath (/wow-dashboard/v2/) and a custom-domain /v2/ root.
// Navigation (guild, tab, open character) uses pushState; rapid-fire filter /
// search / sort changes use replaceState so Back doesn't replay keystrokes.
// popstate applies the URL without writing history again.

const NAV_KEYS = ['guild', 'tab', 'char'];
const FILTER_KEYS = ['q', 'sort', 'scope', 'owners', 'classes'];

export function readUrl() {
  const p = new URLSearchParams(location.search);
  return {
    guild: p.get('guild') || null,
    tab: p.get('tab') || 'roster',
    detailKey: p.get('char') || null,
    search: p.get('q') || '',
    sort: p.get('sort') || 'ilvl',
    scope: p.get('scope') || 'active',
    owners: new Set((p.get('owners') || '').split(',').filter(Boolean)),
    classes: new Set((p.get('classes') || '').split(',').filter(Boolean)),
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
  const q = p.toString();
  return q ? `?${q}` : '';
}

let applyingPopstate = false;

export function syncUrl(state, changedKeys) {
  if (applyingPopstate) return;
  const query = buildQuery(state);
  if (query === location.search) return;
  const url = location.pathname + query;
  const isNav = changedKeys.some(k => k === 'guild' || k === 'tab' || k === 'detailKey');
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
