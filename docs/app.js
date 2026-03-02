// === Config ===
// Same-origin when served from the Express server; change to full URL if using GitHub Pages + separate API
const API_BASE = '';

// ============================
// OWNER MAP — edit this!
// Map character names (exact, case-sensitive) to their owner
// ============================
const OWNER_MAP = {
  // potac's characters (from #wow thread, Feb 27):
  'Sanicon': 'potac',
  'Harclive': 'potac',
  'Phenis': 'potac',
  'Blajarm': 'potac',
  'Potac': 'potac',
  'Wicken': 'potac',
  'Llisp': 'potac',
  'Quu': 'potac',
  'Hemahroid': 'potac',
  'Decillin': 'potac',
  'Colonic': 'potac',
  'Trashey': 'potac',
  'Gorgis': 'potac',
  'Babbang': 'potac',
  'Flachewlance': 'potac',
  'Thuun': 'potac',
  'Chargar': 'potac',
  'Asdan': 'potac',
  'Wetseamen': 'potac',

  // Viral's characters:
  'Apocalypsic': 'Viral',
  'Oathos': 'Viral',
  'Incantation': 'Viral',
  'Religious': 'Viral',
  'Zeison': 'Viral',
  'Stray': 'Viral',

  // Revan's characters:
  'Hollyballs': 'Revan',
  'Darthfurball': 'Revan',
  'Revän': 'Revan',
  'Caedus': 'Revan',
  'Jacobyy': 'Revan',
  'Bbaronsamedi': 'Revan',
  'Holyrevan': 'Revan',
  'Krang': 'Revan',
  'Necronomican': 'Revan',
  'Pizo': 'Revan',
  'Jeetkundo': 'Revan',
  'Demonik': 'Revan',
  'Alduen': 'Revan',
  'Dendis': 'Revan',
  // potac's Alliance characters (Riot Act):
  'Huejanus': 'potac',
  'Lumian': 'potac',
  // Revan's Alliance characters (Riot Act):
  'Krisis': 'Revan',
  'Grrumpy': 'Revan',
  'Jacoby': 'Revan',
  'Wolfsbane': 'Revan',
  'Mechaminime': 'Revan',
};

const OWNERS = ['potac', 'Viral', 'Revan'];

const OWNER_COLORS = {
  potac: '#a78bfa',
  Viral: '#34d399',
  Revan: '#f59e0b',
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

// === Filter State ===
let allMembers = [];
let sortBy = 'ilvl';
let filterOwners = new Set(); // empty = all
let filterClasses = new Set();
let filterRaces = new Set();
let minLevel = 0;
let searchQuery = '';
let compareMode = false;
let compareSelection = [null, null];
let currentGuildSlug = 'deaths-edge';

// === Init ===
window.addEventListener('DOMContentLoaded', () => {
  loadGuild(false);

  // ESC closes any open modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('modal')?.classList.add('hidden');
      document.getElementById('compare-modal')?.classList.add('hidden');
    }
  });

  // Back-to-top button
  const btn = document.createElement('button');
  btn.id = 'back-to-top';
  btn.innerHTML = '↑';
  btn.title = 'Back to top';
  btn.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  document.body.appendChild(btn);
  window.addEventListener('scroll', () => {
    btn.style.opacity = window.scrollY > 400 ? '1' : '0';
    btn.style.pointerEvents = window.scrollY > 400 ? 'auto' : 'none';
  });
});

function switchGuild(slug) {
  if (slug === currentGuildSlug) return;
  currentGuildSlug = slug;
  // Update toggle buttons
  document.querySelectorAll('.guild-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.slug === slug);
  });
  // Update header title
  const titles = { 'deaths-edge': "Death's Edge", 'riot-act': 'Riot Act' };
  const subtitles = { 'deaths-edge': '🔴 Horde — Onyxia-US', 'riot-act': '🔵 Alliance — Onyxia-US' };
  const h1 = document.querySelector('h1');
  const sub = document.querySelector('.subtitle');
  if (h1) h1.textContent = titles[slug] || slug;
  if (sub) sub.textContent = subtitles[slug] || 'Onyxia-US';
  // Reset filters
  filterOwners = new Set();
  filterClasses = new Set();
  filterRaces = new Set();
  searchQuery = '';
  const searchEl = document.getElementById('search');
  if (searchEl) searchEl.value = '';
  loadGuild(false);
}

function getOwner(name) {
  return OWNER_MAP[name] || null;
}

async function loadGuild(forceRefresh) {
  try {
    document.getElementById('character-grid').innerHTML = `
      <div class="loading-grid">
        ${Array(8).fill('<div class="skeleton-card"></div>').join('')}
      </div>`;
    document.getElementById('guild-stats').innerHTML = '';

    const url = `${API_BASE}/api/guild?slug=${currentGuildSlug}${forceRefresh ? '&nocache=1' : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();

    allMembers = (data.members || []).map(m => ({
      ...m,
      owner: getOwner(m.name),
    }));

    if (data.lastUpdated) {
      const d = new Date(data.lastUpdated);
      document.getElementById('last-updated').textContent =
        `Updated ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    buildFilterOptions();
    renderGuildStats(data);
    filterAndRender();
  } catch (err) {
    document.getElementById('character-grid').innerHTML =
      `<div class="empty-state">⚠️ Failed to load guild data.<br><small>${err.message}</small><br><br>
       <button class="btn-refresh" onclick="loadGuild(true)">Retry</button></div>`;
    console.error(err);
  }
}

