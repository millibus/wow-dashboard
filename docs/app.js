// === Config ===
// Data source: hourly JSON snapshots in `data/` (built by scripts/build-snapshot.js).
// API_BASE is an optional live-API fallback for local dev when serving via the
// Express server (api/server.js). Leave '' on the public Pages site — snapshots
// are the source of truth there.
const API_BASE = '';

// Every string that reaches innerHTML goes through esc(). Character, item, pet
// and mount names come from the Blizzard API (apostrophes are common) and the
// filter state can come straight off the query string, so nothing is trusted.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// Fetch a static snapshot first; fall back to the live API if available and
// the snapshot is missing (e.g. serving via Express before any snapshot exists).
async function fetchData(staticPath, apiPath) {
  try {
    const res = await fetch(`data/${staticPath}`, { cache: 'no-cache' });
    if (res.ok) return res.json();
    if (!API_BASE && apiPath) throw new Error(`snapshot missing: ${staticPath} (${res.status})`);
  } catch (err) {
    if (!API_BASE || !apiPath) throw err;
  }
  const res = await fetch(`${API_BASE}${apiPath}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

let snapshotTsPromise = null;
function setSnapshotTimestamp() {
  if (!snapshotTsPromise) {
    snapshotTsPromise = fetch('data/generated-at.json', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  snapshotTsPromise.then(d => {
    const el = document.getElementById('last-updated');
    if (!d?.ts || !el) return;
    el.textContent = `Snapshot ${relativeTime(new Date(d.ts).getTime())}`;
    el.title = `Generated ${new Date(d.ts).toLocaleString()} — refreshed hourly by GitHub Actions`;
  });
}

// "3m ago" / "5h ago" / "2d ago". Floors rather than rounds, so a 90-minute-old
// snapshot reads "1h ago" and never claims to be newer than it is.
function relativeTime(ts) {
  if (!ts) return 'never';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  const days = Math.floor(mins / 1440);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(days / 365)}y ago`;
}

// ============================
// OWNER MAP — edit this!
// Map character names (exact, case-sensitive) to their owner.
// Owner labels are intentionally anonymized (user1/user2/user3) on the
// public dashboard. Edit privately if you want personalized labels.
// ============================
const OWNER_MAP = {
  // user1's characters:
  'Sanicon': 'user1',
  'Harclive': 'user1',
  'Phenis': 'user1',
  'Blajarm': 'user1',
  'Potac': 'user1',
  'Wicken': 'user1',
  'Llisp': 'user1',
  'Quu': 'user1',
  'Hemahroid': 'user1',
  'Decillin': 'user1',
  'Colonic': 'user1',
  'Trashey': 'user1',
  'Gorgis': 'user1',
  'Babbang': 'user1',
  'Flachewlance': 'user1',
  'Thuun': 'user1',
  'Chargar': 'user1',
  'Asdan': 'user1',
  'Wetseamen': 'user1',

  // user2's characters:
  'Apocalypsic': 'user2',
  'Oathos': 'user2',
  'Incantation': 'user2',
  'Religious': 'user2',
  'Zeison': 'user2',
  'Stray': 'user2',

  // user3's characters:
  'Hollyballs': 'user3',
  'Darthfurball': 'user3',
  'Revän': 'user3',
  'Caedus': 'user3',
  'Jacobyy': 'user3',
  'Bbaronsamedi': 'user3',
  'Holyrevan': 'user3',
  'Krang': 'user3',
  'Necronomican': 'user3',
  'Pizo': 'user3',
  'Jeetkundo': 'user3',
  'Demonik': 'user3',
  'Alduen': 'user3',
  'Dendis': 'user3',
  // user1's Alliance characters (Riot Act):
  'Huejanus': 'user1',
  'Lumian': 'user1',
  // user3's Alliance characters (Riot Act):
  'Krisis': 'user3',
  'Grrumpy': 'user3',
  'Jacoby': 'user3',
  'Wolfsbane': 'user3',
  'Mechaminime': 'user3',
};

const OWNERS = ['user1', 'user2', 'user3'];

const OWNER_COLORS = {
  user1: '#a78bfa',
  user2: '#34d399',
  user3: '#f59e0b',
};

// WoW class colors
const CLASS_COLORS = {
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

const GUILDS = {
  'deaths-edge': { title: "Death's Edge", subtitle: '🔴 Horde — Onyxia-US' },
  'riot-act': { title: 'Riot Act', subtitle: '🔵 Alliance — Onyxia-US' },
};

// Retail's level cap, raised automatically if a snapshot ever contains a higher
// level than we know about — so this file doesn't go stale the week an
// expansion lands the way the old hardcoded 80 did.
const BASE_LEVEL_CAP = 90;
let levelCap = BASE_LEVEL_CAP;

function detectLevelCap(members) {
  levelCap = Math.max(BASE_LEVEL_CAP, ...members.map(m => m.level || 0));
}

// Slots that carry no gear signal — excluded from ilvl-adjacent audits.
const COSMETIC_SLOTS = new Set(['Shirt', 'Tabard']);
// Slots that accept a permanent enchant in the current expansion.
const ENCHANTABLE_SLOTS = new Set([
  'Back', 'Chest', 'Wrist', 'Legs', 'Feet', 'Ring 1', 'Ring 2', 'Main Hand', 'Off Hand',
]);

// Picks black or white text for a background by comparing the two actual WCAG
// contrast ratios rather than guessing at a lightness threshold. Whichever wins
// is always at least 4.58:1, so every class color clears AA — including the
// mid-tone ones (Warlock, Evoker) that a naive threshold sends the wrong way.
function readableTextOn(hex) {
  const m = /^#?([a-f\d]{6})$/i.exec(String(hex || ''));
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  const onBlack = (lum + 0.05) / 0.05;
  const onWhite = 1.05 / (lum + 0.05);
  return onBlack >= onWhite ? '#111' : '#fff';
}

const classColor = name => CLASS_COLORS[name] || '#c8a84b';

// Pills paint their color as a background when active, so they need a
// matching text color rather than a flat black.
function pillStyle(color) {
  return `--pill-color:${esc(color)};--pill-text:${readableTextOn(color)}`;
}

// === Filter State ===
let allMembers = [];
let sortBy = 'ilvl';
let filterOwners = new Set(); // empty = all
let filterClasses = new Set();
let filterRaces = new Set();
let filterRanks = new Set();
let minLevel = 0;
let searchQuery = '';
let compareMode = false;
let compareSelection = [null, null];
let currentGuildSlug = 'deaths-edge';

const SORT_OPTIONS = ['ilvl', 'level', 'name', 'class', 'race', 'owner', 'recent', 'rank'];
const VIEWS = ['roster', 'readiness', 'leaderboard', 'raids', 'pets', 'mounts'];
const SCOPES = ['active', 'archive', 'all'];

// 'active' = owned characters logged in within ARCHIVE_THRESHOLD_DAYS
// 'archive' = owned characters that haven't logged in for that long (or never)
// 'all'     = every owned character regardless of last login
// Non-owned characters are never shown — the dashboard is scoped to the OWNER_MAP crew.
const ARCHIVE_THRESHOLD_DAYS = 30;
let viewScope = 'active';

function isOwned(m) {
  return !!m.owner;
}

function isActiveByLogin(m) {
  if (!m.lastLogin) return false;
  return (Date.now() - m.lastLogin) < ARCHIVE_THRESHOLD_DAYS * 86400000;
}

function inViewScope(m) {
  if (!isOwned(m)) return false;
  if (viewScope === 'all') return true;
  return viewScope === 'active' ? isActiveByLogin(m) : !isActiveByLogin(m);
}

function scopedMembers() {
  return allMembers.filter(inViewScope);
}

function rankLabel(rank) {
  if (rank === 0) return 'Guild Master';
  if (rank === 1) return 'Officer';
  return `Rank ${rank}`;
}

// === Init ===
window.addEventListener('DOMContentLoaded', () => {
  loadFromURL();
  applyGuildChrome(currentGuildSlug);
  loadGuild(false);

  installDelegatedHandlers();

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = document.querySelector('.modal:not(.hidden)');
    if (open) { e.preventDefault(); closeModalEl(open); }
  });

  // Back-to-top button
  const btn = document.createElement('button');
  btn.id = 'back-to-top';
  btn.type = 'button';
  btn.textContent = '↑';
  btn.title = 'Back to top';
  btn.setAttribute('aria-label', 'Back to top');
  btn.addEventListener('click', () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });
  document.body.appendChild(btn);

  let scrollTick = false;
  window.addEventListener('scroll', () => {
    if (scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(() => {
      btn.classList.toggle('visible', window.scrollY > 400);
      scrollTick = false;
    });
  }, { passive: true });
});

// Dynamic content is rendered with data-action attributes rather than inline
// onclick strings — names never have to survive a trip through a JS string
// literal, which is where the old chip handlers broke.
function installDelegatedHandlers() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const d = el.dataset;
    switch (d.action) {
      case 'open-character': openDetail(d.name, d.realm); break;
      case 'card':
        if (compareMode) selectForCompare(d.name);
        else openDetail(d.name, d.realm);
        break;
      case 'chip-remove': removeFilter(d.kind, d.val); break;
      case 'clear-filters': clearFilters(); break;
      case 'filter': toggleFilter(d.group, d.val, el); break;
      case 'level': onLevelFilter(d.val, el); break;
      case 'scope': setViewScope(d.val, el); break;
      case 'lb-owner': setLbOwner(d.val, el); break;
      case 'readiness-owner': setReadinessOwner(d.val, el); break;
      case 'raid-tier': setRaidTier(Number(d.val), el); break;
      case 'raid-owner': setRaidOwner(d.val, el); break;
      case 'retry': loadGuild(true); break;
      case 'toggle-audit': toggleGearAudit(); break;
      case 'toggle-filters': toggleFilterBar(); break;
      default: break;
    }
  });

  // Cards and table rows are focusable widgets, so Enter/Space must activate
  // them the way a real button would.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('[data-action][role="button"]');
    if (!el) return;
    e.preventDefault();
    el.click();
  });
}

// === Modal plumbing (focus trap + scroll lock + focus restore) ===
let lastFocusedBeforeModal = null;

function openModalEl(modal) {
  lastFocusedBeforeModal = document.activeElement;
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  const focusTarget = modal.querySelector('.modal-close');
  if (focusTarget) focusTarget.focus();
  modal.addEventListener('keydown', trapFocus);
}

function closeModalEl(modal) {
  modal.classList.add('hidden');
  modal.removeEventListener('keydown', trapFocus);
  if (!document.querySelector('.modal:not(.hidden)')) {
    document.body.classList.remove('modal-open');
  }
  if (lastFocusedBeforeModal?.isConnected) lastFocusedBeforeModal.focus();
  lastFocusedBeforeModal = null;
}

