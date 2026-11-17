// Boot + orchestration. State lives in state.js; the URL mirrors it via
// router.js; views render from it. Data comes exclusively from the V2
// snapshot (manifest first, everything else hash-busted through it).

import { el, clear, icon } from './dom.js';
import { fetchManifest, fetchSnapshotFile, checkForUpdates, identityKey } from './api.js';
import { getState, setState, subscribe } from './state.js';
import { readUrl, syncUrl, normalizeUrl, onPopstate } from './router.js';
import { renderFreshness, renderStaleBanner } from './views/banner.js';
import { renderFilters, renderLead, renderRoster, filterMembers, activeFilterCount } from './views/roster.js';
import { renderLeaderboardFilters, renderLeaderboard } from './views/leaderboard.js';
import { renderRaidFilters, renderRaids } from './views/raids.js';
import { renderCollectionFilters, renderCollections, ensureCollection } from './views/collections.js';
import { setupDialog, openDetail } from './views/detail.js';
import { setupCompareDialog, openCompare } from './views/compare.js';
import { renderStage, fitPoster } from './views/stage.js';
import { renderForever } from './views/forever.js';
import { TABS, AUTO_REFRESH } from './config.js';

const $ = id => document.getElementById(id);
const ui = {
  root: document.documentElement,
  title: $('guild-title'),
  subtitle: $('guild-subtitle'),
  gameSwitch: $('game-switch'),
  switcher: $('guild-switcher'),
  freshness: $('freshness'),
  banner: $('stale-banner'),
  refresh: $('refresh'),
  updateNotice: $('update-notice'),
  stage: $('stage'),
  lineup: $('lineup'),
  captions: $('stage-captions'),
  tabsBar: document.querySelector('.tabs-bar'),
  tabs: $('tabs'),
  viewHead: $('view-head'),
  toolbar: $('toolbar'),
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
  leaderboard: ['M5 20V10M12 20V4M19 20v-7'],
  raids: ['M4 4l16 16M20 4L4 20', 'M4 4v4M4 4h4M20 4v4M20 4h-4'],
  collections: ['M4 7h16v13H4Z', 'M8 7V4h8v3'],
};