function buildFilterOptions() {
  // Owner tabs
  const ownerEl = document.getElementById('filter-owners');
  ownerEl.innerHTML = `<button class="filter-pill active" data-group="owner" data-val="" onclick="toggleFilter('owner','',this)">All</button>` +
    OWNERS.map(o => {
      const count = allMembers.filter(m => m.owner === o).length;
      if (count === 0) return '';
      return `<button class="filter-pill" data-group="owner" data-val="${o}" style="--pill-color:${OWNER_COLORS[o]}" onclick="toggleFilter('owner','${o}',this)">${o} <span class="pill-count">${count}</span></button>`;
    }).join('');

  // Class pills
  const classes = [...new Set(allMembers.map(m => m.className))].sort();
  const classEl = document.getElementById('filter-classes');
  classEl.innerHTML = classes.map(c => {
    const col = CLASS_COLORS[c] || '#c8a84b';
    const count = allMembers.filter(m => m.className === c).length;
    return `<button class="filter-pill" data-group="class" data-val="${c}" style="--pill-color:${col}" onclick="toggleFilter('class','${c}',this)">${c} <span class="pill-count">${count}</span></button>`;
  }).join('');

  // Race pills
  const races = [...new Set(allMembers.map(m => m.race).filter(Boolean))].sort();
  const raceEl = document.getElementById('filter-races');
  raceEl.innerHTML = races.map(r => {
    const count = allMembers.filter(m => m.race === r).length;
    return `<button class="filter-pill" data-group="race" data-val="${r}" onclick="toggleFilter('race','${r}',this)">${r} <span class="pill-count">${count}</span></button>`;
  }).join('');

  // Sort select
  const sortEl = document.getElementById('sort-select');
  sortEl.value = sortBy;
}

function toggleFilter(group, val, btn) {
  if (group === 'owner') {
    if (val === '') {
      filterOwners.clear();
      document.querySelectorAll('[data-group="owner"]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    } else {
      document.querySelector('[data-group="owner"][data-val=""]').classList.remove('active');
      if (filterOwners.has(val)) {
        filterOwners.delete(val);
        btn.classList.remove('active');
        if (filterOwners.size === 0) document.querySelector('[data-group="owner"][data-val=""]').classList.add('active');
      } else {
        filterOwners.add(val);
        btn.classList.add('active');
      }
    }
  } else if (group === 'class') {
    if (filterClasses.has(val)) {
      filterClasses.delete(val);
      btn.classList.remove('active');
    } else {
      filterClasses.add(val);
      btn.classList.add('active');
    }
  } else if (group === 'race') {
    if (filterRaces.has(val)) {
      filterRaces.delete(val);
      btn.classList.remove('active');
    } else {
      filterRaces.add(val);
      btn.classList.add('active');
    }
  }
  filterAndRender();
}

function clearFilters() {
  filterOwners.clear();
  filterClasses.clear();
  filterRaces.clear();
  minLevel = 0;
  searchQuery = '';
  document.getElementById('search').value = '';
  document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
  const allOwnerBtn = document.querySelector('[data-group="owner"][data-val=""]');
  if (allOwnerBtn) allOwnerBtn.classList.add('active');
  filterAndRender();
}

let searchDebounce;
function onSearch(val) {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    searchQuery = val.toLowerCase();
    filterAndRender();
  }, 200);
}

function onSortChange(val) {
  sortBy = val;
  filterAndRender();
}

function onLevelFilter(val, btn) {
  minLevel = parseInt(val);
  document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filterAndRender();
}

function renderGuildStats(data) {
  const members = data.members || [];
  const maxLevel = members.filter(m => m.level >= 80);
  const avgIlvl = maxLevel.length
    ? Math.round(maxLevel.filter(m => m.averageIlvl > 0).reduce((a, m) => a + m.averageIlvl, 0) / maxLevel.filter(m => m.averageIlvl > 0).length)
    : 0;
  const topIlvl = Math.max(...members.map(m => m.averageIlvl || 0));
  const classes = [...new Set(members.map(m => m.className))].length;

  document.getElementById('guild-stats').innerHTML = `
    <div class="guild-stat"><span class="guild-stat-label">Members</span><span class="guild-stat-value">${members.length}</span></div>
    <div class="guild-stat"><span class="guild-stat-label">Level 80+</span><span class="guild-stat-value">${maxLevel.length}</span></div>
    <div class="guild-stat"><span class="guild-stat-label">Avg ilvl (80+)</span><span class="guild-stat-value">${avgIlvl || '—'}</span></div>
    <div class="guild-stat"><span class="guild-stat-label">Top ilvl</span><span class="guild-stat-value">${topIlvl || '—'}</span></div>
    <div class="guild-stat"><span class="guild-stat-label">Classes</span><span class="guild-stat-value">${classes}</span></div>
  `;
}

function renderActiveChips(filtered, total) {
  const chips = [];

  if (filterOwners.size > 0) {
    filterOwners.forEach(o => chips.push(`<span class="chip" style="--chip-color:${OWNER_COLORS[o]}">${o} <span onclick="toggleFilter('owner','${o}', document.querySelector('[data-group=owner][data-val=${o}]'))" class="chip-x">×</span></span>`));
  }
  if (filterClasses.size > 0) {
    filterClasses.forEach(c => {
      const col = CLASS_COLORS[c] || '#c8a84b';
      chips.push(`<span class="chip" style="--chip-color:${col}">${c} <span class="chip-x" onclick="filterClasses.delete('${c}');document.querySelector('[data-group=class][data-val=\\\"${c}\\\"]').classList.remove('active');filterAndRender()">×</span></span>`);
    });
  }
  if (filterRaces.size > 0) {
    filterRaces.forEach(r => chips.push(`<span class="chip">${r} <span class="chip-x" onclick="filterRaces.delete('${r}');document.querySelector('[data-group=race][data-val=\\\"${r}\\\"]').classList.remove('active');filterAndRender()">×</span></span>`));
  }
  if (searchQuery) {
    chips.push(`<span class="chip">🔍 "${searchQuery}" <span class="chip-x" onclick="searchQuery='';document.getElementById('search').value='';filterAndRender()">×</span></span>`);
  }
  if (minLevel > 0) {
    chips.push(`<span class="chip">Level ${minLevel}+ <span class="chip-x" onclick="minLevel=0;document.querySelectorAll('.level-btn').forEach(b=>b.classList.remove('active'));document.querySelector('.level-btn').classList.add('active');filterAndRender()">×</span></span>`);
  }

  const hasFilters = chips.length > 0;
  document.getElementById('active-chips').innerHTML = `
    <span class="result-count">${filtered} of ${total} characters</span>
    ${chips.join('')}
    ${hasFilters ? `<button class="clear-all-btn" onclick="clearFilters()">Clear all</button>` : ''}
  `;
}

