// Boot + orchestration. State lives in state.js; the URL mirrors it via
// router.js; views render from it. Data comes exclusively from the V2
// snapshot (manifest first, everything else hash-busted through it).

import { el, clear, icon } from './dom.js';
import { fetchManifest, fetchSnapshotFile, checkForUpdates, identityKey, relAge } from './api.js';
import { getState, setState, subscribe } from './state.js';
import { readUrl, syncUrl, onPopstate } from './router.js';
import { renderFreshness, renderStaleBanner } from './views/banner.js';
import { renderFilters, renderStats, renderRoster, filterMembers } from './views/roster.js';
import { renderReadinessFilters, renderReadiness } from './views/readiness.js';
import { renderLeaderboardFilters, renderLeaderboard } from './views/leaderboard.js';
import { renderRaidFilters, renderRaids } from './views/raids.js';
import { renderCollectionFilters, renderCollections, ensureCollection } from './views/collections.js';
import { setupDialog, openDetail } from './views/detail.js';
import { setupCompareDialog, openCompare } from './views/compare.js';
import { TABS } from './config.js';

const $ = id => document.getElementById(id);
const ui = {
  title: $('guild-title'),
  subtitle: $('guild-subtitle'),
  switcher: $('guild-switcher'),
  freshness: $('freshness'),
  banner: $('stale-banner'),
  checkUpdates: $('check-updates'),
  updateNotice: $('update-notice'),
  tabs: $('tabs'),
  search: $('search'),
  sort: $('sort'),
  compareToggle: $('compare-toggle'),
  compareBar: $('compare-bar'),
  filters: $('filters'),
  stats: $('stats'),
  resultCount: $('result-count'),
  view: $('view'),
  bottomNav: $('bottom-nav'),
  dialog: $('detail-dialog'),
  compareDialog: $('compare-dialog'),
};

const NAV_ICONS = {
  roster: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4 20c0-3.3 3.6-5 8-5s8 1.7 8 5'],
  readiness: ['M12 3l7 3v5c0 4.3-2.9 8.2-7 9.5C7.9 19.2 5 15.3 5 11V6l7-3Z', 'M9 12l2 2 4-4'],
  leaderboard: ['M5 20V10M12 20V4M19 20v-7'],
  raids: ['M4 4l16 16M20 4L4 20', 'M4 4v4M4 4h4M20 4v4M20 4h-4'],
  collections: ['M4 7h16v13H4Z', 'M8 7V4h8v3'],
};

function guildList(manifest) {
  const fromConfig = manifest?.config?.guilds;
  if (Array.isArray(fromConfig) && fromConfig.length) return fromConfig.map(g => g.slug);
  return Object.keys(manifest?.guilds || {});
}

