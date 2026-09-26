// Leaderboard: one ranked table, category-switched. Every category reads
// straight from the roster summary, so no detail files are fetched.
//
// Members whose backing component is unavailable are listed with "—" rather
// than a zero, and they sort last — an unknown value must never masquerade as
// a real last place.

import { el, clear } from '../dom.js';
import { classInk, ownerColor } from '../config.js';

export const CATEGORIES = [
  { key: 'ilvl', label: 'Item level', unit: null, of: m => m.ilvl, needs: 'equipment' },
  { key: 'content', label: 'Content run', unit: 'runs', needs: 'achievements',
    of: m => sum(m.lifeStats, ['dungeonsEntered', 'raidsEntered', 'delvesCompleted']) },
  { key: 'bosses', label: 'Boss kills', unit: 'kills', needs: 'achievements', of: m => m.lifeStats?.bossesDefeated },
  { key: 'deaths', label: 'Deaths', unit: 'deaths', needs: 'achievements', of: m => m.lifeStats?.totalDeaths },
  { key: 'quests', label: 'Quests', unit: 'quests', needs: 'achievements', of: m => m.lifeStats?.questsCompleted },
  { key: 'achievements', label: 'Achievement points', unit: 'points', needs: 'profile', of: m => m.achievementPoints },
];

function sum(obj, keys) {
  if (!obj) return null;
  let total = null;
  for (const k of keys) {
    if (typeof obj[k] === 'number') total = (total || 0) + obj[k];
  }
  return total;
}

function valueOf(member, category) {
  if (member.components?.[category.needs] === 'unavailable') return null;
  const v = category.of(member);
  return typeof v === 'number' ? v : null;
}

export function renderLeaderboardFilters(container, state, actions) {
  clear(container);
  if (!state.roster) return;
  container.append(el('span', { class: 'filter-group-label', text: 'Metric' }));
  for (const c of CATEGORIES) {
    container.append(el('button', {
      class: 'pill', type: 'button',
      'aria-pressed': String(state.category === c.key),
      text: c.label,
      onclick: () => actions.setCategory(c.key),
    }));
  }
}

export function renderLeaderboard(container, state, onOpen) {
  clear(container);
  const category = CATEGORIES.find(c => c.key === state.category) || CATEGORIES[0];
  const rows = (state.roster?.members || [])
    .filter(m => m.owner)
    .map(m => ({ member: m, value: valueOf(m, category) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.member.name.localeCompare(b.member.name);
      if (a.value === null) return 1;   // unknowns last, never "zero"
      if (b.value === null) return -1;
      return b.value - a.value;
    });

  if (!rows.length) {
    container.append(el('div', { class: 'empty-state' }, el('p', { text: 'No tracked characters to rank.' })));
    return;
  }

  const wrap = el('div', { class: 'matrix-wrap' });
  const table = el('table', { class: 'lb-table' },
    el('caption', { class: 'visually-hidden', text: `Characters ranked by ${category.label.toLowerCase()}` }),
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col', class: 'lb-rank-hd', text: '#' }),
      el('th', { scope: 'col', text: 'Character' }),
      el('th', { scope: 'col', text: 'Owner' }),
      el('th', { scope: 'col', class: 'num', text: category.label }),
    )),
  );

  const tbody = el('tbody');
  let rank = 0;
  let lastValue = Symbol('none');
  rows.forEach((row, i) => {
    // Ties share a rank; unknown values get no rank at all.
    if (row.value !== null) {
      if (row.value !== lastValue) rank = i + 1;
      lastValue = row.value;
    }
    const color = classInk(row.member.className);
    tbody.append(el('tr', {},
      el('td', { class: 'lb-rank', text: row.value === null ? '—' : String(rank) }),
      el('td', {},
        el('button', {
          class: 'linklike', type: 'button', style: { color },
          text: row.member.name, onclick: () => onOpen(row.member),
        }),
        el('span', { class: 'lb-sub', text: [row.member.spec, row.member.className].filter(Boolean).join(' ') }),
      ),
      el('td', {},
        el('span', { class: 'owner' },
          el('span', { class: 'dot', style: { '--owner-color': ownerColor(row.member.owner) } }),
          el('span', { text: row.member.owner }),
        ),
      ),
      el('td', {
        class: 'num',
        title: row.value === null ? 'No data for this metric in the current snapshot' : null,
      }, el('span', { text: row.value === null ? '—' : row.value.toLocaleString('en-US') })),
    ));
  });
  table.append(tbody);
  wrap.append(table);
  container.append(wrap);
  container.append(el('p', {
    class: 'piece-note',
    text: '“—” means the snapshot has no value for that character — not a score of zero.',
  }));
}