function filterAndRender() {
  let filtered = allMembers.filter(m => {
    if (m.level < minLevel) return false;
    if (filterOwners.size > 0 && !filterOwners.has(m.owner)) return false;
    if (filterClasses.size > 0 && !filterClasses.has(m.className)) return false;
    if (filterRaces.size > 0 && !filterRaces.has(m.race)) return false;
    if (searchQuery) {
      const q = searchQuery;
      if (
        !m.name.toLowerCase().includes(q) &&
        !(m.className||'').toLowerCase().includes(q) &&
        !(m.spec||'').toLowerCase().includes(q) &&
        !(m.race||'').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (sortBy === 'ilvl') return (b.averageIlvl || 0) - (a.averageIlvl || 0);
    if (sortBy === 'level') return (b.level || 0) - (a.level || 0);
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'class') return (a.className || '').localeCompare(b.className || '');
    if (sortBy === 'race') return (a.race || '').localeCompare(b.race || '');
    if (sortBy === 'owner') return (a.owner || 'zzz').localeCompare(b.owner || 'zzz');
    return 0;
  });

  renderActiveChips(filtered.length, allMembers.length);
  const grid = document.getElementById('character-grid');
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state">No characters match your filters.<br><small><a href="#" onclick="clearFilters();return false">Clear filters</a></small></div>';
    return;
  }
  grid.innerHTML = filtered.map(m => renderCard(m)).join('');
}