function titleFromSlug(slug) {
  return String(slug || '').split('-').filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// --- Data loading -----------------------------------------------------------

// In-flight fetches keyed by "kind:slug" so a state change during a load
// cannot start the same request twice.
const inflight = new Map();
function once(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function loadRoster(slug) {
  return once(`roster:${slug}`, async () => {
    const { manifest } = getState();
    setState({ roster: null, loadError: null });
    try {
      const roster = await fetchSnapshotFile(manifest, `guilds/${slug}.json`);
      if (getState().guild !== slug) return; // superseded by another switch
      setState({ roster });
    } catch (err) {
      if (getState().guild !== slug) return;
      setState({ roster: null, loadError: String(err?.message || err) });
    }
  });
}

// Raids and collections are fetched only when their tab is first opened, and
// only for the active guild — the roster view never pays for them.
function loadRaids(slug) {
  const state = getState();
  if (state.raids && state.raids.slug === slug) return Promise.resolve();
  return once(`raids:${slug}`, async () => {
    const [raids, catalog] = await Promise.all([
      fetchSnapshotFile(state.manifest, `raids/${slug}.json`).catch(() => null),
      state.catalog !== undefined
        ? Promise.resolve(state.catalog)
        : fetchSnapshotFile(state.manifest, 'raid-catalog.json').catch(() => null),
    ]);
    if (getState().guild !== slug) return;
    const tiers = catalog?.tiers || [];
    const tierId = tiers.some(t => t.id === getState().tierId) ? getState().tierId : (tiers[0]?.id ?? null);
    setState({ raids: raids ? { ...raids, slug } : null, catalog: catalog ?? null, tierId });
  });
}

function loadCollectionsIndex(slug) {
  const state = getState();
  if (state.collectionsIndex && state.collectionsIndex.slug === slug) return Promise.resolve();
  return once(`collections:${slug}`, async () => {
    const index = await fetchSnapshotFile(state.manifest, `collections/${slug}/index.json`)
      .catch(() => ({ characters: {} }));
    if (getState().guild !== slug) return;
    const keys = Object.keys(index.characters || {});
    const collectionKey = keys.includes(getState().collectionKey) ? getState().collectionKey : (keys[0] || null);
    setState({ collectionsIndex: { ...index, slug }, collectionKey });
  });
}

// Kick off whatever the active tab needs; safe to call on every render.
function ensureTabData(state) {
  if (!state.guild || !state.manifest) return;
  if (state.tab === 'raids') loadRaids(state.guild);
  if (state.tab === 'collections') {
    if (!state.collectionsIndex || state.collectionsIndex.slug !== state.guild) loadCollectionsIndex(state.guild);
    else ensureCollection(state, setState);
  }
}

// --- Header / nav rendering -------------------------------------------------

function renderSwitcher(state) {
  clear(ui.switcher);
  const slugs = guildList(state.manifest);
  if (slugs.length < 2) { ui.switcher.hidden = slugs.length === 0; }
  for (const slug of slugs) {
    ui.switcher.append(el('button', {
      type: 'button',
      'aria-pressed': String(slug === state.guild),
      text: titleFromSlug(slug),
      onclick: () => switchGuild(slug),
    }));
  }
}

// Guild name, realm, and region all come from the data — nothing here is a
// constant that would go stale on a transfer or a second region.
function renderHeaderText(state) {
  const name = state.roster?.guild || titleFromSlug(state.guild || '');
  if (name) ui.title.textContent = name;
  const cfgGuild = (state.manifest?.config?.guilds || []).find(g => g.slug === state.guild);
  const realm = state.roster?.realm || (cfgGuild?.realm ? titleFromSlug(cfgGuild.realm) : null);
  const region = (state.manifest?.config?.region || state.manifest?.region || '').toUpperCase();
  const where = [realm, region].filter(Boolean).join('-');
  ui.subtitle.textContent = where ? `${where} · Guild Dashboard` : 'Guild Dashboard';
  document.title = `${name || 'Guild'} — Guild Dashboard`;
}

function renderTabs(state) {
  clear(ui.tabs);
  clear(ui.bottomNav);
  TABS.forEach((tab, i) => {
    const selected = state.tab === tab.id;
    ui.tabs.append(el('button', {
      type: 'button', role: 'tab', id: `tab-${tab.id}`,
      'aria-selected': String(selected),
      'aria-controls': 'view',
      tabindex: selected ? '0' : '-1',
      text: tab.label,
      onclick: () => setState({ tab: tab.id }),
      onkeydown: e => tabKeydown(e, i),
    }));
    const btn = el('button', {
      type: 'button', 'aria-current': selected ? 'true' : null,
      onclick: () => setState({ tab: tab.id }),
    }, icon(NAV_ICONS[tab.id] || [], { size: 20 }), el('span', { text: tab.label }));
    ui.bottomNav.append(btn);
  });
}

function tabKeydown(e, index) {
  const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (!dir) return;
  e.preventDefault();
  const next = TABS[(index + dir + TABS.length) % TABS.length];
  setState({ tab: next.id });
  document.getElementById(`tab-${next.id}`)?.focus();
}

// --- Views ------------------------------------------------------------------

// A roster card click opens the detail — or, in compare mode, toggles the
// card's selection; the comparison opens itself at two.
const openMember = member => {
  const state = getState();
  if (state.tab === 'roster' && state.compareMode) {
    const key = identityKey(member);
    const keys = state.compareKeys.includes(key)
      ? state.compareKeys.filter(k => k !== key)
      : [...state.compareKeys, key].slice(-2);
    setState({ compareKeys: keys });
    return;
  }
  setState({ detailKey: identityKey(member) });
};

const actions = {
  // Roster
  setScope: scope => setState({ scope }),
  toggleOwner: owner => setState({ owners: toggled(getState().owners, owner) }),
  toggleClass: cls => setState({ classes: toggled(getState().classes, cls) }),
  toggleRace: race => setState({ races: toggled(getState().races, race) }),
  setMinLevel: minLevel => setState({ minLevel }),
  // Readiness
  setRisk: risk => setState({ risk }),
  // Leaderboard
  setCategory: category => setState({ category }),
  // Raids
  setTier: tierId => setState({ tierId }),
  setDifficulty: difficulty => setState({ difficulty }),
  // Collections
  setCollectionKey: collectionKey => setState({ collectionKey }),
  setCollectionKind: collectionKind => setState({ collectionKind, rarity: null }),
  setRarity: rarity => setState({ rarity }),
  toggleFavorites: () => setState({ favoritesOnly: !getState().favoritesOnly }),
};

function toggled(set, value) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
}

function renderCompareBar(state) {
  const active = state.tab === 'roster' && state.compareMode;
  ui.compareToggle.setAttribute('aria-pressed', String(!!state.compareMode));
  ui.compareBar.hidden = !active;
  clear(ui.compareBar);
  if (!active) return;
  const picked = state.compareKeys
    .map(k => (state.roster?.members || []).find(m => identityKey(m) === k)?.name)
    .filter(Boolean);
  const text = picked.length === 0 ? 'Compare: pick two characters.'
    : picked.length === 1 ? `Compare: ${picked[0]} selected — pick one more.`
    : `Comparing ${picked[0]} and ${picked[1]}.`;
  ui.compareBar.append(
    el('span', { text }),
    el('button', {
      class: 'btn btn-quiet', type: 'button', text: 'Exit compare',
      onclick: () => setState({ compareMode: false, compareKeys: [] }),
    }),
  );
}

function renderView(state) {
  // The search/sort toolbar and the summary strip belong to the roster only.
  const isRoster = state.tab === 'roster';
  document.querySelector('.tabs-bar .toolbar').hidden = !isRoster;
  ui.stats.hidden = !isRoster;
  ui.resultCount.hidden = !isRoster;
  if (!isRoster) {
    clear(ui.stats);
    ui.resultCount.textContent = '';
  }
  renderCompareBar(state);

  // Every view is a projection of the roster, so its load state gates them all.
  if (state.loadError) {
    clear(ui.filters);
    clear(ui.view);
    ui.view.append(el('div', { class: 'empty-state' },
      el('p', { text: 'The roster could not be loaded.' }),
      el('button', { class: 'btn', type: 'button', text: 'Try again', onclick: () => loadRoster(state.guild) }),
    ));
    return;
  }
  if (!state.roster) {
    clear(ui.filters);
    clear(ui.view);
    ui.view.append(el('div', { class: 'empty-state' }, el('p', { text: 'Loading roster…' })));
    return;
  }

  switch (state.tab) {
    case 'readiness':
      renderReadinessFilters(ui.filters, state, actions);
      renderReadiness(ui.view, state, openMember);
      break;
    case 'leaderboard':
      renderLeaderboardFilters(ui.filters, state, actions);
      renderLeaderboard(ui.view, state, openMember);
      break;
    case 'raids':
      renderRaidFilters(ui.filters, state, actions);
      renderRaids(ui.view, state, openMember);
      break;
    case 'collections':
      renderCollectionFilters(ui.filters, state, actions);
      renderCollections(ui.view, state);
      break;
    default: {
      const filtered = filterMembers(state);
      renderFilters(ui.filters, state, actions);
      renderStats(ui.stats, filtered);
      const scoped = (state.roster.members || []).filter(m => m.owner).length;
      ui.resultCount.textContent = `Showing ${filtered.length} of ${scoped} characters`;
      renderRoster(ui.view, filtered, openMember, {
        active: state.compareMode, selected: new Set(state.compareKeys),
      });
    }
  }
}

// --- Dialogs ----------------------------------------------------------------

function syncDialog(state) {
  if (!state.detailKey) {
    if (ui.dialog.open) ui.dialog.close();
    return;
  }
  const member = (state.roster?.members || []).find(m => identityKey(m) === state.detailKey);
  if (!member) return; // roster still loading; re-checked on the roster update
  if (ui.dialog.dataset.key === state.detailKey && ui.dialog.open) return;
  openDetail(ui.dialog, member, state);
}

function syncCompareDialog(state) {
  const keys = state.tab === 'roster' && state.compareMode ? state.compareKeys : [];
  if (keys.length < 2) {
    if (ui.compareDialog.open) ui.compareDialog.close();
    return;
  }
  const members = keys.map(k => (state.roster?.members || []).find(m => identityKey(m) === k));
  if (members.some(m => !m)) return;
  if (ui.compareDialog.open && ui.compareDialog.dataset.keys === keys.join(',')) return;
  openCompare(ui.compareDialog, members, state);
}

// --- Check for updates ------------------------------------------------------

let noticeTimer = null;
async function onCheckUpdates() {
  ui.checkUpdates.disabled = true;
  ui.updateNotice.textContent = 'Checking…';
  try {
    const { updated, manifest } = await checkForUpdates(getState().manifest);
    if (updated) {
      ui.updateNotice.textContent = 'New snapshot found — reloading…';
      location.reload();
      return;
    }
    const age = Date.parse(manifest.publishedAt || '');
    ui.updateNotice.textContent = Number.isFinite(age)
      ? `Up to date (published ${relAge(Math.max(0, Date.now() - age))}).`
      : 'Up to date.';
  } catch (_) {
    ui.updateNotice.textContent = 'Could not reach the snapshot right now.';
  } finally {
    ui.checkUpdates.disabled = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { ui.updateNotice.textContent = ''; }, 8000);
  }
}