function trapFocus(e) {
  if (e.key !== 'Tab') return;
  const focusables = e.currentTarget.querySelectorAll(
    'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// === Guild switching ===
function applyGuildChrome(slug) {
  const g = GUILDS[slug] || { title: slug, subtitle: 'Onyxia-US' };
  const h1 = document.querySelector('h1');
  const sub = document.querySelector('.subtitle');
  if (h1) h1.textContent = g.title;
  if (sub) sub.textContent = g.subtitle;
  document.title = `⚔️ ${g.title} — Guild Dashboard`;
  document.querySelectorAll('.guild-toggle-btn').forEach(btn => {
    const on = btn.dataset.slug === slug;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
}

function switchGuild(slug) {
  if (!GUILDS[slug] || slug === currentGuildSlug) return;
  currentGuildSlug = slug;
  raidLoaded = false;
  raidData = null;
  raidTierIdx = 0;
  raidOwnerFilter = '';
  petsData = null;
  mountsData = null;
  collectionIndex = null;
  resetCollectionSelect('pets-char-select');
  resetCollectionSelect('mounts-char-select');
  if (compareMode) cancelCompare();
  applyGuildChrome(slug);

  filterOwners = new Set();
  filterClasses = new Set();
  filterRaces = new Set();
  filterRanks = new Set();
  searchQuery = '';
  clearTimeout(searchDebounce);
  const searchEl = document.getElementById('search');
  if (searchEl) searchEl.value = '';
  updateURL();
  loadGuild(false);
}

function getOwner(name) {
  return OWNER_MAP[name] || null;
}

// Guild switches can overlap; only the newest request may touch shared state.
let loadToken = 0;

async function loadGuild(forceRefresh) {
  const token = ++loadToken;
  const slug = currentGuildSlug;
  try {
    document.getElementById('character-grid').innerHTML = `
      <div class="loading-grid">
        ${Array(8).fill('<div class="skeleton-card"></div>').join('')}
      </div>`;
    document.getElementById('guild-stats').innerHTML = '<div class="guild-stat-skeleton"></div>';

    const data = await fetchData(
      `guild-${slug}.json`,
      `/api/guild?slug=${encodeURIComponent(slug)}${forceRefresh ? '&nocache=1' : ''}`,
    );
    if (token !== loadToken) return; // a newer switch already won

    allMembers = (data.members || []).map(m => ({ ...m, owner: getOwner(m.name) }));
    detectLevelCap(allMembers);

    setSnapshotTimestamp();
    buildFilterOptions();
    renderGuildStats();
    filterAndRender();
    applyURLTab();
  } catch (err) {
    if (token !== loadToken) return;
    // Drop the previous guild's roster so other tabs can't render stale data
    // under the new guild's title.
    allMembers = [];
    buildFilterOptions();
    renderGuildStats();
    document.getElementById('character-grid').innerHTML =
      `<div class="empty-state">⚠️ Failed to load guild data.<br><small>${esc(err.message)}</small><br><br>
       <button class="btn-refresh" type="button" data-action="retry">Retry</button></div>`;
    console.error(err);
  }
}

function buildFilterOptions() {
  // Status pills (Active / Archive / All) — counts use the OWNER_MAP crew only
  const owned = allMembers.filter(isOwned);
  const activeCount = owned.filter(isActiveByLogin).length;
  const archiveCount = owned.length - activeCount;
  const statusEl = document.getElementById('filter-status');
  if (statusEl) {
    const pills = [
      ['active', 'Active', activeCount],
      ['archive', 'Archive', archiveCount],
      ['all', 'All', owned.length],
    ];
    statusEl.innerHTML = pills.map(([val, label, count]) => `
      <button class="filter-pill${viewScope === val ? ' active' : ''}" type="button" data-group="status" data-val="${esc(val)}" data-action="scope" aria-pressed="${viewScope === val}">
        ${esc(label)} <span class="pill-count">${count}</span>
      </button>`).join('');
  }

  // Owner / class / race / rank pills are scoped to the current view
  const base = scopedMembers();

  const ownerEl = document.getElementById('filter-owners');
  ownerEl.innerHTML = `<button class="filter-pill${filterOwners.size ? '' : ' active'}" type="button" data-group="owner" data-val="" data-action="filter">All</button>` +
    OWNERS.map(o => {
      const count = base.filter(m => m.owner === o).length;
      if (count === 0) return '';
      return `<button class="filter-pill${filterOwners.has(o) ? ' active' : ''}" type="button" data-group="owner" data-val="${esc(o)}" data-action="filter" style="${pillStyle(OWNER_COLORS[o])}">${esc(o)} <span class="pill-count">${count}</span></button>`;
    }).join('');

  const classes = [...new Set(base.map(m => m.className).filter(Boolean))].sort();
  const classEl = document.getElementById('filter-classes');
  classEl.innerHTML = classes.map(c => {
    const count = base.filter(m => m.className === c).length;
    return `<button class="filter-pill${filterClasses.has(c) ? ' active' : ''}" type="button" data-group="class" data-val="${esc(c)}" data-action="filter" style="${pillStyle(classColor(c))}">${esc(c)} <span class="pill-count">${count}</span></button>`;
  }).join('');

  const races = [...new Set(base.map(m => m.race).filter(Boolean))].sort();
  const raceEl = document.getElementById('filter-races');
  raceEl.innerHTML = races.map(r => {
    const count = base.filter(m => m.race === r).length;
    return `<button class="filter-pill${filterRaces.has(r) ? ' active' : ''}" type="button" data-group="race" data-val="${esc(r)}" data-action="filter">${esc(r)} <span class="pill-count">${count}</span></button>`;
  }).join('');

  const ranks = [...new Set(base.map(m => m.rank).filter(r => r !== undefined && r !== null))].sort((a, b) => a - b);
  const rankEl = document.getElementById('filter-ranks');
  if (rankEl) {
    rankEl.innerHTML = ranks.map(r => {
      const count = base.filter(m => m.rank === r).length;
      return `<button class="filter-pill${filterRanks.has(String(r)) ? ' active' : ''}" type="button" data-group="rank" data-val="${r}" data-action="filter">${esc(rankLabel(r))} <span class="pill-count">${count}</span></button>`;
    }).join('');
  }

  // Hide filter sections that have nothing to offer for this guild/scope
  document.querySelectorAll('.filter-bar-section[data-fills]').forEach(section => {
    const target = document.getElementById(section.dataset.fills);
    section.classList.toggle('hidden', !target || !target.children.length);
  });

  document.getElementById('sort-select').value = sortBy;

  if (searchQuery) {
    const searchEl = document.getElementById('search');
    if (searchEl) searchEl.value = searchQuery;
  }
  document.querySelectorAll('.level-btn').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.val) === minLevel);
  });
  updateFilterCount();
}

function activeFilterCount() {
  return filterOwners.size + filterClasses.size + filterRaces.size + filterRanks.size +
    (minLevel > 0 ? 1 : 0) + (searchQuery ? 1 : 0);
}

function updateFilterCount() {
  const badge = document.getElementById('filter-count-badge');
  if (!badge) return;
  const n = activeFilterCount();
  badge.textContent = n ? String(n) : '';
  badge.classList.toggle('hidden', !n);
}

function toggleFilterBar() {
  const bar = document.getElementById('filter-bar');
  const btn = document.getElementById('btn-toggle-filters');
  if (!bar) return;
  const collapsed = bar.classList.toggle('collapsed');
  if (btn) btn.setAttribute('aria-expanded', String(!collapsed));
}

const FILTER_SETS = {
  owner: () => filterOwners,
  class: () => filterClasses,
  race: () => filterRaces,
  rank: () => filterRanks,
};

function toggleFilter(group, val, btn) {
  if (group === 'owner' && val === '') {
    filterOwners.clear();
  } else {
    const set = FILTER_SETS[group]?.();
    if (!set) return;
    if (set.has(val)) set.delete(val); else set.add(val);
  }
  syncFilterPills(group);
  filterAndRender();
  updateURL();
}

function syncFilterPills(group) {
  const set = FILTER_SETS[group]?.();
  if (!set) return;
  document.querySelectorAll(`#filter-bar [data-group="${group}"]`).forEach(b => {
    const val = b.dataset.val;
    const on = val === '' ? set.size === 0 : set.has(val);
    b.classList.toggle('active', on);
  });
}

function removeFilter(kind, val) {
  if (kind === 'search') {
    clearTimeout(searchDebounce);
    searchQuery = '';
    const el = document.getElementById('search');
    if (el) el.value = '';
  } else if (kind === 'level') {
    minLevel = 0;
    document.querySelectorAll('.level-btn').forEach(b => b.classList.toggle('active', b.dataset.val === '0'));
  } else {
    FILTER_SETS[kind]?.().delete(val);
    syncFilterPills(kind);
  }
  filterAndRender();
  updateURL();
}

function clearFilters() {
  clearTimeout(searchDebounce);
  filterOwners.clear();
  filterClasses.clear();
  filterRaces.clear();
  filterRanks.clear();
  minLevel = 0;
  searchQuery = '';
  document.getElementById('search').value = '';
  // Scoped to the roster filter bar — the leaderboard, raid, readiness and
  // collection tabs use .filter-pill too and own their own state.
  document.querySelectorAll('#filter-bar .filter-pill').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#filter-bar .level-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.val === '0');
  });
  document.querySelector('#filter-bar [data-group="owner"][data-val=""]')?.classList.add('active');
  document.querySelectorAll('#filter-bar [data-group="status"]').forEach(b => {
    b.classList.toggle('active', b.dataset.val === viewScope);
  });
  filterAndRender();
  updateURL();
}

function setViewScope(scope, btn) {
  if (!SCOPES.includes(scope)) return;
  viewScope = scope;
  // Owner / class / race filters can become incompatible with the new scope
  // (e.g. an owner with zero archived chars). Clear them for predictability.
  filterOwners.clear();
  filterClasses.clear();
  filterRaces.clear();
  filterRanks.clear();
  buildFilterOptions();
  renderGuildStats();
  filterAndRender();
  updateURL();
}

let searchDebounce;
function onSearch(val) {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    searchQuery = val.toLowerCase();
    filterAndRender();
    updateURL();
  }, 300);
}

function onSortChange(val) {
  if (!SORT_OPTIONS.includes(val)) return;
  sortBy = val;
  filterAndRender();
  updateURL();
}

function onLevelFilter(val, btn) {
  minLevel = parseInt(val, 10) || 0;
  document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filterAndRender();
  updateURL();
}

function renderGuildStats() {
  const members = scopedMembers();
  const maxLevel = members.filter(m => m.level >= levelCap);
  const geared = maxLevel.filter(m => m.averageIlvl > 0);
  const avgIlvl = geared.length
    ? Math.round(geared.reduce((a, m) => a + m.averageIlvl, 0) / geared.length)
    : 0;
  const ilvls = members.map(m => m.averageIlvl || 0);
  const topIlvl = ilvls.length ? Math.max(...ilvls) : 0;
  const classes = new Set(members.map(m => m.className).filter(Boolean)).size;

  document.getElementById('guild-stats').innerHTML = `
    <div class="guild-stat"><span class="guild-stat-label">Members</span><span class="guild-stat-value">${members.length}</span></div>
    <div class="guild-stat"><span class="guild-stat-label">Level ${levelCap}+</span><span class="guild-stat-value">${maxLevel.length}</span></div>
    <div class="guild-stat"><span class="guild-stat-label">Avg ilvl (${levelCap}+)</span><span class="guild-stat-value">${avgIlvl || '—'}</span></div>
    <div class="guild-stat"><span class="guild-stat-label">Top ilvl</span><span class="guild-stat-value">${topIlvl || '—'}</span></div>
    <div class="guild-stat"><span class="guild-stat-label">Classes</span><span class="guild-stat-value">${classes}</span></div>
  `;
}

function chip(kind, val, label, color) {
  return `<span class="chip"${color ? ` style="--chip-color:${esc(color)}"` : ''}>${esc(label)}
    <button class="chip-x" type="button" data-action="chip-remove" data-kind="${esc(kind)}" data-val="${esc(val)}" aria-label="Remove filter ${esc(label)}">×</button></span>`;
}

function renderActiveChips(filtered, total) {
  const chips = [];
  filterOwners.forEach(o => chips.push(chip('owner', o, o, OWNER_COLORS[o])));
  filterClasses.forEach(c => chips.push(chip('class', c, c, classColor(c))));
  filterRaces.forEach(r => chips.push(chip('race', r, r)));
  filterRanks.forEach(r => chips.push(chip('rank', r, rankLabel(Number(r)))));
  if (searchQuery) chips.push(chip('search', '', `🔍 "${searchQuery}"`));
  if (minLevel > 0) chips.push(chip('level', '', `Level ${minLevel}+`));

  document.getElementById('active-chips').innerHTML = `
    <span class="result-count">${filtered} of ${total} characters</span>
    ${chips.join('')}
    ${chips.length ? '<button class="clear-all-btn" type="button" data-action="clear-filters">Clear all</button>' : ''}
  `;
  updateFilterCount();
}