function renderCard(m) {
  const color = CLASS_COLORS[m.className] || '#c8a84b';
  const isSelected = compareSelection.includes(m.name);
  const selectedClass = isSelected ? 'compare-selected' : '';
  const stats = m.stats || {};
  const owner = m.owner;
  const ownerColor = owner ? OWNER_COLORS[owner] : null;

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
        <div class="stat-bar-fill ${s.cls}" style="width:${Math.min(100, (s.val / s.max) * 100)}%"></div>
      </div>
      <span class="stat-bar-value">${s.val}%</span>
    </div>`).join('');

  const clickAction = compareMode
    ? `onclick="selectForCompare('${m.name}', '${m.realm}')"`
    : `onclick="openDetail('${m.name}', '${m.realm}')"`;

  const portraitHtml = m.avatarUrl
    ? `<img src="${m.avatarUrl}" alt="${m.name}" loading="lazy" onerror="this.parentNode.innerHTML='<div class=\\'card-portrait-placeholder\\'>⚔</div>'">`
    : `<div class="card-portrait-placeholder">⚔</div>`;

  const fullBodyAttr = m.mainRawUrl ? `data-fullbody="${m.mainRawUrl}"` : '';

  const textColor = ['#FFFFFF', '#AAD372', '#FFF468'].includes(color) ? '#111' : '#fff';

  return `
    <div class="char-card ${selectedClass}" style="--class-color:${color}" ${clickAction} ${fullBodyAttr} onmouseenter="showFullBody(this)" onmouseleave="hideFullBody()">
      <div class="card-body">
        <div class="card-portrait">${portraitHtml}</div>
        <div class="card-info">
          <div class="char-name">${m.name}</div>
          ${m.title ? `<div class="char-title-text">${m.title}</div>` : ''}
          <div class="card-badges">
            <span class="badge badge-level">L${m.level}</span>
            <span class="badge badge-class" style="background:${color};color:${textColor}">${m.className}</span>
            ${m.spec ? `<span class="badge badge-spec">${m.spec}</span>` : ''}
          </div>
          ${m.race ? `<div style="font-size:0.62rem;color:var(--text-dim);margin-top:1px">${m.race}</div>` : ''}
          ${owner ? `<div class="char-owner" style="color:${ownerColor}">● ${owner}</div>` : ''}
          <div class="card-ilvl-block" style="margin-top:auto">
            <span class="char-ilvl">${m.averageIlvl || '—'}</span>
            <span class="char-ilvl-label">avg ilvl</span>
          </div>
        </div>
      </div>
      <div class="card-stats">${barsHtml}</div>
    </div>`;
}

// === View Switching ===
let currentView = 'roster';
let lbOwnerFilter = '';

function switchView(view) {
  currentView = view;
  document.getElementById('view-roster').classList.toggle('hidden', view !== 'roster');
  document.getElementById('view-leaderboard').classList.toggle('hidden', view !== 'leaderboard');
  document.getElementById('view-pets').classList.toggle('hidden', view !== 'pets');
  document.getElementById('view-mounts').classList.toggle('hidden', view !== 'mounts');
  document.getElementById('active-chips').classList.toggle('hidden', view !== 'roster');
  // Hide roster filter bar on non-roster tabs
  const filterBar = document.getElementById('filter-bar');
  if (filterBar) filterBar.classList.toggle('hidden', view !== 'roster');
  document.getElementById('tab-roster').classList.toggle('active', view === 'roster');
  document.getElementById('tab-leaderboard').classList.toggle('active', view === 'leaderboard');
  document.getElementById('tab-pets').classList.toggle('active', view === 'pets');
  document.getElementById('tab-mounts').classList.toggle('active', view === 'mounts');
  if (view === 'leaderboard') { buildLbOwnerFilter(); renderLeaderboard(); }
  if (view === 'pets') { buildPetsCharSelect(); }
  if (view === 'mounts') { buildMountsCharSelect(); }
}

function buildLbOwnerFilter() {
  const el = document.getElementById('lb-owner-filter');
  if (!el || el.childNodes.length > 0) return;
  const btns = [['', 'All'], ...OWNERS.map(o => [o, o])];
  el.innerHTML = btns.map(([val, label]) => {
    const col = val ? `style="--pill-color:${OWNER_COLORS[val]}"` : '';
    const active = lbOwnerFilter === val ? 'active' : '';
    return `<button class="filter-pill ${active}" ${col} onclick="setLbOwner('${val}', this)">${label}</button>`;
  }).join('');
}

function setLbOwner(val, btn) {
  lbOwnerFilter = val;
  document.querySelectorAll('#lb-owner-filter .filter-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderLeaderboard();
}

function renderContentLeaderboard(members) {
  const sorted = [...members].map(m => {
    const ls = m.lifeStats || {};
    const dungeons = ls.dungeonsEntered || 0;
    const bosses = ls.bossesDefeated || 0;
    const delves = ls.delvesCompleted || 0;
    const raids = ls.raidsEntered || 0;
    return { ...m, dungeons, bosses, delves, raids, total: dungeons + delves };
  }).sort((a, b) => b.total - a.total);

  const rows = sorted.map((m, i) => {
    const color = CLASS_COLORS[m.className] || '#c8a84b';
    const owner = m.owner;
    const ownerColor = owner ? OWNER_COLORS[owner] : null;
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}`;
    const portrait = m.avatarUrl
      ? `<img src="${m.avatarUrl}" alt="" class="lb-avatar" loading="lazy">`
      : `<div class="lb-avatar-placeholder" style="color:${color}">⚔</div>`;
    return `
      <tr class="lb-row" onclick="openDetail('${m.name}', '${m.realm || 'onyxia'}')">
        <td class="lb-rank">${medal}</td>
        <td class="lb-char">
          ${portrait}
          <div>
            <div class="lb-name" style="color:${color}">${m.name}</div>
            <div class="lb-sub">${m.spec || ''} ${m.className}</div>
          </div>
        </td>
        <td class="lb-owner-cell">${owner ? `<span style="color:${ownerColor};font-weight:700">● ${owner}</span>` : '<span style="color:var(--text-dim)">—</span>'}</td>
        <td class="content-cell">${m.dungeons > 0 ? m.dungeons.toLocaleString() : '<span style="color:var(--text-dim)">—</span>'}</td>
        <td class="content-cell">${m.bosses > 0 ? m.bosses.toLocaleString() : '<span style="color:var(--text-dim)">—</span>'}</td>
        <td class="content-cell">${m.raids > 0 ? m.raids.toLocaleString() : '<span style="color:var(--text-dim)">—</span>'}</td>
        <td class="content-cell">${m.delves > 0 ? m.delves.toLocaleString() : '<span style="color:var(--text-dim)">—</span>'}</td>
        <td class="content-cell content-total" style="color:${color}">${m.total > 0 ? m.total.toLocaleString() : '—'}</td>
      </tr>`;
  }).join('');

  document.getElementById('leaderboard-table').innerHTML = `
    <table class="lb-table">
      <thead>
        <tr>
          <th class="lb-rank-hd">#</th>
          <th>Character</th>
          <th>Owner</th>
          <th>Dungeons</th>
          <th>Boss Kills</th>
          <th>Raids</th>
          <th>Delves</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-dim)">No data</td></tr>'}</tbody>
    </table>`;
}