const VIEW_TITLES = {
  roster: 'The roster',
  leaderboard: 'Leaderboard',
  raids: 'Raids',
  collections: 'Collections',
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

function factionOf(state, slug = state.guild) {
  const cfgGuild = (state.manifest?.config?.guilds || []).find(g => g.slug === slug);
  const raw = (slug === state.guild && state.roster?.faction) || cfgGuild?.faction || '';
  const f = String(raw).toLowerCase();
  return f === 'horde' || f === 'alliance' ? f : null;
}

// --- Data loading -----------------------------------------------------------

// In-flight fetches keyed by "kind:slug:snapshot" so a state change during a
// load cannot start the same request twice — and a request begun under an
// older snapshot is never joined by (or allowed to answer for) a newer one.
const inflight = new Map();
function once(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function loadRoster(slug) {
  // Clear BEFORE joining any in-flight request: switching A → B → back to A
  // while A's first request is still running must not keep showing B's
  // roster under A's name until A resolves.
  setState({ roster: null, loadError: null });
  const { manifest } = getState();
  // A response (or failure) only counts while the guild AND the snapshot it
  // was requested under are still current: a slow first load must never
  // overwrite the roster a refresh has since swapped in.
  const current = () => getState().guild === slug && getState().manifest === manifest;
  return once(`roster:${slug}:${manifest?.snapshotId}`, async () => {
    try {
      const roster = await fetchSnapshotFile(manifest, `guilds/${slug}.json`);
      if (!current()) return; // superseded by a guild switch or a newer snapshot
      setState({ roster });
    } catch (err) {
      if (!current()) return;
      setState({ roster: null, loadError: String(err?.message || err) });
    }
  });
}

// Raids and collections are fetched only when their tab is first opened, and
// only for the active guild — the roster view never pays for them.
function loadRaids(slug) {
  const state = getState();
  if (state.raids && state.raids.slug === slug) return Promise.resolve();
  const { manifest } = state;
  return once(`raids:${slug}:${manifest.snapshotId}`, async () => {
    const [raids, catalog] = await Promise.all([
      fetchSnapshotFile(manifest, `raids/${slug}.json`).catch(() => null),
      state.catalog !== undefined
        ? Promise.resolve(state.catalog)
        : fetchSnapshotFile(manifest, 'raid-catalog.json').catch(() => null),
    ]);
    if (getState().guild !== slug || getState().manifest !== manifest) return;
    const tiers = catalog?.tiers || [];
    const tierId = tiers.some(t => t.id === getState().tierId) ? getState().tierId : (tiers[0]?.id ?? null);
    setState({ raids: raids ? { ...raids, slug } : null, catalog: catalog ?? null, tierId });
  });
}

function loadCollectionsIndex(slug) {
  const state = getState();
  if (state.collectionsIndex && state.collectionsIndex.slug === slug) return Promise.resolve();
  const { manifest } = state;
  return once(`collections:${slug}:${manifest.snapshotId}`, async () => {
    const index = await fetchSnapshotFile(manifest, `collections/${slug}/index.json`)
      .catch(() => ({ characters: {} }));
    if (getState().guild !== slug || getState().manifest !== manifest) return;
    const keys = Object.keys(index.characters || {});
    const collectionKey = keys.includes(getState().collectionKey) ? getState().collectionKey : (keys[0] || null);
    setState({ collectionsIndex: { ...index, slug }, collectionKey });
  });
}

// Kick off whatever the active tab needs; safe to call on every render.
function ensureTabData(state) {
  if (state.game !== 'retail' || !state.guild || !state.manifest) return;
  if (state.tab === 'raids') loadRaids(state.guild);
  if (state.tab === 'collections') {
    if (!state.collectionsIndex || state.collectionsIndex.slug !== state.guild) loadCollectionsIndex(state.guild);
    else ensureCollection(state, setState);
  }
}

// --- Focus that survives a re-render ----------------------------------------

// Views rebuild their DOM from state, which would drop keyboard focus on the
// control that was just used. Every re-rendered control carries a stable
// `data-fk`; after a render, focus goes back to the control with the same key
// (or to the view itself if that control no longer exists).
function focusToken() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return null;
  return { fk: active.dataset.fk || null, inView: ui.view.contains(active) || ui.filters.contains(active) };
}

function restoreFocus(token) {
  if (!token) return;
  const active = document.activeElement;
  if (active && active !== document.body && document.contains(active)) return; // focus survived or moved on purpose
  if (ui.dialog.open || ui.compareDialog.open) return;
  const target = token.fk ? document.querySelector(`[data-fk="${CSS.escape(token.fk)}"]`) : null;
  if (target instanceof HTMLElement && !target.closest('[hidden]')) target.focus({ preventScroll: true });
  else if (token.inView) ui.view.focus({ preventScroll: true });
}

// --- Header / nav rendering -------------------------------------------------

function renderGameSwitch(state) {
  ui.root.dataset.game = state.game;
  for (const btn of ui.gameSwitch.querySelectorAll('button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.game === state.game));
  }
}

function renderSwitcher(state) {
  clear(ui.switcher);
  const slugs = guildList(state.manifest);
  ui.switcher.hidden = slugs.length < 2 || state.game !== 'retail';
  for (const slug of slugs) {
    const faction = factionOf(state, slug);
    ui.switcher.append(el('button', {
      type: 'button', class: faction ? `guild-btn is-${faction}` : 'guild-btn',
      'aria-pressed': String(slug === state.guild),
      dataset: { fk: `guild:${slug}` },
      onclick: () => switchGuild(slug),
    }, el('span', { class: 'faction-dot', 'aria-hidden': 'true' }), el('span', { text: titleFromSlug(slug) })));
  }
}

// The poster is one <span> per word so the stage can stack and scale it; the
// heading's text content stays the plain guild name.
function setPoster(text) {
  if (ui.title.dataset.text === text) return;
  ui.title.dataset.text = text;
  clear(ui.title);
  text.split(/\s+/).filter(Boolean).forEach((word, i) => {
    if (i) ui.title.append(' ');
    ui.title.append(el('span', { text: word }));
  });
}

// Guild name, realm, and region all come from the data — nothing here is a
// constant that would go stale on a transfer or a second region.
function renderHeaderText(state) {
  if (state.game === 'forever') {
    delete ui.root.dataset.faction;
    setPoster('Forever');
    ui.subtitle.textContent = 'World of Warcraft: Forever';
    document.title = 'Forever — coming soon';
    return;
  }
  const name = state.roster?.guild || titleFromSlug(state.guild || '');
  if (name) setPoster(name);
  const faction = factionOf(state);
  if (faction) ui.root.dataset.faction = faction; else delete ui.root.dataset.faction;
  const cfgGuild = (state.manifest?.config?.guilds || []).find(g => g.slug === state.guild);
  const realm = state.roster?.realm || (cfgGuild?.realm ? titleFromSlug(cfgGuild.realm) : null);
  const region = (state.manifest?.config?.region || state.manifest?.region || '').toUpperCase();
  const where = [realm, region].filter(Boolean).join('-');
  const count = state.roster?.members?.length;
  ui.subtitle.textContent = [
    faction ? faction[0].toUpperCase() + faction.slice(1) : null,
    where || null,
    count ? `${count} ${count === 1 ? 'member' : 'members'}` : null,
  ].filter(Boolean).join(' · ') || 'Loading…';
  document.title = `${name || 'Guild'} — guild roster`;
}

// The browser chrome on a phone takes the banner's colour, so the page reads
// as one piece from the status bar down.
function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  const color = getComputedStyle(ui.root).getPropertyValue('--stage-0').trim();
  if (meta && color) meta.setAttribute('content', color);
}

function renderTabs(state) {
  clear(ui.tabs);
  clear(ui.bottomNav);
  const retail = state.game === 'retail';
  ui.tabsBar.hidden = !retail;
  ui.bottomNav.hidden = !retail;
  if (!retail) return;
  TABS.forEach((tab, i) => {
    const selected = state.tab === tab.id;
    ui.tabs.append(el('button', {
      type: 'button', role: 'tab', id: `tab-${tab.id}`,
      'aria-selected': String(selected),
      'aria-controls': 'view',
      tabindex: selected ? '0' : '-1',
      dataset: { fk: `tab:${tab.id}` },
      text: tab.label,
      onclick: () => setState({ tab: tab.id }),
      onkeydown: e => tabKeydown(e, i),
    }));
    const btn = el('button', {
      type: 'button', 'aria-current': selected ? 'true' : null,
      dataset: { fk: `nav:${tab.id}` },
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

const openSheet = member => setState({ detailKey: identityKey(member) });

// A roster row click opens the sheet — or, in compare mode, toggles the row's
// selection; the comparison opens itself at two.
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
  openSheet(member);
};

const actions = {
  // Roster
  setScope: scope => setState({ scope }),
  setFiltersOpen: filtersOpen => setState({ filtersOpen }),
  toggleOwner: owner => setState({ owners: toggled(getState().owners, owner) }),
  toggleClass: cls => setState({ classes: toggled(getState().classes, cls) }),
  toggleRace: race => setState({ races: toggled(getState().races, race) }),
  setMinLevel: minLevel => setState({ minLevel }),
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
  clearFilters: () => {
    ui.search.value = '';
    setState({ search: '', owners: new Set(), classes: new Set(), races: new Set(), minLevel: 0 });
  },
};

function hasRosterFilters(state) {
  return !!(state.search.trim() || activeFilterCount(state));
}

function toggled(set, value) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value); else next.add(value);
  return next;
}

function renderCompareBar(state) {
  const active = state.game === 'retail' && state.tab === 'roster' && state.compareMode;
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

function setViewHead(title) {
  clear(ui.viewHead);
  ui.viewHead.hidden = !title;
  if (title) ui.viewHead.append(el('h2', { class: 'view-title', text: title }));
}

function emptyBox(...children) {
  return el('div', { class: 'empty-state' }, ...children);
}

function renderUnavailable() {
  clear(ui.filters);
  clear(ui.view);
  ui.view.append(emptyBox(
    el('p', { class: 'empty-title', text: 'Dashboard data is unavailable right now.' }),
    el('p', { class: 'empty-hint', text: 'The previous dashboard may still load the last published data.' }),
    el('div', { class: 'empty-actions' },
      el('button', { class: 'btn', type: 'button', text: 'Retry', onclick: () => location.reload() }),
      el('a', { class: 'btn btn-quiet', href: 'v1/', text: 'Open the previous dashboard' }),
    ),
  ));
}

function renderView(state) {
  const retail = state.game === 'retail';
  // The search/sort toolbar and the lead sentence belong to the roster only.
  const isRoster = retail && state.tab === 'roster';
  ui.toolbar.hidden = !isRoster;
  ui.stats.hidden = !isRoster;
  ui.resultCount.hidden = !isRoster;
  if (!isRoster) {
    clear(ui.stats);
    ui.resultCount.textContent = '';
  }
  renderCompareBar(state);
  ui.view.dataset.tab = retail ? state.tab : 'forever';
  ui.filters.dataset.tab = ui.view.dataset.tab;

  if (!retail) {
    setViewHead(null);
    clear(ui.filters);
    const names = guildList(state.manifest).map(titleFromSlug);
    renderForever(ui.view, { guildNames: names, onRetail: () => switchGame('retail') });
    return;
  }

  setViewHead(VIEW_TITLES[state.tab] || VIEW_TITLES.roster);

  if (state.bootError) { renderUnavailable(); return; }

  // Every view is a projection of the roster, so its load state gates them all.
  if (state.loadError) {
    clear(ui.filters);
    clear(ui.view);
    clear(ui.stats);
    ui.view.append(emptyBox(
      el('p', { class: 'empty-title', text: 'The roster could not be loaded.' }),
      el('button', { class: 'btn', type: 'button', text: 'Try again', onclick: () => loadRoster(state.guild) }),
    ));
    return;
  }
  if (!state.roster) {
    clear(ui.filters);
    clear(ui.view);
    clear(ui.stats);
    ui.view.append(emptyBox(el('p', { class: 'empty-title', text: 'Loading roster…' })));
    return;
  }

  switch (state.tab) {
    case 'leaderboard':
      renderLeaderboardFilters(ui.filters, state, actions);
      renderLeaderboard(ui.view, state, openSheet, actions);
      break;
    case 'raids':
      renderRaidFilters(ui.filters, state, actions);
      renderRaids(ui.view, state, openSheet);
      break;
    case 'collections':
      renderCollectionFilters(ui.filters, state, actions);
      renderCollections(ui.view, state);
      break;
    default: {
      const filtered = filterMembers(state);
      const total = (state.roster.members || []).length;
      renderLead(ui.stats, state);
      renderFilters(ui.filters, state, actions);
      const narrowed = filtered.length !== total;
      ui.resultCount.textContent = narrowed ? `Showing ${filtered.length} of ${total} characters` : '';
      ui.resultCount.classList.toggle('is-empty', !narrowed);
      renderRoster(ui.view, filtered, state, openMember, {
        active: state.compareMode, selected: new Set(state.compareKeys),
      }, {
        hasFilters: hasRosterFilters(state),
        onClearFilters: actions.clearFilters,
        scope: state.scope,
        total,
        onShowAll: () => actions.setScope('all'),
      });
    }
  }
}

const stageUi = {
  stage: ui.stage, title: ui.title, lineup: ui.lineup, captions: ui.captions,
  rerenderStage: () => renderStage(stageUi, getState(), openSheet),
};

// --- Dialogs ----------------------------------------------------------------

function syncDialog(state) {
  if (!state.detailKey || state.game !== 'retail') {
    if (ui.dialog.open) ui.dialog.close();
    return;
  }
  const member = (state.roster?.members || []).find(m => identityKey(m) === state.detailKey);
  if (!member) return; // roster still loading; re-checked on the roster update
  // Same sheet AND same snapshot: nothing to do. A refresh that swapped in a
  // newer snapshot re-renders the open sheet in place.
  const snap = state.manifest?.snapshotId || '';
  if (ui.dialog.dataset.key === state.detailKey && ui.dialog.open && ui.dialog.dataset.snap === snap) return;
  openDetail(ui.dialog, member, state, { onOpen: openSheet });
}

function syncCompareDialog(state) {
  const keys = state.game === 'retail' && state.tab === 'roster' && state.compareMode ? state.compareKeys : [];
  if (keys.length < 2) {
    if (ui.compareDialog.open) ui.compareDialog.close();
    return;
  }
  const members = keys.map(k => (state.roster?.members || []).find(m => identityKey(m) === k));
  if (members.some(m => !m)) return;
  const snap = state.manifest?.snapshotId || '';
  if (ui.compareDialog.open && ui.compareDialog.dataset.keys === keys.join(',')
    && ui.compareDialog.dataset.snap === snap) return;
  openCompare(ui.compareDialog, members, state);
}

// --- Refresh (manual + automatic) ------------------------------------------

// One code path for both: refetch the manifest (no-store) and, only when the
// snapshot id changed, swap the new snapshot in place — filters, tab, and
// scroll position survive, and nothing flashes back to a loading state. This
// can only ever discover a snapshot the pipeline already published; nothing
// in the browser can ask Blizzard for anything.
let refreshing = null;
let lastCheckAt = 0;
let noticeTimer = null;

function showNotice(text) {
  ui.updateNotice.textContent = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { ui.updateNotice.textContent = ''; }, 8000);
}

function setRefreshBusy(busy) {
  ui.refresh.disabled = busy;
  ui.refresh.setAttribute('aria-busy', String(busy));
  ui.refresh.classList.toggle('is-busy', busy);
}

async function applySnapshot(manifest) {
  const slug = getState().guild;
  // Fetch the new roster BEFORE adopting the new manifest, then switch both
  // in one update: the old roster stays on screen until the new one is in
  // hand, and a failed fetch leaves the old snapshot fully in place, so the
  // next check still sees the new snapshot id as new and retries.
  const roster = slug ? await fetchSnapshotFile(manifest, `guilds/${slug}.json`) : null;
  if (getState().guild !== slug) return; // switched guilds meanwhile; the next check catches up
  setState({
    manifest,
    ...(slug ? { roster, loadError: null } : {}),
    // Everything else cached from the old snapshot is refetched on demand.
    catalog: undefined, raids: null,
    collectionsIndex: null, collections: {},
  });
}

function refresh({ manual = false } = {}) {
  if (refreshing) return refreshing;
  const current = getState().manifest;
  if (!current) {
    // Boot never got a manifest; a manual refresh is a full retry.
    if (manual) location.reload();
    return Promise.resolve();
  }
  if (manual) {
    setRefreshBusy(true);
    ui.updateNotice.textContent = 'Checking…';
  }
  lastCheckAt = Date.now();
  refreshing = (async () => {
    try {
      const { updated, manifest } = await checkForUpdates(current);
      if (updated) {
        await applySnapshot(manifest);
        showNotice('Updated to the latest snapshot.');
      } else {
        // A failed roster load is retried even when the snapshot is unchanged.
        if (getState().loadError) loadRoster(getState().guild);
        if (manual) showNotice('Up to date.');
      }
    } catch (_) {
      if (manual) showNotice('Could not reach the snapshot right now.');
    } finally {
      if (manual) setRefreshBusy(false);
      // Re-render the age either way, so "Updated …" is true as of now.
      tickFreshness();
      refreshing = null;
    }
  })();
  return refreshing;
}

function renderBanners(state) {
  renderFreshness(ui.freshness, state.manifest);
  // The stale banner is about Retail's data; Forever has none to be stale.
  if (state.game === 'retail') renderStaleBanner(ui.banner, state.manifest, state.guild);
  else { clear(ui.banner); ui.banner.hidden = true; }
}

function tickFreshness() {
  const state = getState();
  if (!state.manifest) return;
  renderBanners(state);
}

// Poll only while the tab is visible — a background tab costs nothing — and
// catch up immediately when it comes back or the network returns.
function startAutoRefresh() {
  setInterval(tickFreshness, AUTO_REFRESH.tickMs);
  setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, AUTO_REFRESH.pollMs);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    tickFreshness();
    if (Date.now() - lastCheckAt >= AUTO_REFRESH.pollMs) refresh();
  });
  window.addEventListener('online', () => refresh());
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

function switchGame(game) {
  if (game === getState().game) return;
  // An open sheet belongs to Retail; it does not follow the reader to Forever.
  setState({ game, detailKey: null });
  window.scrollTo({ top: 0 });
}

function applyUrl(urlState, { load = false } = {}) {
  const slugs = guildList(getState().manifest);
  const guild = slugs.includes(urlState.guild) ? urlState.guild : slugs[0] || null;
  const guildChanged = guild !== getState().guild;
  const hasDrawerFilter = urlState.classes.size || urlState.races.size || urlState.owners.size || urlState.minLevel;
  setState({
    ...(guildChanged ? guildScopedReset() : {}),
    game: urlState.game,
    guild,
    // Retired and unknown tabs (old ?tab=readiness links) land on the roster.
    tab: TABS.some(t => t.id === urlState.tab) ? urlState.tab : 'roster',
    detailKey: urlState.detailKey,
    search: urlState.search,
    sort: urlState.sort,
    scope: urlState.scope,
    owners: urlState.owners,
    classes: urlState.classes,
    races: urlState.races,
    minLevel: urlState.minLevel,
    ...(hasDrawerFilter ? { filtersOpen: true } : {}),
    compareMode: urlState.compareMode,
    compareKeys: urlState.compareKeys,
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
  if (guild && (load || guildChanged)) loadRoster(guild);
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
  ui.refresh.addEventListener('click', () => refresh({ manual: true }));
  for (const btn of ui.gameSwitch.querySelectorAll('button')) {
    btn.addEventListener('click', () => switchGame(btn.dataset.game));
  }
  ui.view.tabIndex = -1;
  onPopstate(urlState => applyUrl(urlState));

  // The initial URL must be read and applied to state BEFORE any state
  // change is mirrored back into the URL, or boot would wipe deep links.
  let urlReady = false;

  subscribe((state, changed) => {
    const has = (...keys) => keys.some(k => changed.includes(k));
    const focus = focusToken();
    if (urlReady) syncUrl(state, changed);
    if (has('game')) renderGameSwitch(state);
    if (has('manifest', 'guild', 'game')) {
      renderSwitcher(state);
      renderBanners(state);
    }
    if (has('roster', 'guild', 'manifest', 'game')) { renderHeaderText(state); syncThemeColor(); }
    if (has('tab', 'game')) renderTabs(state);
    // Re-render the view only when its inputs changed — a dialog open/close
    // must not rebuild it (that would detach the row focus returns to).
    const viewKeys = [
      'manifest', 'game', 'guild', 'roster', 'tab', 'loadError', 'bootError',
      'search', 'sort', 'scope', 'owners', 'classes', 'races', 'minLevel', 'filtersOpen',
      'compareMode', 'compareKeys',
      'category',
      'catalog', 'raids', 'tierId', 'difficulty',
      'collectionsIndex', 'collectionKey', 'collectionKind', 'rarity', 'favoritesOnly', 'collections',
    ];
    if (changed.some(k => viewKeys.includes(k))) renderView(state);
    if (has('manifest', 'game', 'guild', 'roster', 'tab')) renderStage(stageUi, state, openSheet);
    restoreFocus(focus);
    ensureTabData(state);
    syncDialog(state);
    syncCompareDialog(state);
  });

  // The game is readable from the URL alone, so Forever renders at once —
  // it shows no data and must not wait for (or fail with) the manifest.
  const initialUrl = readUrl();
  setState({ game: initialUrl.game });
  renderGameSwitch(getState());
  renderHeaderText(getState());
  syncThemeColor();
  renderTabs(getState());
  renderView(getState());
  renderStage(stageUi, getState(), openSheet);

  let manifest = null;
  try {
    manifest = await fetchManifest();
  } catch (_) {
    renderStaleBanner(ui.banner, null, null);
    if (getState().game !== 'retail') ui.banner.hidden = true;
    // The header button becomes a retry; the page reloads on its own too.
    ui.refresh.disabled = false;
    setTimeout(() => location.reload(), AUTO_REFRESH.pollMs);
    // urlReady stays false: with no manifest the state is all defaults, and
    // mirroring that into the address bar would wipe the reader's deep link.
    setState({ bootError: true });
    return;
  }

  setState({ manifest });
  // Only meaningful once there is a manifest to compare against; the button
  // ships disabled in the markup for exactly that reason.
  ui.refresh.disabled = false;
  lastCheckAt = Date.now();
  startAutoRefresh();
  // The reader may have used the game switch while the manifest was loading;
  // that choice wins over the URL captured at boot (and an open sheet, which
  // belongs to Retail, does not follow them to Forever).
  const pickedGame = getState().game;
  const gameChanged = pickedGame !== initialUrl.game;
  applyUrl({
    ...initialUrl, game: pickedGame,
    detailKey: gameChanged ? null : initialUrl.detailKey,
  }, { load: true });
  urlReady = true;
  if (gameChanged || !TABS.some(t => t.id === initialUrl.tab)) normalizeUrl(getState());
  document.fonts?.ready?.then(() => fitPoster(ui.stage, ui.title));
}

boot();
