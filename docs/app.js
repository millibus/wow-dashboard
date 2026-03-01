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
window.addEventListener('DOMContentLoaded', () => loadGuild(false));

function switchGuild(slug) {
  if (slug === currentGuildSlug) return;
  currentGuildSlug = slug;
  // Update toggle buttons
  document.querySelectorAll('.guild-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.slug === slug);
  });
  // Update header title
  const titles = { 'deaths-edge': 'Deaths Edge', 'riot-act': 'Riot Act' };
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
  document.getElementById('active-chips').classList.toggle('hidden', view !== 'roster');
  document.getElementById('tab-roster').classList.toggle('active', view === 'roster');
  document.getElementById('tab-leaderboard').classList.toggle('active', view === 'leaderboard');
  if (view === 'leaderboard') {
    buildLbOwnerFilter();
    renderLeaderboard();
  }
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

function renderLeaderboard() {
  const cat = document.getElementById('lb-category')?.value || 'ilvl';
  let members = [...allMembers];
  if (lbOwnerFilter) members = members.filter(m => m.owner === lbOwnerFilter);

  const getValue = (m) => {
    const s = m.stats || {};
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
      default: return 0;
    }
  };

  const formatVal = (m) => {
    const v = getValue(m);
    if (['crit','haste','mastery','vers'].includes(cat)) return `${v}%`;
    if (cat === 'health' || cat === 'armor') return v.toLocaleString();
    return v || '—';
  };

  members.sort((a, b) => getValue(b) - getValue(a));

  const categoryLabels = {
    ilvl: '⚔ Avg ilvl', level: '📊 Level', health: '❤️ Health',
    crit: '🎯 Crit', haste: '⚡ Haste', mastery: '🔵 Mastery',
    vers: '🛡 Vers', armor: '🪖 Armor', achievement: '🏅 Achievements'
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