function renderLeaderboard() {
  const cat = document.getElementById('lb-category')?.value || 'ilvl';
  let members = [...allMembers];
  if (lbOwnerFilter) members = members.filter(m => m.owner === lbOwnerFilter);

  if (cat === 'content') { renderContentLeaderboard(members); return; }

  const LIFESTATS_CATS = ['totalDeaths','killingBlows','creaturesKilled','crittersKilled',
    'questsAbandoned','questsCompleted','honorableKills','deathsFromFalling','flightPaths'];

  const getValue = (m) => {
    const s = m.stats || {};
    const ls = m.lifeStats || {};
    switch(cat) {
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
    if (['crit','haste','mastery','vers'].includes(cat)) return `${v}%`;
    if (['health','armor'].includes(cat)) return v.toLocaleString();
    if (LIFESTATS_CATS.includes(cat) && v === 0) return '—';
    return v ? v.toLocaleString() : '—';
  };

  members.sort((a, b) => getValue(b) - getValue(a));

  const categoryLabels = {
    ilvl: '⚔ Avg ilvl', level: '📊 Level', health: '❤️ Health',
    crit: '🎯 Crit', haste: '⚡ Haste', mastery: '🔵 Mastery',
    vers: '🛡 Vers', armor: '🪖 Armor', achievement: '🏅 Achievements',
    totalDeaths: '💀 Total Deaths', killingBlows: '⚔️ Killing Blows',
    creaturesKilled: '🗡️ Creatures Killed', crittersKilled: '🐿️ Critters Killed',
    questsAbandoned: '📜 Quests Abandoned', questsCompleted: '✅ Quests Completed',
    honorableKills: '🏹 Honorable Kills', deathsFromFalling: '🪂 Deaths from Falling',
    flightPaths: '✈️ Flight Paths'
  };

  const maxVal = Math.max(...members.map(m => getValue(m))) || 1;

  const rows = members.map((m, i) => {
    const color = CLASS_COLORS[m.className] || '#c8a84b';
    const owner = m.owner;
    const ownerColor = owner ? OWNER_COLORS[owner] : null;
    const val = getValue(m);
    const pct = Math.round((val / maxVal) * 100);
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}`;
    const portraitHtml = m.avatarUrl
      ? `<img src="${m.avatarUrl}" alt="" class="lb-avatar" loading="lazy">`
      : `<div class="lb-avatar-placeholder" style="color:${color}">⚔</div>`;

    return `
      <tr class="lb-row" onclick="openDetail('${m.name}', '${m.realm || 'onyxia'}')">
        <td class="lb-rank">${medal}</td>
        <td class="lb-char">
          ${portraitHtml}
          <div>
            <div class="lb-name" style="color:${color}">${m.name}</div>
            <div class="lb-sub">${m.spec || ''} ${m.className}</div>
          </div>
        </td>
        <td class="lb-owner-cell">${owner ? `<span style="color:${ownerColor};font-weight:700">● ${owner}</span>` : '<span style="color:var(--text-dim)">—</span>'}</td>
        <td class="lb-val-cell">
          <div class="lb-bar-row">
            <div class="lb-bar-track"><div class="lb-bar-fill" style="width:${pct}%;background:${color}"></div></div>
            <span class="lb-val">${formatVal(m)}</span>
          </div>
        </td>
      </tr>`;
  }).join('');

  document.getElementById('leaderboard-table').innerHTML = `
    <table class="lb-table">
      <thead>
        <tr>
          <th class="lb-rank-hd">#</th>
          <th>Character</th>
          <th>Owner</th>
          <th>${categoryLabels[cat]}</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="4" style="text-align:center;padding:40px;color:var(--text-dim)">No characters found</td></tr>'}</tbody>
    </table>`;
}

// === Full Body Hover ===
let hoverTimeout;
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
    tip.innerHTML = `<img src="${url}" alt="Full render" onerror="this.parentNode.style.display='none'">`;
    tip.style.display = 'block';

    const rect = card.getBoundingClientRect();
    const tipW = 200;
    let left = rect.right + 10;
    if (left + tipW > window.innerWidth) left = rect.left - tipW - 10;
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
  modal.classList.remove('hidden');
  body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-dim)">Loading...</div>';

  try {
    const res = await fetch(`${API_BASE}/api/character/${encodeURIComponent(realm)}/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`${res.status}`);
    const c = await res.json();
    c.owner = getOwner(c.name);
    body.innerHTML = renderDetail(c);
  } catch (err) {
    body.innerHTML = `<div style="text-align:center;padding:40px;color:#e74c3c">Failed to load character: ${err.message}</div>`;
  }
}

