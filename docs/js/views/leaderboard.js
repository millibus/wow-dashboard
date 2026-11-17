// Leaderboard: one ranked list, category-switched. Every category reads
// straight from the roster summary, so no detail files are fetched.
//
// Two honesty rules shape it:
//   * Item level is ranked ONLY among characters at the level cap. Lower-level
//     gear is on older scales (a dormant level-70 can show 350 against a
//     level-90's 200), so those characters are counted, not ranked.
//   * A character with no value for a metric is never a row with a zero. They
//     are counted under the table instead.

import { el, clear } from '../dom.js';
import { levelCap } from '../config.js';
import { archThumb, classDot, describe, isAtCap, plural, listNames } from './parts.js';
import { identityKey } from '../api.js';

export const CATEGORIES = [
  { key: 'ilvl', label: 'Item level', needs: 'equipment', capOnly: true, of: m => m.ilvl,
    blurb: cap => `Average equipped item level, among characters at level ${cap}.` },
  { key: 'achievements', label: 'Achievement points', needs: 'profile', of: m => m.achievementPoints,
    blurb: () => 'Achievement points. They are shared across an account, so one player’s characters tie.' },
  { key: 'quests', label: 'Quests', needs: 'achievements', of: m => m.lifeStats?.questsCompleted,
    blurb: () => 'Quests completed, all time.' },
  { key: 'bosses', label: 'Boss kills', needs: 'achievements', of: m => m.lifeStats?.bossesDefeated,
    blurb: () => 'Dungeon and raid bosses defeated, all time.' },
  { key: 'content', label: 'Content run', needs: 'achievements',
    of: m => sum(m.lifeStats, ['dungeonsEntered', 'raidsEntered', 'delvesCompleted']),
    blurb: () => 'Dungeons and raids entered plus delves completed, all time.' },
  { key: 'deaths', label: 'Deaths', needs: 'achievements', of: m => m.lifeStats?.totalDeaths,
    blurb: () => 'Total deaths, all time. Most deaths first; make of that what you will.' },
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
  const row = el('div', { class: 'filter-pills', role: 'group', 'aria-label': 'Metric' });
  for (const c of CATEGORIES) {
    row.append(el('button', {
      class: 'pill', type: 'button',
      'aria-pressed': String(state.category === c.key),
      dataset: { fk: `metric:${c.key}` },
      text: c.label,
      onclick: () => actions.setCategory(c.key),
    }));
  }
  container.append(row);
}

export function renderLeaderboard(container, state, onOpen, actions) {
  clear(container);
  const category = CATEGORIES.find(c => c.key === state.category) || CATEGORIES[0];
  const cap = levelCap(state.manifest);
  const members = state.roster?.members || [];
  const capOnly = !!category.capOnly && cap !== null;
  const eligible = capOnly ? members.filter(m => isAtCap(m, state.manifest)) : members;
  const rows = eligible
    .map(m => ({ member: m, value: valueOf(m, category) }))
    .filter(r => r.value !== null)
    .sort((a, b) => b.value - a.value || a.member.name.localeCompare(b.member.name));
  const unknown = eligible.length - rows.length;

  container.append(el('p', { class: 'view-blurb', text: category.blurb(cap) }));

  if (!members.length) {
    container.append(el('div', { class: 'empty-state' },
      el('p', { class: 'empty-title', text: 'No characters to rank.' })));
    return;
  }

  if (!rows.length) {
    const box = el('div', { class: 'empty-state' });
    if (capOnly && eligible.length) {
      const n = eligible.length;
      box.append(
        el('p', { class: 'empty-title', text: 'Item levels are unknown right now.' }),
        el('p', { class: 'empty-hint', text:
          `${n === 1 ? 'One character is' : `${n} characters are`} at level ${cap}, but the armory reported no gear ` +
          `for ${n === 1 ? 'it' : 'them'} in this snapshot. Unknown, not zero.` }),
        el('button', {
          class: 'btn', type: 'button', text: 'See achievement points instead',
          dataset: { fk: 'lb-alt' }, onclick: () => actions.setCategory('achievements'),
        }),
      );
    } else if (capOnly) {
      const top = Math.max(...members.map(m => m.level || 0));
      const leaders = members.filter(m => (m.level || 0) === top).map(m => m.name);
      box.append(
        el('p', { class: 'empty-title', text: `Nobody is level ${cap} yet.` }),
        el('p', { class: 'empty-hint', text:
          `Item level only means something at the cap, so there is no ladder to show. ` +
          `Closest so far: ${listNames(leaders.slice(0, 4))}${leaders.length > 4 ? ' and others' : ''} at level ${top}.` }),
        el('button', {
          class: 'btn', type: 'button', text: 'See achievement points instead',
          dataset: { fk: 'lb-alt' }, onclick: () => actions.setCategory('achievements'),
        }),
      );
    } else {
      box.append(
        el('p', { class: 'empty-title', text: `No ${category.label.toLowerCase()} on record.` }),
        el('p', { class: 'empty-hint', text: 'The armory reported nothing for this in the current snapshot.' }),
      );
    }
    container.append(box);
    return;
  }

  const top = rows[0].value || 1;
  const wrap = el('div', { class: 'lb-wrap' });
  const table = el('table', { class: 'lb-table' },
    el('caption', { class: 'visually-hidden', text: `Characters ranked by ${category.label.toLowerCase()}` }),
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col', class: 'lb-rank-hd', text: 'Rank' }),
      el('th', { scope: 'col', text: 'Character' }),
      el('th', { scope: 'col', class: 'num', text: category.label }),
    )),
  );

  const tbody = el('tbody');
  let rank = 0;
  let lastValue = Symbol('none');
  rows.forEach((row, i) => {
    // Ties share a rank.
    if (row.value !== lastValue) rank = i + 1;
    lastValue = row.value;
    const m = row.member;
    const key = identityKey(m);
    const sub = [describe(m), capOnly ? null : `level ${m.level}`].filter(Boolean).join(' · ');
    tbody.append(el('tr', { class: rank <= 3 ? `is-top is-rank-${rank}` : null },
      el('td', { class: 'lb-rank', text: String(rank) }),
      el('td', {}, el('div', { class: 'lb-who' },
        archThumb(m, { size: 40 }),
        el('span', { class: 'lb-id' },
          el('button', {
            class: 'linklike lb-name', type: 'button', dataset: { fk: `lb:${key}` },
            text: m.name, onclick: () => onOpen(m),
          }),
          el('span', { class: 'lb-sub' }, m.className ? classDot(m.className) : null, el('span', { text: sub })),
        ),
      )),
      el('td', { class: 'lb-value' },
        el('span', { class: 'num', text: row.value.toLocaleString('en-US') }),
        el('span', { class: 'lb-bar', 'aria-hidden': 'true' },
          el('span', { style: { width: `${Math.max(2, Math.round((row.value / top) * 100))}%` } })),
      ),
    ));
  });
  table.append(tbody);
  wrap.append(table);
  container.append(wrap);

  const notes = [];
  if (capOnly && members.length > eligible.length) {
    notes.push(`${plural(members.length - eligible.length, 'character is', 'characters are')} below level ${cap} and not ranked: item level does not compare across levels.`);
  }
  if (unknown) {
    notes.push(`${plural(unknown, 'character has', 'characters have')} no value for this in the snapshot. Unknown is not listed as zero.`);
  }
  for (const text of notes) container.append(el('p', { class: 'note', text }));
}