// --- Wiring -----------------------------------------------------------------

// Everything keyed to a guild, dropped whenever the guild changes — by the
// switcher or by Back/Forward — so no view can show another guild's rows.
function guildScopedReset() {
  return {
    detailKey: null, owners: new Set(), classes: new Set(), races: new Set(), minLevel: 0, search: '',
    compareKeys: [],
    raids: null, tierId: null,
    collectionsIndex: null, collectionKey: null, collections: {},
  };
}

function switchGuild(slug) {
  if (slug === getState().guild) return;
  setState({ guild: slug, ...guildScopedReset() });
  ui.search.value = '';
  loadRoster(slug);
}

function applyUrl(urlState, { load = false } = {}) {
  const slugs = guildList(getState().manifest);
  const guild = slugs.includes(urlState.guild) ? urlState.guild : slugs[0] || null;
  const guildChanged = guild !== getState().guild;
  setState({
    ...(guildChanged ? guildScopedReset() : {}),
    guild,
    tab: TABS.some(t => t.id === urlState.tab) ? urlState.tab : 'roster',
    detailKey: urlState.detailKey,
    search: urlState.search,
    sort: urlState.sort,
    scope: ['active', 'archive', 'all'].includes(urlState.scope) ? urlState.scope : 'active',
    owners: urlState.owners,
    classes: urlState.classes,
    races: urlState.races,
    minLevel: urlState.minLevel,
    compareMode: urlState.compareMode,
    compareKeys: urlState.compareKeys,
    risk: urlState.risk,
    category: urlState.category,
    tierId: urlState.tierId,
    difficulty: ['normal', 'heroic', 'mythic'].includes(urlState.difficulty) ? urlState.difficulty : 'normal',
    collectionKey: urlState.collectionKey,
    collectionKind: urlState.collectionKind === 'mounts' ? 'mounts' : 'pets',
    rarity: urlState.rarity,
    favoritesOnly: urlState.favoritesOnly,
  });
  ui.search.value = urlState.search;
  ui.sort.value = getState().sort;
  if (load || guildChanged) loadRoster(guild);
}