function renderDetail(c) {
  const color = CLASS_COLORS[c.className] || '#c8a84b';
  const s = c.stats || {};
  const owner = c.owner;
  const ownerColor = owner ? OWNER_COLORS[owner] : null;

  const gearRows = (c.equipment || []).map(item => {
    const qClass = `q-${item.quality.replace(' ', '')}`;
    const socketWarn = item.hasEmptySocket ? '<span class="socket-warn">⚠</span>' : '';
    return `<tr>
      <td style="color:var(--text-dim)">${item.slot}</td>
      <td class="${qClass}">${item.name}${socketWarn}</td>
      <td class="ilvl-cell ${qClass}">${item.ilvl}</td>
      <td style="color:var(--text-dim)">${item.quality}</td>
    </tr>`;
  }).join('');

  return `
    <div class="detail-header">
      <div style="border-left:4px solid ${color};padding-left:14px;flex:1">
        <div class="detail-name">${c.name}</div>
        ${c.title ? `<div class="detail-title">${c.title}</div>` : ''}
        <div class="detail-meta">
          <span class="badge badge-level">L${c.level}</span>
          <span class="badge badge-class" style="background:${color};color:#000">${c.className}</span>
          ${c.spec ? `<span class="badge badge-spec">${c.spec}</span>` : ''}
          <span class="badge" style="background:rgba(255,255,255,0.05);color:var(--text-dim)">${c.race}</span>
          <span class="badge" style="background:rgba(255,255,255,0.05);color:var(--text-dim)">${c.faction}</span>
          ${owner ? `<span class="badge" style="background:rgba(255,255,255,0.05);color:${ownerColor}">👤 ${owner}</span>` : ''}
        </div>
        ${c.achievementPoints ? `<div style="font-size:0.7rem;color:var(--text-dim);margin-top:6px">🏆 ${c.achievementPoints.toLocaleString()} achievement points</div>` : ''}
        <a href="https://worldofwarcraft.blizzard.com/en-us/character/us/${encodeURIComponent((c.realm||'onyxia').toLowerCase())}/${encodeURIComponent(c.name.toLowerCase())}" target="_blank" rel="noopener" style="display:inline-block;margin-top:8px;font-size:0.72rem;color:var(--gold);text-decoration:none;border:1px solid var(--gold);padding:2px 10px;border-radius:4px;opacity:0.8" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'">⚔ View on Armory ↗</a>
      </div>
      <div style="text-align:right">
        <div class="detail-ilvl">${c.averageIlvl || '—'}</div>
        <div class="detail-ilvl-label">avg ilvl</div>
      </div>
    </div>

    <div class="section-title">Combat Stats</div>
    <div class="stats-grid">
      <div class="stat-box"><div class="stat-box-label">Health</div><div class="stat-box-value">${(s.health || 0).toLocaleString()}</div></div>
      <div class="stat-box"><div class="stat-box-label">Primary Stat</div><div class="stat-box-value">${Math.max(s.strength||0, s.agility||0, s.intellect||0).toLocaleString()}</div></div>
      <div class="stat-box" style="border-color:#e74c3c44"><div class="stat-box-label">Crit</div><div class="stat-box-value" style="color:#e74c3c">${s.crit}%</div></div>
      <div class="stat-box" style="border-color:#f39c1244"><div class="stat-box-label">Haste</div><div class="stat-box-value" style="color:#f39c12">${s.haste}%</div></div>
      <div class="stat-box" style="border-color:#3498db44"><div class="stat-box-label">Mastery</div><div class="stat-box-value" style="color:#3498db">${s.mastery}%</div></div>
      <div class="stat-box" style="border-color:#2ecc7144"><div class="stat-box-label">Versatility</div><div class="stat-box-value" style="color:#2ecc71">${s.vers}%</div></div>
      <div class="stat-box"><div class="stat-box-label">Armor</div><div class="stat-box-value">${(s.armor || 0).toLocaleString()}</div></div>
    </div>

    <div class="section-title">Equipped Gear</div>
    <table class="gear-table">
      <thead><tr>
        <th>Slot</th><th>Item</th><th>ilvl</th><th>Quality</th>
      </tr></thead>
      <tbody>${gearRows}</tbody>
    </table>
    ${(c.equipment || []).some(i => i.hasEmptySocket) ? '<div style="margin-top:10px;font-size:0.75rem;color:#ffeb3b">⚠ Empty gem sockets detected — free stat gains available!</div>' : ''}

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
  ].filter(s => s.val > 0);
  if (!stats.length) return '';

  return `
    <div class="section-title">Life Stats</div>
    <div class="stats-grid">
      ${stats.map(s => `
        <div class="stat-box">
          <div class="stat-box-label">${s.label}</div>
          <div class="stat-box-value">${s.val.toLocaleString()} ${s.note ? `<span style="font-size:0.7rem;color:var(--text-dim)">${s.note}</span>` : ''}</div>
        </div>`).join('')}
    </div>
    ${ls.questsAbandoned > ls.questsCompleted ? '<div style="margin-top:6px;font-size:0.72rem;color:#f39c12">⚠ More quests abandoned than completed. No comment.</div>' : ''}
  `;
}

function closeModal(event) {
  if (!event || event.target === document.getElementById('modal')) {
    document.getElementById('modal').classList.add('hidden');
  }
}

// === Compare Mode ===
function toggleCompareMode() {
  compareMode = !compareMode;
  compareSelection = [null, null];
  document.getElementById('btn-compare-mode').classList.toggle('active', compareMode);
  document.getElementById('compare-bar').classList.toggle('hidden', !compareMode);
  updateCompareBanner();
  filterAndRender();
}

function cancelCompare() {
  compareMode = false;
  compareSelection = [null, null];
  document.getElementById('btn-compare-mode').classList.remove('active');
  document.getElementById('compare-bar').classList.add('hidden');
  filterAndRender();
}

function selectForCompare(name, realm) {
  if (compareSelection[0] === name) {
    compareSelection[0] = null;
  } else if (compareSelection[1] === name) {
    compareSelection[1] = null;
  } else if (!compareSelection[0]) {
    compareSelection[0] = name;
  } else if (!compareSelection[1]) {
    compareSelection[1] = name;
  } else {
    compareSelection[0] = compareSelection[1];
    compareSelection[1] = name;
  }
  updateCompareBanner();
  filterAndRender();
}

function updateCompareBanner() {
  document.getElementById('compare-char1').textContent = compareSelection[0] || '— Pick a character';
  document.getElementById('compare-char2').textContent = compareSelection[1] || '— Pick a character';
  const go = document.getElementById('btn-compare-go');
  go.disabled = !compareSelection[0] || !compareSelection[1];
}

async function doCompare() {
  if (!compareSelection[0] || !compareSelection[1]) return;

  const modal = document.getElementById('compare-modal');
  const body = document.getElementById('compare-body');
  modal.classList.remove('hidden');
  body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-dim)">Loading comparison...</div>';

  try {
    const m1 = allMembers.find(m => m.name === compareSelection[0]);
    const m2 = allMembers.find(m => m.name === compareSelection[1]);
    const realm1 = m1?.realm || 'onyxia';
    const realm2 = m2?.realm || 'onyxia';

    const res = await fetch(`${API_BASE}/api/compare/${encodeURIComponent(realm1)}/${encodeURIComponent(compareSelection[0])}/${encodeURIComponent(realm2)}/${encodeURIComponent(compareSelection[1])}`);
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    body.innerHTML = renderCompare(data.char1, data.char2);
  } catch (err) {
    body.innerHTML = `<div style="text-align:center;padding:40px;color:#e74c3c">Compare failed: ${err.message}</div>`;
  }
}

function renderCompare(c1, c2) {
  if (!c1 || !c2) return '<div class="empty-state">One or both characters not found.</div>';

  const col1 = CLASS_COLORS[c1.className] || '#c8a84b';
  const col2 = CLASS_COLORS[c2.className] || '#c8a84b';
  const s1 = c1.stats || {};
  const s2 = c2.stats || {};

  function statRow(label, v1, v2, higherBetter = true, suffix = '') {
    const n1 = parseFloat(v1) || 0;
    const n2 = parseFloat(v2) || 0;
    const cls1 = n1 === n2 ? 'equal' : (n1 > n2) === higherBetter ? 'better' : 'worse';
    const cls2 = n1 === n2 ? 'equal' : (n2 > n1) === higherBetter ? 'better' : 'worse';
    return `
      <tr>
        <td style="text-align:right;padding:5px 8px" class="compare-val ${cls1}">${typeof v1 === 'number' ? v1.toLocaleString() : v1}${suffix}</td>
        <td style="text-align:center;padding:5px 4px;color:var(--text-dim);font-size:0.7rem;white-space:nowrap">${label}</td>
        <td style="text-align:left;padding:5px 8px" class="compare-val ${cls2}">${typeof v2 === 'number' ? v2.toLocaleString() : v2}${suffix}</td>
      </tr>`;
  }

  const gearComp = () => {
    const slots = [...new Set([...(c1.equipment||[]), ...(c2.equipment||[])].map(i => i.slot))];
    return slots.map(slot => {
      const i1 = c1.equipment?.find(i => i.slot === slot);
      const i2 = c2.equipment?.find(i => i.slot === slot);
      const v1 = i1?.ilvl || 0;
      const v2 = i2?.ilvl || 0;
      const c1cls = v1 === v2 ? 'equal' : v1 > v2 ? 'better' : 'worse';
      const c2cls = v1 === v2 ? 'equal' : v2 > v1 ? 'better' : 'worse';
      return `<tr>
        <td style="text-align:right;padding:4px 8px;font-size:0.78rem" class="${c1cls}">${i1 ? `${i1.name} (${v1})` : '—'}</td>
        <td style="text-align:center;padding:4px 4px;color:var(--text-dim);font-size:0.7rem">${slot}</td>
        <td style="text-align:left;padding:4px 8px;font-size:0.78rem" class="${c2cls}">${i2 ? `${i2.name} (${v2})` : '—'}</td>
      </tr>`;
    }).join('');
  };

  return `
    <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;margin-bottom:20px;text-align:center">
      <div>
        <div style="font-size:1.5rem;font-weight:800;color:${col1}">${c1.name}</div>
        <div style="font-size:0.8rem;color:var(--text-dim)">${c1.className} · ${c1.spec} · L${c1.level}</div>
        <div style="font-size:2rem;font-weight:900;color:var(--gold)">${c1.averageIlvl}</div>
        <div style="font-size:0.65rem;color:var(--text-dim)">avg ilvl</div>
      </div>
      <div style="font-size:1.4rem;font-weight:800;color:var(--red-bright)">VS</div>
      <div>
        <div style="font-size:1.5rem;font-weight:800;color:${col2}">${c2.name}</div>
        <div style="font-size:0.8rem;color:var(--text-dim)">${c2.className} · ${c2.spec} · L${c2.level}</div>
        <div style="font-size:2rem;font-weight:900;color:var(--gold)">${c2.averageIlvl}</div>
        <div style="font-size:0.65rem;color:var(--text-dim)">avg ilvl</div>
      </div>
    </div>

    <div class="section-title">Stats Comparison</div>
    <table style="width:100%;border-collapse:collapse">
      ${statRow('Health', s1.health||0, s2.health||0)}
      ${statRow('Primary Stat', Math.max(s1.strength||0,s1.agility||0,s1.intellect||0), Math.max(s2.strength||0,s2.agility||0,s2.intellect||0))}
      ${statRow('Crit', s1.crit||0, s2.crit||0, true, '%')}
      ${statRow('Haste', s1.haste||0, s2.haste||0, true, '%')}
      ${statRow('Mastery', s1.mastery||0, s2.mastery||0, true, '%')}
      ${statRow('Versatility', s1.vers||0, s2.vers||0, true, '%')}
      ${statRow('Armor', s1.armor||0, s2.armor||0)}
    </table>

    <div class="section-title">Gear Comparison</div>
    <table style="width:100%;border-collapse:collapse">
      ${gearComp()}
    </table>
    <div style="margin-top:10px;font-size:0.7rem;color:var(--text-dim)">
      <span style="color:var(--green)">Green</span> = higher / better &nbsp;
      <span style="color:#e74c3c">Red</span> = lower / worse
    </div>
  `;
}

function closeCompareModal(event) {
  if (!event || event.target === document.getElementById('compare-modal')) {
    document.getElementById('compare-modal').classList.add('hidden');
  }
}

// === Mounts Tab ===
let mountsData = null;
let mountsFilter = 'all';

function buildMountsCharSelect() {
  const sel = document.getElementById('mounts-char-select');
  const grid = document.getElementById('mounts-grid');
  if (grid && !grid.innerHTML.trim()) {
    grid.innerHTML = '<div class="empty-state" style="padding:60px;text-align:center;color:var(--text-dim)">🐎 Select a character above to view their mount collection</div>';
  }
  if (sel.options.length > 1) return;
  const sorted = [...allMembers].sort((a, b) => {
    const oa = a.owner || 'zzz', ob = b.owner || 'zzz';
    if (oa !== ob) return oa.localeCompare(ob);
    return (b.averageIlvl||0) - (a.averageIlvl||0);
  });
  for (const m of sorted) {
    const opt = document.createElement('option');
    opt.value = `${m.realm || 'onyxia'}|${m.name}`;
    const owner = m.owner ? `[${m.owner}] ` : '';
    opt.textContent = `${owner}${m.name} — L${m.level} ${m.spec||''} ${m.className}`;
    sel.appendChild(opt);
  }
}

async function loadMounts() {
  const sel = document.getElementById('mounts-char-select');
  const val = sel.value;
  if (!val) return;
  const [realm, name] = val.split('|');
  const grid = document.getElementById('mounts-grid');
  const summary = document.getElementById('mounts-summary');
  grid.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim)">Loading mount collection...</div>';
  summary.textContent = '';
  try {
    const res = await fetch(`${API_BASE}/api/character/${encodeURIComponent(realm)}/${encodeURIComponent(name)}/mounts`);
    if (!res.ok) throw new Error(`${res.status}`);
    mountsData = await res.json();
    renderMounts();
  } catch (err) {
    grid.innerHTML = `<div style="padding:40px;text-align:center;color:#e74c3c">Failed to load mounts: ${err.message}</div>`;
  }
}

function setMountsFilter(filter, btn) {
  mountsFilter = filter;
  document.querySelectorAll('#mounts-filter-pills .filter-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderMounts();
}

function renderMounts() {
  if (!mountsData) return;
  const searchVal = (document.getElementById('mounts-search')?.value || '').toLowerCase();
  let mounts = mountsData.mounts || [];

  if (mountsFilter === 'fav') mounts = mounts.filter(m => m.isFavorite);
  if (mountsFilter === 'unusable') mounts = mounts.filter(m => !m.isUsable);
  if (searchVal) mounts = mounts.filter(m => m.name.toLowerCase().includes(searchVal));

  const favCount = mountsData.mounts.filter(m => m.isFavorite).length;
  document.getElementById('mounts-summary').textContent =
    `${mountsData.total} mounts collected · ${favCount} favorited · showing ${mounts.length}`;

  const grid = document.getElementById('mounts-grid');
  if (!mounts.length) {
    grid.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim)">No mounts match filters</div>';
    return;
  }

  grid.innerHTML = mounts.map(m => {
    const fav = m.isFavorite ? '<span class="pet-fav">⭐</span>' : '';
    const unusable = !m.isUsable ? '<span style="font-size:0.62rem;color:#e74c3c">🚫 Can\'t use</span>' : '';
    const color = m.isFavorite ? 'var(--gold)' : 'var(--text-bright)';
    return `
      <div class="pet-card" style="border-color:${m.isFavorite ? 'var(--gold)' : '#333'}33">
        <div class="pet-quality-bar" style="background:${m.isFavorite ? 'var(--gold)' : '#555'}"></div>
        <div class="pet-name" style="color:${color}">🐎 ${m.name}</div>
        <div class="pet-meta">${fav}${unusable}</div>
      </div>`;
  }).join('');
}

// === Pets Tab ===
let petsData = null;
let petsRarityFilter = '';
let petsFavOnly = false;

const QUALITY_COLORS = {
  Epic: '#a335ee', Rare: '#0070dd', Uncommon: '#1eff00', Common: '#ffffff', Poor: '#9d9d9d'
};

function buildPetsCharSelect() {
  const sel = document.getElementById('pets-char-select');
  // Show guidance when no character selected
  const grid = document.getElementById('pets-grid');
  if (grid && !grid.innerHTML.trim()) {
    grid.innerHTML = '<div class="empty-state" style="padding:60px;text-align:center;color:var(--text-dim)">🐾 Select a character above to view their pet collection</div>';
  }
  if (sel.options.length > 1) return; // already built
  const sorted = [...allMembers].sort((a, b) => {
    const oa = a.owner || 'zzz', ob = b.owner || 'zzz';
    if (oa !== ob) return oa.localeCompare(ob);
    return (b.averageIlvl||0) - (a.averageIlvl||0);
  });
  for (const m of sorted) {
    const opt = document.createElement('option');
    opt.value = `${m.realm || 'onyxia'}|${m.name}`;
    const owner = m.owner ? `[${m.owner}] ` : '';
    opt.textContent = `${owner}${m.name} — L${m.level} ${m.spec||''} ${m.className}`;
    sel.appendChild(opt);
  }
}

async function loadPets() {
  const sel = document.getElementById('pets-char-select');
  const val = sel.value;
  if (!val) return;
  const [realm, name] = val.split('|');
  const grid = document.getElementById('pets-grid');
  const summary = document.getElementById('pets-summary');
  grid.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim)">Loading pet collection...</div>';
  summary.textContent = '';
  try {
    const res = await fetch(`${API_BASE}/api/character/${encodeURIComponent(realm)}/${encodeURIComponent(name)}/pets`);
    if (!res.ok) throw new Error(`${res.status}`);
    petsData = await res.json();
    renderPets();
  } catch (err) {
    grid.innerHTML = `<div style="padding:40px;text-align:center;color:#e74c3c">Failed to load pets: ${err.message}</div>`;
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
  renderPets();
}

function renderPets() {
  if (!petsData) return;
  const searchVal = (document.getElementById('pets-search')?.value || '').toLowerCase();
  let pets = petsData.pets || [];

  if (petsFavOnly) pets = pets.filter(p => p.isFavorite);
  if (petsRarityFilter) pets = pets.filter(p => p.quality === petsRarityFilter);
  if (searchVal) pets = pets.filter(p => p.name.toLowerCase().includes(searchVal));

  const byRarity = {};
  for (const p of petsData.pets) {
    byRarity[p.quality] = (byRarity[p.quality] || 0) + 1;
  }
  const rarityStr = Object.entries(byRarity)
    .sort((a,b) => ['Epic','Rare','Uncommon','Common','Poor'].indexOf(a[0]) - ['Epic','Rare','Uncommon','Common','Poor'].indexOf(b[0]))
    .map(([q,c]) => `<span style="color:${QUALITY_COLORS[q]||'#fff'}">${c} ${q}</span>`)
    .join(' · ');

  document.getElementById('pets-summary').innerHTML =
    `${petsData.total} total collected · ${petsData.unique} unique · ${rarityStr} · showing ${pets.length}`;

  const grid = document.getElementById('pets-grid');
  if (!pets.length) {
    grid.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim)">No pets match filters</div>';
    return;
  }

  grid.innerHTML = pets.map(p => {
    const color = QUALITY_COLORS[p.quality] || '#fff';
    const fav = p.isFavorite ? '<span class="pet-fav">⭐</span>' : '';
    const maxed = p.level >= 25 ? '<span class="pet-maxed">MAX</span>' : `<span class="pet-level">L${p.level}</span>`;
    return `
      <div class="pet-card" style="border-color:${color}22">
        <div class="pet-quality-bar" style="background:${color}"></div>
        <div class="pet-name" style="color:${color}">${p.name}</div>
        <div class="pet-meta">${fav}${maxed}<span class="pet-rarity" style="color:${color}">${p.quality}</span></div>
      </div>`;
  }).join('');
}