function filterAndRender() {
  const scoped = scopedMembers();
  const filtered = scoped.filter(m => {
    if (m.level < minLevel) return false;
    if (filterOwners.size > 0 && !filterOwners.has(m.owner)) return false;
    if (filterClasses.size > 0 && !filterClasses.has(m.className)) return false;
    if (filterRaces.size > 0 && !filterRaces.has(m.race)) return false;
    if (filterRanks.size > 0 && !filterRanks.has(String(m.rank))) return false;
    if (searchQuery) {
      const q = searchQuery;
      if (
        !m.name.toLowerCase().includes(q) &&
        !(m.className || '').toLowerCase().includes(q) &&
        !(m.spec || '').toLowerCase().includes(q) &&
        !(m.race || '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  // Every comparator falls back to name so equal keys don't reshuffle between renders.
  const byName = (a, b) => a.name.localeCompare(b.name);
  filtered.sort((a, b) => {
    switch (sortBy) {
      case 'ilvl': return (b.averageIlvl || 0) - (a.averageIlvl || 0) || byName(a, b);
      case 'level': return (b.level || 0) - (a.level || 0) || byName(a, b);
      case 'name': return byName(a, b);
      case 'class': return (a.className || '').localeCompare(b.className || '') || byName(a, b);
      case 'race': return (a.race || '').localeCompare(b.race || '') || byName(a, b);
      case 'owner': return (a.owner || 'zzz').localeCompare(b.owner || 'zzz') || byName(a, b);
      case 'recent': return (b.lastLogin || 0) - (a.lastLogin || 0) || byName(a, b);
      case 'rank': return (a.rank ?? 99) - (b.rank ?? 99) || byName(a, b);
      default: return byName(a, b);
    }
  });

  renderActiveChips(filtered.length, scoped.length);
  const grid = document.getElementById('character-grid');
  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state">No characters match your filters.<br>
      <button class="clear-all-btn" type="button" data-action="clear-filters" style="margin-top:10px">Clear filters</button></div>`;
    return;
  }
  grid.innerHTML = filtered.map(renderCard).join('');
}

function rankBadge(rank) {
  if (rank === 0) return '<span class="badge badge-rank" title="Guild Master">👑 GM</span>';
  if (rank === 1) return '<span class="badge badge-rank" title="Officer">🎖 Officer</span>';
  return '';
}

function renderCard(m) {
  const color = classColor(m.className);
  const selectedClass = compareSelection.includes(m.name) ? 'compare-selected' : '';
  const stats = m.stats || {};
  const ownerColor = m.owner ? OWNER_COLORS[m.owner] : null;

  const statBars = [
    { label: 'Crit', val: stats.crit || 0, cls: 'bar-crit', max: 40 },
    { label: 'Haste', val: stats.haste || 0, cls: 'bar-haste', max: 40 },
    { label: 'Mastery', val: stats.mastery || 0, cls: 'bar-mastery', max: 80 },
    { label: 'Vers', val: stats.vers || 0, cls: 'bar-vers', max: 30 },
  ];

  const barsHtml = statBars.map(s => `
    <div class="stat-bar-row">
      <span class="stat-bar-label">${s.label}</span>
      <div class="stat-bar-track">
        <div class="stat-bar-fill ${s.cls}" style="width:${clampPct((s.val / s.max) * 100)}%"></div>
      </div>
      <span class="stat-bar-value">${s.val}%</span>
    </div>`).join('');

  const portraitHtml = m.avatarUrl
    ? `<img src="${esc(m.avatarUrl)}" alt="" width="90" height="110" loading="lazy" onerror="this.replaceWith(portraitPlaceholder())">`
    : '<div class="card-portrait-placeholder">⚔</div>';

  const label = compareMode
    ? `Select ${m.name} for comparison`
    : `Open details for ${m.name}`;

  return `
    <article class="char-card ${selectedClass}" style="--class-color:${esc(color)}"
      role="button" tabindex="0" data-action="card" data-name="${esc(m.name)}" data-realm="${esc(m.realm || 'onyxia')}"
      aria-label="${esc(label)}"${m.mainRawUrl ? ` data-fullbody="${esc(m.mainRawUrl)}"` : ''}>
      <div class="card-body">
        <div class="card-portrait">${portraitHtml}</div>
        <div class="card-info">
          <div class="char-name">${esc(m.name)}</div>
          ${m.title ? `<div class="char-title-text">${esc(m.title)}</div>` : ''}
          <div class="card-badges">
            <span class="badge badge-level">L${esc(m.level)}</span>
            <span class="badge badge-class" style="background:${esc(color)};color:${readableTextOn(color)}">${esc(m.className)}</span>
            ${m.spec ? `<span class="badge badge-spec">${esc(m.spec)}</span>` : ''}
            ${rankBadge(m.rank)}
          </div>
          ${m.race ? `<div class="char-race">${esc(m.race)}</div>` : ''}
          <div class="card-meta-row">
            ${m.owner ? `<span class="char-owner" style="color:${esc(ownerColor)}">● ${esc(m.owner)}</span>` : ''}
            ${m.lastLogin ? `<span class="char-lastseen" title="Last login ${esc(new Date(m.lastLogin).toLocaleString())}">${esc(relativeTime(m.lastLogin))}</span>` : ''}
          </div>
          <div class="card-ilvl-block">
            <span class="char-ilvl">${m.averageIlvl || '—'}</span>
            <span class="char-ilvl-label">avg ilvl</span>
          </div>
        </div>
      </div>
      <div class="card-stats">${barsHtml}</div>
    </article>`;
}

function portraitPlaceholder() {
  const div = document.createElement('div');
  div.className = 'card-portrait-placeholder';
  div.textContent = '⚔';
  return div;
}

function clampPct(n) {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
}

// === View Switching ===
let currentView = 'roster';
let lbOwnerFilter = '';
let readinessOwnerFilter = '';
let readinessRiskFilter = '';

// === Readiness Radar ===
function buildReadinessOwnerFilter() {
  const el = document.getElementById('readiness-owner-filter');
  if (!el) return;
  const btns = [['', 'All'], ...OWNERS.map(o => [o, o])];
  el.innerHTML = btns.map(([val, label]) => {
    const col = val ? ` style="${pillStyle(OWNER_COLORS[val])}"` : '';
    return `<button class="filter-pill${readinessOwnerFilter === val ? ' active' : ''}" type="button" data-action="readiness-owner" data-val="${esc(val)}"${col}>${esc(label)}</button>`;
  }).join('');
}

function setReadinessOwner(val, btn) {
  readinessOwnerFilter = val;
  document.querySelectorAll('#readiness-owner-filter .filter-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderReadiness();
  updateURL();
}

function setReadinessRisk(val, btn) {
  readinessRiskFilter = val;
  document.querySelectorAll('#readiness-risk-filter .filter-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderReadiness();
  updateURL();
}

// Scores are relative to the roster you're actually looking at, not to a fixed
// end-game item level. A benchmark tied to the guild's own best-geared max-level
// characters keeps the scale meaningful whether the crew is levelling or raiding.
function buildReadinessContext(members) {
  const ilvls = members
    .filter(m => m.level >= levelCap && m.averageIlvl > 0)
    .map(m => m.averageIlvl)
    .sort((a, b) => a - b);
  const fallback = members.map(m => m.averageIlvl || 0).sort((a, b) => a - b);
  const pool = ilvls.length ? ilvls : fallback;
  const benchmark = pool.length ? pool[Math.floor(pool.length * 0.9)] || pool[pool.length - 1] : 0;
  return { benchmark: benchmark || 1 };
}

function getReadiness(member, ctx) {
  const equipment = (member.equipment || []).filter(i => !COSMETIC_SLOTS.has(i.slot));
  const emptySockets = equipment.filter(i => i.hasEmptySocket).length;
  const enchantable = equipment.filter(i => ENCHANTABLE_SLOTS.has(i.slot));
  const enchanted = enchantable.filter(i => (i.enchantCount || 0) > 0).length;
  const enchantRatio = enchantable.length ? enchanted / enchantable.length : 0;
  const ilvl = member.averageIlvl || 0;
  const level = member.level || 0;

  const gearPct = clampPct((ilvl / ctx.benchmark) * 100) / 100;
  const levelPct = clampPct((level / levelCap) * 100) / 100;
  const socketPct = emptySockets ? Math.max(0, 1 - emptySockets / 4) : 1;

  // Nobody enchants quest greens, so enchants only count against characters
  // close enough to the cap for it to be a real omission.
  const enchantsExpected = level >= levelCap - 10;
  const prepPct = enchantsExpected ? 0.6 * enchantRatio + 0.4 * socketPct : socketPct;

  const days = member.lastLogin ? (Date.now() - member.lastLogin) / 86400000 : Infinity;
  const activityPct = days <= 7 ? 1 : days <= 30 ? 0.7 : days <= 90 ? 0.4 : days <= 365 ? 0.15 : 0;

  // Gear is weighted by level so a well-geared level 40 can't outrank a raider.
  const gearScore = 45 * gearPct * levelPct;
  const prepScore = 35 * prepPct;
  const activityScore = 20 * activityPct;
  const score = Math.round(clampPct(gearScore + prepScore + activityScore));

  // 70 is reachable: a capped character at the guild's gear benchmark with most
  // slots enchanted and a login this month clears it comfortably.
  let risk = 'risk';
  if (score >= 70) risk = 'ready';
  else if (score >= 45) risk = 'watch';

  const lifeStats = member.lifeStats || {};
  const actions = [];
  if (level < levelCap) actions.push(`Level to ${levelCap} (currently ${level})`);
  if (ilvl && gearPct < 0.9 && level >= levelCap) actions.push(`Gear up: ilvl ${ilvl} vs guild benchmark ${Math.round(ctx.benchmark)}`);
  if (emptySockets) actions.push(`${emptySockets} empty socket${emptySockets > 1 ? 's' : ''} — free stats`);
  if (enchantsExpected && enchantRatio < 0.75) actions.push(`${enchantable.length - enchanted} of ${enchantable.length} slots unenchanted`);
  if (days > 30) actions.push(`Not played in ${relativeTime(member.lastLogin).replace(' ago', '')}`);
  if (!actions.length) actions.push('Raid ready — check raid gaps next');

  return {
    score, risk, emptySockets, enchantRatio, enchanted,
    enchantableCount: enchantable.length,
    enchantsExpected,
    bossKills: lifeStats.bossesDefeated || 0,
    gearPct, prepPct, activityPct, actions,
  };
}

function renderReadiness() {
  const grid = document.getElementById('readiness-grid');
  const summary = document.getElementById('readiness-summary');
  if (!grid || !summary) return;

  const scoped = scopedMembers();
  const ctx = buildReadinessContext(scoped);
  let rows = scoped.map(m => ({ ...m, readiness: getReadiness(m, ctx) }));
  if (readinessOwnerFilter) rows = rows.filter(m => m.owner === readinessOwnerFilter);
  if (readinessRiskFilter) rows = rows.filter(m => m.readiness.risk === readinessRiskFilter);
  rows.sort((a, b) => b.readiness.score - a.readiness.score || (b.averageIlvl || 0) - (a.averageIlvl || 0));

  // Summary reflects the same owner filter the cards do, so the tiles and the
  // grid can never disagree.
  const summaryPool = readinessOwnerFilter
    ? scoped.filter(m => m.owner === readinessOwnerFilter)
    : scoped;
  const scores = summaryPool.map(m => getReadiness(m, ctx));
  const count = risk => scores.filter(r => r.risk === risk).length;
  const avg = scores.length ? Math.round(scores.reduce((s, r) => s + r.score, 0) / scores.length) : 0;
  summary.innerHTML = `
    <div><span>${avg}</span><small>avg score</small></div>
    <div><span>${count('ready')}</span><small>ready</small></div>
    <div><span>${count('watch')}</span><small>watch</small></div>
    <div><span>${count('risk')}</span><small>at risk</small></div>`;

  renderGearAudit(rows);

  if (!rows.length) {
    grid.innerHTML = '<div class="empty-state">No characters match the readiness filters.</div>';
    return;
  }

  grid.innerHTML = rows.map(m => {
    const r = m.readiness;
    const color = classColor(m.className);
    const ownerColor = m.owner ? OWNER_COLORS[m.owner] : 'var(--text-dim)';
    const riskLabel = r.risk === 'ready' ? 'Ready' : r.risk === 'watch' ? 'Watch' : 'At risk';
    const riskIcon = r.risk === 'ready' ? '✅' : r.risk === 'watch' ? '⚠️' : '🚨';
    const actions = r.actions.slice(0, 3).map(a => `<li>${esc(a)}</li>`).join('');
    return `
      <div class="readiness-card readiness-${r.risk}" style="--class-color:${esc(color)}"
        role="button" tabindex="0" data-action="open-character" data-name="${esc(m.name)}" data-realm="${esc(m.realm || 'onyxia')}"
        aria-label="${esc(`Open details for ${m.name}, readiness ${r.score} of 100`)}">
        <div class="readiness-score-ring"><span>${r.score}</span><small>/100</small></div>
        <div class="readiness-card-main">
          <div class="readiness-card-top">
            <div>
              <div class="readiness-name" style="color:${esc(color)}">${esc(m.name)}</div>
              <div class="readiness-meta">L${esc(m.level)} ${esc(m.spec || '')} ${esc(m.className)} · ilvl ${m.averageIlvl || '—'}</div>
            </div>
            <div class="readiness-status">${riskIcon} ${riskLabel}</div>
          </div>
          <div class="readiness-bars">
            <div><label>Gear</label><span><i style="width:${clampPct(r.gearPct * 100)}%"></i></span></div>
            <div><label>Prep</label><span><i style="width:${clampPct(r.prepPct * 100)}%"></i></span></div>
            <div><label>Activity</label><span><i style="width:${clampPct(r.activityPct * 100)}%"></i></span></div>
          </div>
          <div class="readiness-foot">
            <span style="color:${esc(ownerColor)}">${m.owner ? `● ${esc(m.owner)}` : '● unassigned'}</span>
            <span>${r.enchanted}/${r.enchantableCount} enchanted</span>
            <span>${r.emptySockets} empty socket${r.emptySockets === 1 ? '' : 's'}</span>
          </div>
          <ul class="readiness-actions">${actions}</ul>
        </div>
      </div>`;
  }).join('');
}

// === Gear Audit board ===
// A slot-by-character grid of the two things that are free to fix and easy to
// forget: empty sockets and missing enchants.
let gearAuditOpen = false;

function toggleGearAudit() {
  gearAuditOpen = !gearAuditOpen;
  const wrap = document.getElementById('gear-audit-wrap');
  const btn = document.getElementById('btn-gear-audit');
  if (wrap) wrap.classList.toggle('hidden', !gearAuditOpen);
  if (btn) {
    btn.setAttribute('aria-expanded', String(gearAuditOpen));
    btn.textContent = gearAuditOpen ? '▾ Hide gear audit' : '▸ Show gear audit';
  }
}

const AUDIT_SLOTS = [
  'Head', 'Neck', 'Shoulders', 'Back', 'Chest', 'Wrist', 'Hands', 'Waist',
  'Legs', 'Feet', 'Ring 1', 'Ring 2', 'Trinket 1', 'Trinket 2', 'Main Hand', 'Off Hand',
];

// Columns are ~30px wide, so the header needs a real short name rather than a
// blind truncation ("Shoulders" -> "SHO" reads as nothing).
const SLOT_ABBR = {
  'Head': 'Head', 'Neck': 'Neck', 'Shoulders': 'Shld', 'Back': 'Back', 'Chest': 'Chest',
  'Wrist': 'Wrist', 'Hands': 'Hands', 'Waist': 'Waist', 'Legs': 'Legs', 'Feet': 'Feet',
  'Ring 1': 'Ring1', 'Ring 2': 'Ring2', 'Trinket 1': 'Trk1', 'Trinket 2': 'Trk2',
  'Main Hand': 'MH', 'Off Hand': 'OH',
};

function renderGearAudit(rows) {
  const wrap = document.getElementById('gear-audit');
  const btn = document.getElementById('btn-gear-audit');
  if (!wrap) return;

  const withGear = rows.filter(m => (m.equipment || []).length);
  if (!withGear.length) {
    wrap.innerHTML = '<div class="empty-state">No equipment data for the current filters.</div>';
    return;
  }

  let sockets = 0;
  let missingEnchants = 0;
  const body = withGear.map(m => {
    const bySlot = new Map((m.equipment || []).map(i => [i.slot, i]));
    const cells = AUDIT_SLOTS.map(slot => {
      const item = bySlot.get(slot);
      if (!item) return `<td class="audit-cell audit-empty" title="${esc(slot)}: nothing equipped">·</td>`;
      const needsEnchant = ENCHANTABLE_SLOTS.has(slot) && !(item.enchantCount > 0);
      const openSocket = !!item.hasEmptySocket;
      if (openSocket) sockets++;
      if (needsEnchant) missingEnchants++;
      const flags = [openSocket ? 'socket' : '', needsEnchant ? 'enchant' : ''].filter(Boolean);
      const cls = flags.length ? `audit-${flags.join('-')}` : 'audit-ok';
      const glyph = openSocket && needsEnchant ? '◆' : openSocket ? '○' : needsEnchant ? '✦' : '✓';
      const note = flags.length
        ? `${openSocket ? 'empty socket' : ''}${flags.length === 2 ? ', ' : ''}${needsEnchant ? 'no enchant' : ''}`
        : 'socketed and enchanted';
      return `<td class="audit-cell ${cls}" title="${esc(`${slot} — ${item.name} (${item.ilvl}): ${note}`)}">${glyph}</td>`;
    }).join('');
    return `<tr>
      <th scope="row" class="audit-name" style="color:${esc(classColor(m.className))}">${esc(m.name)}</th>
      ${cells}
    </tr>`;
  }).join('');

  if (btn) {
    btn.classList.toggle('hidden', false);
  }
  const headline = document.getElementById('gear-audit-headline');
  if (headline) {
    headline.textContent = sockets || missingEnchants
      ? `${sockets} empty socket${sockets === 1 ? '' : 's'} and ${missingEnchants} unenchanted slot${missingEnchants === 1 ? '' : 's'} across ${withGear.length} character${withGear.length === 1 ? '' : 's'}.`
      : `All ${withGear.length} characters are fully socketed and enchanted.`;
  }

  wrap.innerHTML = `
    <div class="audit-scroll">
      <table class="audit-table">
        <thead>
          <tr><th scope="col" class="audit-name">Character</th>
          ${AUDIT_SLOTS.map(s => `<th scope="col" class="audit-slot" title="${esc(s)}">${esc(SLOT_ABBR[s] || s)}</th>`).join('')}</tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <div class="audit-legend">
      <span><i class="audit-ok">✓</i> good</span>
      <span><i class="audit-socket">○</i> empty socket</span>
      <span><i class="audit-enchant">✦</i> missing enchant</span>
      <span><i class="audit-socket-enchant">◆</i> both</span>
      <span><i class="audit-empty">·</i> nothing equipped</span>
    </div>`;
}

function switchView(view) {
  if (!VIEWS.includes(view)) view = 'roster';
  currentView = view;
  VIEWS.forEach(v => {
    document.getElementById(`view-${v}`).classList.toggle('hidden', v !== view);
    document.getElementById(`tab-${v}`).classList.toggle('active', v === view);
    document.getElementById(`tab-${v}`).setAttribute('aria-selected', String(v === view));
  });
  document.getElementById('active-chips').classList.toggle('hidden', view !== 'roster');
  document.getElementById('filter-bar').classList.toggle('hidden', view !== 'roster');
  // The compare bar belongs to the roster; it can't do anything on other tabs.
  document.getElementById('compare-bar').classList.toggle('hidden', !compareMode || view !== 'roster');

  if (view === 'readiness') { buildReadinessOwnerFilter(); renderReadiness(); }
  if (view === 'leaderboard') { buildLbOwnerFilter(); renderLeaderboard(); }
  if (view === 'raids') { initRaids(); }
  if (view === 'pets') { buildCollectionSelect('pets'); }
  if (view === 'mounts') { buildCollectionSelect('mounts'); }
  updateURL();
}

function buildLbOwnerFilter() {
  const el = document.getElementById('lb-owner-filter');
  if (!el) return;
  const btns = [['', 'All'], ...OWNERS.map(o => [o, o])];
  el.innerHTML = btns.map(([val, label]) => {
    const col = val ? ` style="${pillStyle(OWNER_COLORS[val])}"` : '';
    return `<button class="filter-pill${lbOwnerFilter === val ? ' active' : ''}" type="button" data-action="lb-owner" data-val="${esc(val)}"${col}>${esc(label)}</button>`;
  }).join('');
}

function setLbOwner(val, btn) {
  lbOwnerFilter = val;
  document.querySelectorAll('#lb-owner-filter .filter-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderLeaderboard();
  updateURL();
}

// === Hall of Infamy ===
// Superlatives from the life-stat fields the leaderboard doesn't rank on.
const SUPERLATIVES = [
  { key: 'timesHearthed', title: 'Most Cowardly', icon: '🏠', unit: 'hearthstones', note: 'When in doubt, port out.' },
  { key: 'deathsFromPlayers', title: 'Ganked Hardest', icon: '⚰️', unit: 'deaths to players', note: 'World PvP is a lifestyle.' },
  { key: 'deathsFromFalling', title: 'Worst Landing', icon: '🪂', unit: 'falls', note: 'Gravity remains undefeated.' },
  { key: 'crittersKilled', title: 'Critter Menace', icon: '🐿️', unit: 'critters', note: 'They were no threat to anyone.' },
  { key: 'questsAbandoned', title: 'Commitment Issues', icon: '📜', unit: 'quests abandoned', note: 'Started strong.' },
  { key: 'deathsInDungeons', title: 'Dungeon Liability', icon: '💀', unit: 'deaths in dungeons', note: 'The healer remembers.' },
  { key: 'delvesCompleted', title: 'Delve Enjoyer', icon: '🕳️', unit: 'delves', note: 'Brann says hello.' },
  { key: 'honorableKills', title: 'Most Honorable', icon: '🏹', unit: 'honorable kills', note: 'Actually earned this one.' },
];

function renderHallOfInfamy(members) {
  const el = document.getElementById('hall-of-infamy');
  if (!el) return;

  // One alt tends to top several of these at once. Preferring a character who
  // hasn't won yet spreads the awards across the guild, which is the whole
  // point of the strip; a repeat only happens when nobody else qualifies.
  const claimed = new Set();
  const cards = SUPERLATIVES.map(s => {
    const ranked = members
      .map(m => ({ m, val: (m.lifeStats || {})[s.key] || 0 }))
      .filter(x => x.val > 0)
      .sort((a, b) => b.val - a.val || a.m.name.localeCompare(b.m.name));
    if (!ranked.length) return '';
    const best = ranked.find(x => !claimed.has(x.m.name)) || ranked[0];
    claimed.add(best.m.name);
    const color = classColor(best.m.className);
    return `
      <button class="infamy-card" type="button" data-action="open-character"
        data-name="${esc(best.m.name)}" data-realm="${esc(best.m.realm || 'onyxia')}"
        style="--class-color:${esc(color)}">
        <div class="infamy-title">${s.icon} ${esc(s.title)}</div>
        <div class="infamy-name" style="color:${esc(color)}">${esc(best.m.name)}</div>
        <div class="infamy-val">${best.val.toLocaleString()} <small>${esc(s.unit)}</small></div>
        <div class="infamy-note">${esc(s.note)}</div>
      </button>`;
  }).filter(Boolean).join('');

  el.innerHTML = cards
    ? `<div class="infamy-strip">${cards}</div>`
    : '';
}

function renderContentLeaderboard(members) {
  const sorted = [...members].map(m => {
    const ls = m.lifeStats || {};
    const dungeons = ls.dungeonsEntered || 0;
    const bosses = ls.bossesDefeated || 0;
    const delves = ls.delvesCompleted || 0;
    const raids = ls.raidsEntered || 0;
    return { ...m, dungeons, bosses, delves, raids, total: dungeons + delves + raids };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const dash = '<span style="color:var(--text-dim)">—</span>';
  const rows = sorted.map((m, i) => {
    const color = classColor(m.className);
    const ownerColor = m.owner ? OWNER_COLORS[m.owner] : null;
    return `
      <tr class="lb-row" role="button" tabindex="0" data-action="open-character"
        data-name="${esc(m.name)}" data-realm="${esc(m.realm || 'onyxia')}" aria-label="${esc(`Open details for ${m.name}`)}">
        <td class="lb-rank">${medal(i)}</td>
        <td class="lb-char">
          ${lbPortrait(m, color)}
          <div>
            <div class="lb-name" style="color:${esc(color)}">${esc(m.name)}</div>
            <div class="lb-sub">${esc(m.spec || '')} ${esc(m.className)}</div>
          </div>
        </td>
        <td class="lb-owner-cell">${m.owner ? `<span style="color:${esc(ownerColor)};font-weight:700">● ${esc(m.owner)}</span>` : dash}</td>
        <td class="content-cell">${m.dungeons > 0 ? m.dungeons.toLocaleString() : dash}</td>
        <td class="content-cell">${m.bosses > 0 ? m.bosses.toLocaleString() : dash}</td>
        <td class="content-cell">${m.raids > 0 ? m.raids.toLocaleString() : dash}</td>
        <td class="content-cell">${m.delves > 0 ? m.delves.toLocaleString() : dash}</td>
        <td class="content-cell content-total" style="color:${esc(color)}">${m.total > 0 ? m.total.toLocaleString() : '—'}</td>
      </tr>`;
  }).join('');

  document.getElementById('leaderboard-table').innerHTML = `
    <div class="lb-scroll">
    <table class="lb-table">
      <thead>
        <tr>
          <th class="lb-rank-hd" scope="col">#</th>
          <th scope="col">Character</th>
          <th scope="col">Owner</th>
          <th scope="col">Dungeons</th>
          <th scope="col">Boss Kills</th>
          <th scope="col">Raids</th>
          <th scope="col">Delves</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="8" class="lb-empty">No data</td></tr>'}</tbody>
    </table></div>`;
}

const medal = i => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`);

function lbPortrait(m, color) {
  return m.avatarUrl
    ? `<img src="${esc(m.avatarUrl)}" alt="" class="lb-avatar" width="40" height="40" loading="lazy" onerror="this.replaceWith(lbPlaceholder('${esc(color)}'))">`
    : `<div class="lb-avatar-placeholder" style="color:${esc(color)}">⚔</div>`;
}

function lbPlaceholder(color) {
  const div = document.createElement('div');
  div.className = 'lb-avatar-placeholder';
  div.style.color = color;
  div.textContent = '⚔';
  return div;
}

function renderLeaderboard() {
  const cat = document.getElementById('lb-category')?.value || 'ilvl';
  let members = scopedMembers();
  if (lbOwnerFilter) members = members.filter(m => m.owner === lbOwnerFilter);

  renderHallOfInfamy(members);

  if (cat === 'content') { renderContentLeaderboard(members); return; }

  const LIFESTATS_CATS = ['totalDeaths', 'killingBlows', 'creaturesKilled', 'crittersKilled',
    'questsAbandoned', 'questsCompleted', 'honorableKills', 'deathsFromFalling', 'flightPaths'];

  const getValue = (m) => {
    const s = m.stats || {};
    const ls = m.lifeStats || {};
    switch (cat) {
      case 'ilvl': return m.averageIlvl || 0;
      case 'level': return m.level || 0;
      case 'health': return s.health || 0;
      case 'crit': return s.crit || 0;
      case 'haste': return s.haste || 0;
      case 'mastery': return s.mastery || 0;
      case 'vers': return s.vers || 0;
      case 'armor': return s.armor || 0;
      case 'achievement': return m.achievementPoints || 0;
      default: return ls[cat] || 0;
    }
  };

  const formatVal = (m) => {
    const v = getValue(m);
    if (['crit', 'haste', 'mastery', 'vers'].includes(cat)) return `${v}%`;
    if (['health', 'armor'].includes(cat)) return v.toLocaleString();
    if (LIFESTATS_CATS.includes(cat) && v === 0) return '—';
    return v ? v.toLocaleString() : '—';
  };

  members = [...members].sort((a, b) => getValue(b) - getValue(a) || a.name.localeCompare(b.name));

  const categoryLabels = {
    ilvl: '⚔ Avg ilvl', level: '📊 Level', health: '❤️ Health',
    crit: '🎯 Crit', haste: '⚡ Haste', mastery: '🔵 Mastery',
    vers: '🛡 Vers', armor: '🪖 Armor', achievement: '🏅 Achievements',
    totalDeaths: '💀 Total Deaths', killingBlows: '⚔️ Killing Blows',
    creaturesKilled: '🗡️ Creatures Killed', crittersKilled: '🐿️ Critters Killed',
    questsAbandoned: '📜 Quests Abandoned', questsCompleted: '✅ Quests Completed',
    honorableKills: '🏹 Honorable Kills', deathsFromFalling: '🪂 Deaths from Falling',
    flightPaths: '✈️ Flight Paths',
  };

  const maxVal = members.length ? Math.max(...members.map(getValue)) || 1 : 1;
  const dash = '<span style="color:var(--text-dim)">—</span>';

  const rows = members.map((m, i) => {
    const color = classColor(m.className);
    const ownerColor = m.owner ? OWNER_COLORS[m.owner] : null;
    const pct = clampPct((getValue(m) / maxVal) * 100);
    return `
      <tr class="lb-row" role="button" tabindex="0" data-action="open-character"
        data-name="${esc(m.name)}" data-realm="${esc(m.realm || 'onyxia')}" aria-label="${esc(`Open details for ${m.name}`)}">
        <td class="lb-rank">${medal(i)}</td>
        <td class="lb-char">
          ${lbPortrait(m, color)}
          <div>
            <div class="lb-name" style="color:${esc(color)}">${esc(m.name)}</div>
            <div class="lb-sub">${esc(m.spec || '')} ${esc(m.className)}</div>
          </div>
        </td>
        <td class="lb-owner-cell">${m.owner ? `<span style="color:${esc(ownerColor)};font-weight:700">● ${esc(m.owner)}</span>` : dash}</td>
        <td class="lb-val-cell">
          <div class="lb-bar-row">
            <div class="lb-bar-track"><div class="lb-bar-fill" style="width:${pct}%;background:${esc(color)}"></div></div>
            <span class="lb-val">${formatVal(m)}</span>
          </div>
        </td>
      </tr>`;
  }).join('');

  document.getElementById('leaderboard-table').innerHTML = `
    <div class="lb-scroll">
    <table class="lb-table">
      <thead>
        <tr>
          <th class="lb-rank-hd" scope="col">#</th>
          <th scope="col">Character</th>
          <th scope="col">Owner</th>
          <th scope="col">${esc(categoryLabels[cat] || cat)}</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="4" class="lb-empty">No characters found</td></tr>'}</tbody>
    </table></div>`;
}

// === Full Body Hover ===
// Pointer-only: on touch, the same tap that "hovers" also opens the modal.
let hoverTimeout;
document.addEventListener('mouseenter', e => {
  const card = e.target instanceof Element ? e.target.closest('.char-card[data-fullbody]') : null;
  if (card && window.matchMedia('(hover: hover)').matches) showFullBody(card);
}, true);
document.addEventListener('mouseleave', e => {
  if (e.target instanceof Element && e.target.closest('.char-card')) hideFullBody();
}, true);

function showFullBody(card) {
  const url = card.getAttribute('data-fullbody');
  if (!url) return;
  clearTimeout(hoverTimeout);
  hoverTimeout = setTimeout(() => {
    let tip = document.getElementById('fullbody-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'fullbody-tip';
      tip.className = 'fullbody-tip';
      document.body.appendChild(tip);
    }
    tip.innerHTML = `<img src="${esc(url)}" alt="" width="200" height="260" onerror="this.parentNode.style.display='none'">`;
    tip.style.display = 'block';

    const rect = card.getBoundingClientRect();
    const tipW = 200;
    let left = rect.right + 10;
    if (left + tipW > window.innerWidth) left = Math.max(8, rect.left - tipW - 10);
    tip.style.left = `${left + window.scrollX}px`;
    tip.style.top = `${rect.top + window.scrollY}px`;
  }, 300);
}

function hideFullBody() {
  clearTimeout(hoverTimeout);
  const tip = document.getElementById('fullbody-tip');
  if (tip) tip.style.display = 'none';
}

// === Detail Modal ===
async function openDetail(name, realm) {
  const modal = document.getElementById('modal');
  const body = document.getElementById('modal-body');
  hideFullBody();
  openModalEl(modal);
  body.innerHTML = '<div class="modal-loading">Loading...</div>';

  try {
    let c = allMembers.find(m =>
      m.name === name && (m.realm || 'Onyxia').toLowerCase() === (realm || 'onyxia').toLowerCase(),
    );
    if (!c && API_BASE) {
      const res = await fetch(`${API_BASE}/api/character/${encodeURIComponent(realm)}/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(`${res.status}`);
      c = await res.json();
    }
    if (!c) throw new Error('character not found in snapshot');
    c.owner = getOwner(c.name);
    body.innerHTML = renderDetail(c);
  } catch (err) {
    body.innerHTML = `<div class="modal-error">Failed to load character: ${esc(err.message)}</div>`;
  }
}

// Which slots contribute a given secondary stat, and how much. The equipment
// stat arrays are in the snapshot already but nothing surfaced them before.
function statSources(equipment, statName) {
  return (equipment || [])
    .map(item => ({
      slot: item.slot,
      name: item.name,
      value: (item.stats || []).find(s => s.name === statName)?.value || 0,
    }))
    .filter(s => s.value > 0)
    .sort((a, b) => b.value - a.value);
}

function renderStatSources(equipment) {
  const secondaries = ['Critical Strike', 'Haste', 'Mastery', 'Versatility'];
  const blocks = secondaries.map(stat => {
    const sources = statSources(equipment, stat);
    if (!sources.length) return '';
    const total = sources.reduce((a, s) => a + s.value, 0);
    const segments = sources.map(s => `
      <span class="source-seg" style="width:${clampPct((s.value / total) * 100)}%"
        title="${esc(`${s.slot}: ${s.name} (+${s.value})`)}"></span>`).join('');
    const top = sources.slice(0, 3).map(s => `${esc(s.slot)} ${s.value}`).join(' · ');
    return `
      <div class="source-row">
        <div class="source-head"><span>${esc(stat)}</span><strong>${total.toLocaleString()}</strong></div>
        <div class="source-bar">${segments}</div>
        <div class="source-top">${top}${sources.length > 3 ? ` · +${sources.length - 3} more` : ''}</div>
      </div>`;
  }).filter(Boolean).join('');
  if (!blocks) return '';
  return `<div class="section-title">Where your stats come from</div><div class="source-list">${blocks}</div>`;
}

function renderDetail(c) {
  const color = classColor(c.className);
  const s = c.stats || {};
  const ownerColor = c.owner ? OWNER_COLORS[c.owner] : null;
  const equipment = c.equipment || [];

  const gearRows = equipment.map(item => {
    const qClass = `q-${String(item.quality || 'Common').replace(/\s+/g, '')}`;
    const socketWarn = item.hasEmptySocket ? '<span class="socket-warn" title="Empty socket">⚠</span>' : '';
    const enchantMark = ENCHANTABLE_SLOTS.has(item.slot) && !(item.enchantCount > 0)
      ? '<span class="enchant-warn" title="No enchant">✦</span>' : '';
    return `<tr>
      <td class="gear-slot">${esc(item.slot)}</td>
      <td class="${qClass}">${esc(item.name)}${socketWarn}${enchantMark}</td>
      <td class="ilvl-cell ${qClass}">${esc(item.ilvl)}</td>
      <td class="gear-slot">${esc(item.quality)}</td>
    </tr>`;
  }).join('');

  const armoryUrl = `https://worldofwarcraft.blizzard.com/en-us/character/us/${encodeURIComponent((c.realm || 'onyxia').toLowerCase())}/${encodeURIComponent(c.name.toLowerCase())}`;
  const pct = v => (v === undefined || v === null ? '—' : `${v}%`);

  return `
    <div class="detail-header">
      <div style="border-left:4px solid ${esc(color)};padding-left:14px;flex:1">
        <div class="detail-name" id="modal-title">${esc(c.name)}</div>
        ${c.title ? `<div class="detail-title">${esc(c.title)}</div>` : ''}
        <div class="detail-meta">
          <span class="badge badge-level">L${esc(c.level)}</span>
          <span class="badge badge-class" style="background:${esc(color)};color:${readableTextOn(color)}">${esc(c.className)}</span>
          ${c.spec ? `<span class="badge badge-spec">${esc(c.spec)}</span>` : ''}
          ${c.race ? `<span class="badge badge-plain">${esc(c.race)}</span>` : ''}
          ${c.faction ? `<span class="badge badge-plain">${esc(c.faction)}</span>` : ''}
          ${c.rank !== undefined && c.rank !== null ? `<span class="badge badge-plain">${esc(rankLabel(c.rank))}</span>` : ''}
          ${c.owner ? `<span class="badge badge-plain" style="color:${esc(ownerColor)}">👤 ${esc(c.owner)}</span>` : ''}
        </div>
        <div class="detail-subline">
          ${c.achievementPoints ? `🏆 ${c.achievementPoints.toLocaleString()} achievement points` : ''}
          ${c.lastLogin ? ` · 🕒 last seen ${esc(relativeTime(c.lastLogin))}` : ''}
        </div>
        <a class="armory-link" href="${esc(armoryUrl)}" target="_blank" rel="noopener">⚔ View on Armory ↗</a>
      </div>
      <div style="text-align:right">
        <div class="detail-ilvl">${c.averageIlvl || '—'}</div>
        <div class="detail-ilvl-label">avg ilvl</div>
      </div>
    </div>

    <div class="section-title">Combat Stats</div>
    <div class="stats-grid">
      <div class="stat-box"><div class="stat-box-label">Health</div><div class="stat-box-value">${(s.health || 0).toLocaleString()}</div></div>
      <div class="stat-box"><div class="stat-box-label">Primary Stat</div><div class="stat-box-value">${Math.max(s.strength || 0, s.agility || 0, s.intellect || 0).toLocaleString()}</div></div>
      <div class="stat-box stat-crit"><div class="stat-box-label">Crit</div><div class="stat-box-value">${pct(s.crit)}</div></div>
      <div class="stat-box stat-haste"><div class="stat-box-label">Haste</div><div class="stat-box-value">${pct(s.haste)}</div></div>
      <div class="stat-box stat-mastery"><div class="stat-box-label">Mastery</div><div class="stat-box-value">${pct(s.mastery)}</div></div>
      <div class="stat-box stat-vers"><div class="stat-box-label">Versatility</div><div class="stat-box-value">${pct(s.vers)}</div></div>
      <div class="stat-box"><div class="stat-box-label">Armor</div><div class="stat-box-value">${(s.armor || 0).toLocaleString()}</div></div>
    </div>

    ${renderStatSources(equipment)}

    <div class="section-title">Equipped Gear</div>
    <div class="gear-scroll">
      <table class="gear-table">
        <thead><tr><th scope="col">Slot</th><th scope="col">Item</th><th scope="col">ilvl</th><th scope="col">Quality</th></tr></thead>
        <tbody>${gearRows || '<tr><td colspan="4" class="lb-empty">No equipment in snapshot</td></tr>'}</tbody>
      </table>
    </div>
    ${equipment.some(i => i.hasEmptySocket) ? '<div class="gear-hint">⚠ Empty gem sockets detected — free stat gains available.</div>' : ''}

    ${renderLifeStats(c.lifeStats)}
  `;
}

function renderLifeStats(ls) {
  if (!ls) return '';
  const stats = [
    { label: '💀 Total Deaths', val: ls.totalDeaths, note: ls.deathsFromFalling ? `(${ls.deathsFromFalling} from falling 🪂)` : '' },
    { label: '⚔️ Killing Blows', val: ls.killingBlows },
    { label: '🗡️ Creatures Killed', val: ls.creaturesKilled },
    { label: '🐿️ Critters Killed', val: ls.crittersKilled },
    { label: '✅ Quests Completed', val: ls.questsCompleted },
    { label: '📜 Quests Abandoned', val: ls.questsAbandoned },
    { label: '🏹 Honorable Kills', val: ls.honorableKills },
    { label: '✈️ Flight Paths', val: ls.flightPaths },
    { label: '🏠 Times Hearthed', val: ls.timesHearthed },
    { label: '🕳️ Delves Completed', val: ls.delvesCompleted },
    { label: '⚰️ Deaths to Players', val: ls.deathsFromPlayers },
  ].filter(s => s.val > 0);
  if (!stats.length) return '';

  return `
    <div class="section-title">Life Stats</div>
    <div class="stats-grid">
      ${stats.map(s => `
        <div class="stat-box">
          <div class="stat-box-label">${s.label}</div>
          <div class="stat-box-value">${s.val.toLocaleString()} ${s.note ? `<span class="stat-box-note">${esc(s.note)}</span>` : ''}</div>
        </div>`).join('')}
    </div>
    ${ls.questsAbandoned > ls.questsCompleted ? '<div class="gear-hint">⚠ More quests abandoned than completed. No comment.</div>' : ''}
  `;
}

function closeModal(event) {
  if (!event || event.target === document.getElementById('modal')) {
    closeModalEl(document.getElementById('modal'));
  }
}

// === Compare Mode ===
function toggleCompareMode() {
  compareMode = !compareMode;
  compareSelection = [null, null];
  document.getElementById('btn-compare-mode').classList.toggle('active', compareMode);
  document.getElementById('btn-compare-mode').setAttribute('aria-pressed', String(compareMode));
  document.getElementById('compare-bar').classList.toggle('hidden', !compareMode);
  updateCompareBanner();
  filterAndRender();
}

function cancelCompare() {
  compareMode = false;
  compareSelection = [null, null];
  document.getElementById('btn-compare-mode').classList.remove('active');
  document.getElementById('btn-compare-mode').setAttribute('aria-pressed', 'false');
  document.getElementById('compare-bar').classList.add('hidden');
  updateCompareBanner();
  filterAndRender();
}

function selectForCompare(name) {
  if (compareSelection[0] === name) compareSelection[0] = null;
  else if (compareSelection[1] === name) compareSelection[1] = null;
  else if (!compareSelection[0]) compareSelection[0] = name;
  else if (!compareSelection[1]) compareSelection[1] = name;
  else { compareSelection[0] = compareSelection[1]; compareSelection[1] = name; }
  updateCompareBanner();
  filterAndRender();
}

function updateCompareBanner() {
  document.getElementById('compare-char1').textContent = compareSelection[0] || '— Pick a character';
  document.getElementById('compare-char2').textContent = compareSelection[1] || '— Pick a character';
  document.getElementById('btn-compare-go').disabled = !compareSelection[0] || !compareSelection[1];
}

async function doCompare() {
  if (!compareSelection[0] || !compareSelection[1]) return;

  const modal = document.getElementById('compare-modal');
  const body = document.getElementById('compare-body');
  openModalEl(modal);
  body.innerHTML = '<div class="modal-loading">Loading comparison...</div>';

  try {
    const char1 = allMembers.find(m => m.name === compareSelection[0]);
    const char2 = allMembers.find(m => m.name === compareSelection[1]);
    if (!char1 || !char2) {
      if (API_BASE) {
        const realm1 = char1?.realm || 'onyxia';
        const realm2 = char2?.realm || 'onyxia';
        const res = await fetch(`${API_BASE}/api/compare/${encodeURIComponent(realm1)}/${encodeURIComponent(compareSelection[0])}/${encodeURIComponent(realm2)}/${encodeURIComponent(compareSelection[1])}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        body.innerHTML = renderCompare(data.char1, data.char2);
        return;
      }
      throw new Error('character missing from snapshot');
    }
    body.innerHTML = renderCompare(char1, char2);
  } catch (err) {
    body.innerHTML = `<div class="modal-error">Compare failed: ${esc(err.message)}</div>`;
  }
}

function renderCompare(c1, c2) {
  if (!c1 || !c2) return '<div class="empty-state">One or both characters not found.</div>';

  const col1 = classColor(c1.className);
  const col2 = classColor(c2.className);
  const s1 = c1.stats || {};
  const s2 = c2.stats || {};
  const crossClass = c1.className !== c2.className;

  function statRow(label, v1, v2, suffix = '') {
    const n1 = parseFloat(v1) || 0;
    const n2 = parseFloat(v2) || 0;
    const cls1 = n1 === n2 ? 'equal' : n1 > n2 ? 'better' : 'worse';
    const cls2 = n1 === n2 ? 'equal' : n2 > n1 ? 'better' : 'worse';
    const fmt = v => (typeof v === 'number' ? v.toLocaleString() : esc(v));
    return `
      <tr>
        <td class="compare-cell compare-val ${cls1}">${fmt(v1)}${suffix}</td>
        <td class="compare-label">${esc(label)}</td>
        <td class="compare-cell compare-val ${cls2}">${fmt(v2)}${suffix}</td>
      </tr>`;
  }

  const gearComp = () => {
    const slots = [...new Set([...(c1.equipment || []), ...(c2.equipment || [])].map(i => i.slot))];
    return slots.map(slot => {
      const i1 = (c1.equipment || []).find(i => i.slot === slot);
      const i2 = (c2.equipment || []).find(i => i.slot === slot);
      const v1 = i1?.ilvl || 0;
      const v2 = i2?.ilvl || 0;
      const c1cls = v1 === v2 ? 'equal' : v1 > v2 ? 'better' : 'worse';
      const c2cls = v1 === v2 ? 'equal' : v2 > v1 ? 'better' : 'worse';
      return `<tr>
        <td class="compare-cell compare-gear compare-val ${c1cls}">${i1 ? `${esc(i1.name)} (${v1})` : '—'}</td>
        <td class="compare-label">${esc(slot)}</td>
        <td class="compare-cell compare-gear compare-val ${c2cls}">${i2 ? `${esc(i2.name)} (${v2})` : '—'}</td>
      </tr>`;
    }).join('');
  };

  const head = (c, col) => `
    <div>
      <div class="compare-head-name" style="color:${esc(col)}">${esc(c.name)}</div>
      <div class="compare-head-sub">${esc(c.className)} · ${esc(c.spec || '—')} · L${esc(c.level)}</div>
      <div class="compare-head-ilvl">${c.averageIlvl || '—'}</div>
      <div class="compare-head-label">avg ilvl</div>
    </div>`;

  return `
    <div class="compare-head" id="compare-title">
      ${head(c1, col1)}
      <div class="compare-vs">VS</div>
      ${head(c2, col2)}
    </div>

    <div class="section-title">Stats Comparison</div>
    <table class="compare-table">
      ${statRow('Health', s1.health || 0, s2.health || 0)}
      ${statRow('Primary Stat', Math.max(s1.strength || 0, s1.agility || 0, s1.intellect || 0), Math.max(s2.strength || 0, s2.agility || 0, s2.intellect || 0))}
      ${statRow('Crit', s1.crit || 0, s2.crit || 0, '%')}
      ${statRow('Haste', s1.haste || 0, s2.haste || 0, '%')}
      ${statRow('Mastery', s1.mastery || 0, s2.mastery || 0, '%')}
      ${statRow('Versatility', s1.vers || 0, s2.vers || 0, '%')}
      ${statRow('Armor', s1.armor || 0, s2.armor || 0)}
    </table>

    <div class="section-title">Gear Comparison</div>
    <table class="compare-table">${gearComp()}</table>
    <div class="compare-legend">
      <span class="compare-val better">Green</span> = higher &nbsp;
      <span class="compare-val worse">Red</span> = lower
      ${crossClass ? '<div class="compare-caveat">Different classes stack stats differently — higher isn\'t automatically better here.</div>' : ''}
    </div>
  `;
}

function closeCompareModal(event) {
  if (!event || event.target === document.getElementById('compare-modal')) {
    closeModalEl(document.getElementById('compare-modal'));
  }
}

// ============================================================
// Collections (pets + mounts)
// ============================================================
let mountsData = null;
let mountsFilter = 'all';
let petsData = null;
let petsRarityFilter = '';
let petsFavOnly = false;
let collectionsCache = null;
// Guild-wide ownership counts, so a collection card can say how rare an item is
// among the crew rather than just listing what you own.
let collectionIndex = null;

const QUALITY_COLORS = {
  Epic: '#a335ee', Rare: '#0070dd', Uncommon: '#1eff00', Common: '#ffffff', Poor: '#9d9d9d',
};

function resetCollectionSelect(id) {
  const sel = document.getElementById(id);
  if (!sel) return;
  sel.innerHTML = '<option value="">Select a character...</option>';
  const gridId = id.startsWith('pets') ? 'pets-grid' : 'mounts-grid';
  const summaryId = id.startsWith('pets') ? 'pets-summary' : 'mounts-summary';
  const grid = document.getElementById(gridId);
  const summary = document.getElementById(summaryId);
  if (grid) grid.innerHTML = '';
  if (summary) summary.textContent = '';
}

async function loadCollectionsFile() {
  if (collectionsCache?.slug === currentGuildSlug) return collectionsCache.data;
  const res = await fetch(`data/collections-${currentGuildSlug}.json`, { cache: 'no-cache' });
  // Cache the miss too — a 404 shouldn't re-download a 1 MB file per selection.
  const data = res.ok ? await res.json() : {};
  collectionsCache = { slug: currentGuildSlug, data };
  collectionIndex = null;
  return data;
}

function buildCollectionIndex(data) {
  if (collectionIndex) return collectionIndex;
  const pets = new Map();
  const mounts = new Map();
  const names = Object.keys(data);
  for (const charName of names) {
    for (const p of data[charName]?.pets?.pets || []) {
      const key = p.speciesId || p.name;
      pets.set(key, (pets.get(key) || 0) + 1);
    }
    for (const m of data[charName]?.mounts?.mounts || []) {
      const key = m.mountId || m.name;
      mounts.set(key, (mounts.get(key) || 0) + 1);
    }
  }
  collectionIndex = { pets, mounts, charCount: names.length };
  return collectionIndex;
}

// Only characters that actually appear in the snapshot are offered — the
// snapshot caps collection fetches, so most of the roster has no data.
async function buildCollectionSelect(kind) {
  const selId = kind === 'pets' ? 'pets-char-select' : 'mounts-char-select';
  const gridId = kind === 'pets' ? 'pets-grid' : 'mounts-grid';
  const sel = document.getElementById(selId);
  const grid = document.getElementById(gridId);
  if (!sel) return;

  let data = {};
  try {
    data = await loadCollectionsFile();
  } catch (_) { /* handled below via empty coverage */ }
  buildCollectionIndex(data);

  const covered = scopedMembers().filter(m => data[m.name]?.[kind]);
  if (sel.options.length <= 1) {
    const sorted = covered.slice().sort((a, b) => {
      const oa = a.owner || 'zzz'; const ob = b.owner || 'zzz';
      if (oa !== ob) return oa.localeCompare(ob);
      return (b.averageIlvl || 0) - (a.averageIlvl || 0) || a.name.localeCompare(b.name);
    });
    for (const m of sorted) {
      const opt = document.createElement('option');
      opt.value = `${m.realm || 'onyxia'}|${m.name}`;
      opt.textContent = `${m.owner ? `[${m.owner}] ` : ''}${m.name} — L${m.level} ${m.spec || ''} ${m.className}`;
      sel.appendChild(opt);
    }
  }

  if (grid && !grid.innerHTML.trim()) {
    const icon = kind === 'pets' ? '🐾' : '🐎';
    grid.innerHTML = covered.length
      ? `<div class="empty-state">${icon} Select a character above to view their ${kind} collection.
          <div class="empty-sub">${covered.length} of ${scopedMembers().length} characters in this view have collection data — the hourly snapshot only captures the most active characters.</div>
        </div>`
      : `<div class="empty-state">${icon} No collection data in this snapshot for the current view.
          <div class="empty-sub">Collections are captured for the most active characters each hour. Try the “All” status filter on the Roster tab.</div>
        </div>`;
  }
}

async function loadCollection(kind, name) {
  const data = await loadCollectionsFile();
  const fromSnapshot = data?.[name]?.[kind];
  if (fromSnapshot) return fromSnapshot;
  if (!API_BASE) throw new Error(`${kind} missing from snapshot`);
  const res = await fetch(`${API_BASE}/api/character/onyxia/${encodeURIComponent(name)}/${kind}`);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function loadMounts() {
  const val = document.getElementById('mounts-char-select').value;
  if (!val) return;
  const name = val.split('|')[1];
  const grid = document.getElementById('mounts-grid');
  grid.innerHTML = '<div class="empty-state">Loading mount collection...</div>';
  document.getElementById('mounts-summary').textContent = '';
  try {
    mountsData = await loadCollection('mounts', name);
    renderMounts();
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">🐎 No mount data for ${esc(name)} in this snapshot.
      <div class="empty-sub">${esc(err.message)}</div></div>`;
  }
}

function setMountsFilter(filter, btn) {
  mountsFilter = filter;
  document.querySelectorAll('#mounts-filter-pills .filter-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderMounts();
}

function ownershipLabel(count, total) {
  if (!total) return '';
  if (count <= 1) return `<span class="own-unique" title="No one else in the snapshot has this">only you</span>`;
  return `<span class="own-count" title="${count} of ${total} characters in the snapshot own this">${count}/${total}</span>`;
}

function renderMounts() {
  if (!mountsData) return;
  const searchVal = (document.getElementById('mounts-search')?.value || '').toLowerCase();
  const all = mountsData.mounts || [];
  let mounts = all;

  if (mountsFilter === 'fav') mounts = mounts.filter(m => m.isFavorite);
  if (mountsFilter === 'unusable') mounts = mounts.filter(m => !m.isUsable);
  if (mountsFilter === 'rare' && collectionIndex) {
    mounts = mounts.filter(m => (collectionIndex.mounts.get(m.mountId || m.name) || 0) <= 1);
  }
  if (searchVal) mounts = mounts.filter(m => m.name.toLowerCase().includes(searchVal));

  const favCount = all.filter(m => m.isFavorite).length;
  const uniqueCount = collectionIndex
    ? all.filter(m => (collectionIndex.mounts.get(m.mountId || m.name) || 0) <= 1).length
    : 0;
  document.getElementById('mounts-summary').innerHTML =
    `${mountsData.total} mounts collected · ${favCount} favorited` +
    (collectionIndex ? ` · <strong>${uniqueCount} unique in the guild</strong>` : '') +
    ` · showing ${mounts.length}`;

  const grid = document.getElementById('mounts-grid');
  if (!mounts.length) {
    grid.innerHTML = '<div class="empty-state">No mounts match filters</div>';
    return;
  }

  const total = collectionIndex?.charCount || 0;
  grid.innerHTML = mounts.map(m => {
    const owners = collectionIndex?.mounts.get(m.mountId || m.name) || 0;
    const color = m.isFavorite ? 'var(--gold)' : 'var(--text-bright)';
    const href = m.mountId
      ? `https://www.wowhead.com/mount=${encodeURIComponent(m.mountId)}`
      : `https://www.wowhead.com/search?q=${encodeURIComponent(m.name)}`;
    return `
      <div class="pet-card${m.isFavorite ? ' pet-card-fav' : ''}">
        <div class="pet-quality-bar" style="background:${m.isFavorite ? 'var(--gold)' : 'var(--border)'}"></div>
        <a class="pet-name" style="color:${color}" href="${esc(href)}" target="_blank" rel="noopener">🐎 ${esc(m.name)}</a>
        <div class="pet-meta">
          ${m.isFavorite ? '<span class="pet-fav">⭐</span>' : ''}
          ${!m.isUsable ? '<span class="pet-unusable">🚫 Can\'t use</span>' : ''}
          ${ownershipLabel(owners, total)}
        </div>
      </div>`;
  }).join('');
}

async function loadPets() {
  const val = document.getElementById('pets-char-select').value;
  if (!val) return;
  const name = val.split('|')[1];
  const grid = document.getElementById('pets-grid');
  grid.innerHTML = '<div class="empty-state">Loading pet collection...</div>';
  document.getElementById('pets-summary').textContent = '';
  try {
    petsData = await loadCollection('pets', name);
    renderPets();
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">🐾 No pet data for ${esc(name)} in this snapshot.
      <div class="empty-sub">${esc(err.message)}</div></div>`;
  }
}

function setPetsRarity(rarity, btn) {
  petsRarityFilter = rarity;
  document.querySelectorAll('#pets-rarity-filter .filter-pill').forEach(b => {
    if (b.id !== 'pets-fav-btn') b.classList.remove('active');
  });
  btn.classList.add('active');
  renderPets();
}

function togglePetsFav(btn) {
  petsFavOnly = !petsFavOnly;
  btn.classList.toggle('active', petsFavOnly);
  btn.setAttribute('aria-pressed', String(petsFavOnly));
  renderPets();
}

let petsSearchDebounce;
function onPetsSearch() {
  clearTimeout(petsSearchDebounce);
  petsSearchDebounce = setTimeout(renderPets, 200);
}

let mountsSearchDebounce;
function onMountsSearch() {
  clearTimeout(mountsSearchDebounce);
  mountsSearchDebounce = setTimeout(renderMounts, 200);
}

function renderPets() {
  if (!petsData) return;
  const searchVal = (document.getElementById('pets-search')?.value || '').toLowerCase();
  const all = petsData.pets || [];
  let pets = all;

  if (petsFavOnly) pets = pets.filter(p => p.isFavorite);
  if (petsRarityFilter) pets = pets.filter(p => p.quality === petsRarityFilter);
  if (searchVal) pets = pets.filter(p => p.name.toLowerCase().includes(searchVal));

  const order = ['Epic', 'Rare', 'Uncommon', 'Common', 'Poor'];
  const byRarity = {};
  for (const p of all) byRarity[p.quality] = (byRarity[p.quality] || 0) + 1;
  const rarityStr = Object.entries(byRarity)
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([q, c]) => `<span style="color:${esc(QUALITY_COLORS[q] || '#fff')}">${c} ${esc(q)}</span>`)
    .join(' · ');

  const uniqueInGuild = collectionIndex
    ? all.filter(p => (collectionIndex.pets.get(p.speciesId || p.name) || 0) <= 1).length
    : 0;

  document.getElementById('pets-summary').innerHTML =
    `${petsData.total} total collected · ${petsData.unique} unique · ${rarityStr}` +
    (collectionIndex ? ` · <strong>${uniqueInGuild} unique in the guild</strong>` : '') +
    ` · showing ${pets.length}`;

  const grid = document.getElementById('pets-grid');
  if (!pets.length) {
    grid.innerHTML = '<div class="empty-state">No pets match filters</div>';
    return;
  }

  const total = collectionIndex?.charCount || 0;
  grid.innerHTML = pets.map(p => {
    const color = QUALITY_COLORS[p.quality] || '#fff';
    const owners = collectionIndex?.pets.get(p.speciesId || p.name) || 0;
    const href = p.speciesId
      ? `https://www.wowhead.com/battle-pet=${encodeURIComponent(p.speciesId)}`
      : `https://www.wowhead.com/search?q=${encodeURIComponent(p.name)}`;
    return `
      <div class="pet-card">
        <div class="pet-quality-bar" style="background:${esc(color)}"></div>
        <a class="pet-name" style="color:${esc(color)}" href="${esc(href)}" target="_blank" rel="noopener">${esc(p.name)}</a>
        <div class="pet-meta">
          ${p.isFavorite ? '<span class="pet-fav">⭐</span>' : ''}
          ${p.level >= 25 ? '<span class="pet-maxed">MAX</span>' : `<span class="pet-level">L${esc(p.level)}</span>`}
          ${ownershipLabel(owners, total)}
        </div>
      </div>`;
  }).join('');
}

// ============================================================
// URL-based routing — shareable, bookmarkable dashboard state
// ============================================================
function updateURL() {
  const params = new URLSearchParams();
  if (currentGuildSlug !== 'deaths-edge') params.set('guild', currentGuildSlug);
  if (currentView !== 'roster') params.set('tab', currentView);
  if (sortBy !== 'ilvl') params.set('sort', sortBy);
  if (viewScope !== 'active') params.set('scope', viewScope);
  if (searchQuery) params.set('q', searchQuery);
  if (minLevel > 0) params.set('level', minLevel);
  if (filterOwners.size) params.set('owners', [...filterOwners].join(','));
  if (filterClasses.size) params.set('classes', [...filterClasses].join(','));
  if (filterRaces.size) params.set('races', [...filterRaces].join(','));
  if (filterRanks.size) params.set('ranks', [...filterRanks].join(','));
  if (lbOwnerFilter) params.set('lbowner', lbOwnerFilter);
  if (readinessOwnerFilter) params.set('readyowner', readinessOwnerFilter);
  if (readinessRiskFilter) params.set('readiness', readinessRiskFilter);
  const lbCat = document.getElementById('lb-category')?.value;
  if (lbCat && lbCat !== 'ilvl') params.set('lbcat', lbCat);
  const str = params.toString();
  history.replaceState(null, '', str ? `?${str}` : location.pathname);
}

// Everything here is attacker-controllable, so each value is checked against a
// known set before it reaches state.
function loadFromURL() {
  const params = new URLSearchParams(location.search);
  const pick = (key, allowed) => {
    const v = params.get(key);
    return v && allowed.includes(v) ? v : null;
  };

  currentGuildSlug = pick('guild', Object.keys(GUILDS)) || 'deaths-edge';
  sortBy = pick('sort', SORT_OPTIONS) || 'ilvl';
  viewScope = pick('scope', SCOPES) || 'active';
  if (params.has('q')) searchQuery = params.get('q').slice(0, 60).toLowerCase();
  const lvl = parseInt(params.get('level'), 10);
  minLevel = [70, 80, 90].includes(lvl) ? lvl : 0;

  const csv = key => (params.get(key) || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
  csv('owners').filter(v => OWNERS.includes(v)).forEach(v => filterOwners.add(v));
  csv('classes').filter(v => CLASS_COLORS[v]).forEach(v => filterClasses.add(v));
  // Races and ranks are open sets in the data; they're length-capped and always
  // escaped, and anything unknown simply matches nothing.
  csv('races').forEach(v => filterRaces.add(v.slice(0, 40)));
  csv('ranks').filter(v => /^\d{1,2}$/.test(v)).forEach(v => filterRanks.add(v));

  lbOwnerFilter = pick('lbowner', OWNERS) || '';
  readinessOwnerFilter = pick('readyowner', OWNERS) || '';
  readinessRiskFilter = pick('readiness', ['ready', 'watch', 'risk']) || '';
}

function applyURLTab() {
  const params = new URLSearchParams(location.search);
  const lbCat = params.get('lbcat');
  const catEl = document.getElementById('lb-category');
  if (lbCat && catEl && [...catEl.options].some(o => o.value === lbCat)) catEl.value = lbCat;

  const tab = params.get('tab');
  if (tab && VIEWS.includes(tab) && tab !== 'roster') switchView(tab);
  // Restore pill highlights for filters that came in from the query string.
  if (readinessRiskFilter) {
    document.querySelectorAll('#readiness-risk-filter .filter-pill').forEach(b => {
      b.classList.toggle('active', (b.dataset.risk || '') === readinessRiskFilter);
    });
  }
}

// ============================================================
// Raid Progress Tab
// ============================================================
let raidData = null;
let raidLoaded = false;
let raidDiff = 'normal';
let raidTierIdx = 0;
let raidOwnerFilter = '';

async function initRaids() {
  if (raidLoaded) { renderRaids(); return; }
  document.getElementById('raid-loading').style.display = 'block';
  document.getElementById('raid-content').innerHTML = '';
  try {
    raidData = await fetchData(
      `raid-${currentGuildSlug}.json`,
      `/api/guild/raid-progress?slug=${encodeURIComponent(currentGuildSlug)}`,
    );
    raidLoaded = true;
    if (raidTierIdx >= (raidData.tiers?.length || 0)) raidTierIdx = 0;
    buildRaidTierPills();
    buildRaidOwnerPills();
    document.getElementById('raid-loading').style.display = 'none';
    renderRaids();
  } catch (err) {
    document.getElementById('raid-loading').innerHTML =
      `<div class="modal-error">⚠️ Failed to load raid data: ${esc(err.message)}</div>`;
  }
}

function buildRaidTierPills() {
  const el = document.getElementById('raid-tier-pills');
  if (!el || !raidData?.tiers?.length) return;
  el.innerHTML = raidData.tiers.map((t, i) =>
    `<button class="filter-pill${i === raidTierIdx ? ' active' : ''}" type="button" data-action="raid-tier" data-val="${i}">${esc(t.season)}: ${esc(t.short)}</button>`,
  ).join('');
}

function buildRaidOwnerPills() {
  const el = document.getElementById('raid-owner-pills');
  if (!el) return;
  const pills = [['', 'All'], ...OWNERS.map(o => [o, o])];
  el.innerHTML = pills.map(([val, label]) => {
    const col = val ? ` style="${pillStyle(OWNER_COLORS[val])}"` : '';
    return `<button class="filter-pill${raidOwnerFilter === val ? ' active' : ''}" type="button" data-action="raid-owner" data-val="${esc(val)}"${col}>${esc(label)}</button>`;
  }).join('');
}

function setRaidTier(idx, btn) {
  raidTierIdx = idx;
  document.querySelectorAll('#raid-tier-pills .filter-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderRaids();
}

function setRaidDiff(diff, btn) {
  raidDiff = ['normal', 'heroic', 'mythic'].includes(diff) ? diff : 'normal';
  document.querySelectorAll('#raid-diff-pills .filter-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderRaids();
}

function setRaidOwner(val, btn) {
  raidOwnerFilter = val;
  document.querySelectorAll('#raid-owner-pills .filter-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderRaids();
}

function renderRaids() {
  if (!raidData) return;
  const el = document.getElementById('raid-content');
  const tierDef = raidData.tiers?.[raidTierIdx];
  if (!tierDef) {
    el.innerHTML = '<div class="empty-state">No raid tiers available in this snapshot.</div>';
    return;
  }

  const bossList = tierDef.bosses || [];
  const bossCount = bossList.length;

  // Raid rows follow the same scope as every other tab: the OWNER_MAP crew,
  // filtered by the roster's Active/Archive/All setting.
  const inScope = new Set(scopedMembers().map(m => m.name));
  let members = (raidData.members || []).filter(m => {
    if (!inScope.has(m.name)) return false;
    if (raidOwnerFilter && getOwner(m.name) !== raidOwnerFilter) return false;
    return true;
  });

  const killsIn = (m) => {
    const t = m.tiers?.find(t => t.id === tierDef.id);
    return t ? t.bosses.filter(b => (b.kills[raidDiff] || 0) > 0).length : 0;
  };
  members = members.sort((a, b) => killsIn(b) - killsIn(a) || a.name.localeCompare(b.name));

  const started = members.filter(m => killsIn(m) > 0).length;
  const errored = members.filter(m => m.error).length;
  const diffLabel = raidDiff.charAt(0).toUpperCase() + raidDiff.slice(1);

  const bossHeaders = bossList.map(b =>
    `<div class="raid-boss-header" title="${esc(b.name)}">${esc(b.short || b.name.split(' ')[0])}</div>`,
  ).join('');

  const rows = members.map(m => {
    const owner = getOwner(m.name);
    const ownerColor = owner ? OWNER_COLORS[owner] : 'var(--text-dim)';
    const tier = m.tiers?.find(t => t.id === tierDef.id);
    const kills = tier ? tier.bosses : [];
    const killCount = kills.filter(b => (b.kills[raidDiff] || 0) > 0).length;
    const pct = bossCount ? clampPct((killCount / bossCount) * 100) : 0;

    const bossCells = bossList.map(bossDef => {
      if (m.error) {
        return `<div class="raid-cell raid-unknown" title="${esc(`${bossDef.name}: no data — ${m.error}`)}">?</div>`;
      }
      const bossKill = kills.find(b => b.id === bossDef.id);
      const count = bossKill ? (bossKill.kills[raidDiff] || 0) : 0;
      return count > 0
        ? `<div class="raid-cell raid-kill" title="${esc(`${bossDef.name}: ${count} kill${count > 1 ? 's' : ''}`)}">${count > 1 ? count : '✓'}</div>`
        : `<div class="raid-cell raid-miss" title="${esc(`${bossDef.name}: not killed`)}">—</div>`;
    }).join('');

    return `
      <div class="raid-row">
        <div class="raid-char-name" role="button" tabindex="0" data-action="open-character"
          data-name="${esc(m.name)}" data-realm="${esc(m.realm || 'onyxia')}" title="View character">
          <span class="raid-owner-tag" style="color:${esc(ownerColor)}">${owner ? `[${esc(owner)}]` : ''}</span>
          ${esc(m.name)}
          <span class="raid-progress-text">${m.error ? '—' : `${killCount}/${bossCount}`}</span>
        </div>
        <div class="raid-progress-bar-wrap">
          <div class="raid-progress-bar" style="width:${pct}%;background:${pct === 100 ? 'var(--gold)' : pct > 50 ? 'var(--green)' : '#2980b9'}"></div>
        </div>
        <div class="raid-boss-cells">${bossCells}</div>
      </div>`;
  }).join('');

  // "No kills" and "no data" are different states and must not look the same.
  const anyData = members.some(m => !m.error && m.tiers?.some(t => t.id === tierDef.id));

  el.innerHTML = `
    <div class="raid-header-bar">
      <div class="raid-tier-name">${esc(tierDef.name)}</div>
      <div class="raid-tier-sub">${esc(diffLabel)} — ${started} of ${members.length} in view have kills${errored ? ` · ⚠ ${errored} without data` : ''}</div>
    </div>
    ${!members.length ? '<div class="empty-state">No characters in the current view. Try the Active/Archive filter on the Roster tab.</div>'
      : !anyData ? `<div class="empty-state">
      <div class="empty-icon">⚔️</div>
      <div>No one in this view has entered <strong>${esc(tierDef.name)}</strong> on ${esc(diffLabel)} yet.</div>
      <div class="empty-sub">${errored ? 'Some characters have no raid data in this snapshot.' : 'Kills appear here within an hour of being earned.'}</div>
    </div>` : `
    <div class="raid-scroll">
      <div class="raid-table">
        <div class="raid-table-header">
          <div class="raid-char-name-header">Character</div>
          <div class="raid-progress-header">Progress</div>
          <div class="raid-boss-cells-header">${bossHeaders}</div>
        </div>
        ${rows}
      </div>
    </div>`}
  `;
}