async function boot() {
  setupDialog(ui.dialog, () => {
    if (getState().detailKey) setState({ detailKey: null });
  });
  // Closing the comparison keeps compare mode on with nothing picked, so the
  // reader can pick the next pair without re-entering the mode.
  setupCompareDialog(ui.compareDialog, () => {
    if (getState().compareKeys.length === 2) setState({ compareKeys: [] });
  });

  ui.search.addEventListener('input', () => setState({ search: ui.search.value }));
  ui.sort.addEventListener('change', () => setState({ sort: ui.sort.value }));
  ui.compareToggle.addEventListener('click', () => {
    const on = !getState().compareMode;
    setState({ compareMode: on, compareKeys: [] });
  });
  ui.checkUpdates.addEventListener('click', onCheckUpdates);
  onPopstate(urlState => applyUrl(urlState));

  // The initial URL must be read and applied to state BEFORE any state
  // change is mirrored back into the URL, or boot would wipe deep links.
  let urlReady = false;

  subscribe((state, changed) => {
    if (urlReady) syncUrl(state, changed);
    if (changed.includes('manifest') || changed.includes('guild')) {
      renderSwitcher(state);
      renderFreshness(ui.freshness, state.manifest);
      renderStaleBanner(ui.banner, state.manifest, state.guild);
    }
    if (changed.includes('roster') || changed.includes('guild') || changed.includes('manifest')) renderHeaderText(state);
    if (changed.includes('tab')) renderTabs(state);
    // Re-render the view only when its inputs changed — a dialog open/close
    // must not rebuild it (that would detach the card focus returns to).
    const viewKeys = [
      'manifest', 'guild', 'roster', 'tab', 'loadError',
      'search', 'sort', 'scope', 'owners', 'classes', 'races', 'minLevel',
      'compareMode', 'compareKeys',
      'risk', 'category',
      'catalog', 'raids', 'tierId', 'difficulty',
      'collectionsIndex', 'collectionKey', 'collectionKind', 'rarity', 'favoritesOnly', 'collections',
    ];
    if (changed.some(k => viewKeys.includes(k))) renderView(state);
    ensureTabData(state);
    syncDialog(state);
    syncCompareDialog(state);
  });

  let manifest = null;
  try {
    manifest = await fetchManifest();
  } catch (_) {
    renderStaleBanner(ui.banner, null, null);
    clear(ui.view);
    ui.view.append(el('div', { class: 'empty-state' },
      el('p', { text: 'Dashboard data is unavailable right now.' }),
      el('button', { class: 'btn', type: 'button', text: 'Retry', onclick: () => location.reload() }),
    ));
    return;
  }

  const initialUrl = readUrl();
  setState({ manifest });
  renderTabs(getState());
  applyUrl(initialUrl, { load: true });
  urlReady = true;
}

boot();
