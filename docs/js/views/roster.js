// Roster view: the lead sentence, the filter drawer, and the list.
//
// Every guild member is listed by default — including the long-dormant ones
// and the ones the armory returns nothing for. "Seen lately" is a filter the
// reader chooses, never the default, because most of this guild is away.
//
// The login threshold compares lastLogin against the ROSTER's own data
// timestamp (when its content last actually changed), not the viewer's clock
// and not the manifest publish time: a carried-forward or unchanged roster
// republished hourly must not gradually reshuffle its members.

import { el, clear } from '../dom.js';
import { identityKey } from '../api.js';
import { classColor, levelCap, ownerLabel } from '../config.js';
import { archThumb, classDot, describe, hasProfile, ilvlText, isAtCap, seenText, plural } from './parts.js';

const DEFAULT_ARCHIVE_DAYS = 30;

export function archiveDays(manifest) {
  return archiveCutoffMs(manifest) / 86400e3;
}

function archiveCutoffMs(manifest) {
  const days = manifest?.config?.archiveThresholdDays;
  return (Number.isFinite(days) && days > 0 ? days : DEFAULT_ARCHIVE_DAYS) * 86400e3;
}

function rosterAsOf(roster, manifest) {
  // updatedAt survives carry-forward and byte-reuse unchanged, so lastLogin
  // values are exactly as of this moment.
  const t = Date.parse(roster?.updatedAt || manifest?.publishedAt || '');
  return Number.isFinite(t) ? t : Date.now();
}

export function isActiveByLogin(member, roster, manifest) {
  if (!member.lastLogin) return false;
  return rosterAsOf(roster, manifest) - member.lastLogin < archiveCutoffMs(manifest);
}

function inScope(member, scope, roster, manifest) {
  if (scope === 'all') return true;
  const active = isActiveByLogin(member, roster, manifest);
  return scope === 'active' ? active : !active;
}

export function filterMembers(state) {
  const members = state.roster?.members || [];
  const q = state.search.trim().toLowerCase();
  return members
    .filter(m => inScope(m, state.scope, state.roster, state.manifest))
    .filter(m => !state.owners.size || state.owners.has(m.owner))
    .filter(m => !state.classes.size || state.classes.has(m.className))
    .filter(m => !state.races.size || state.races.has(m.race))
    .filter(m => !state.minLevel || (m.level || 0) >= state.minLevel)
    .filter(m => !q ||
      m.name.toLowerCase().includes(q) ||
      (m.className || '').toLowerCase().includes(q) ||
      (m.spec || '').toLowerCase().includes(q) ||
      (m.race || '').toLowerCase().includes(q))
    .sort(comparator(state.sort, state.manifest));
}

// The default order is level, then item level among characters AT THE CAP.
// Item level is never compared across levels: a dormant level-70 character's
// 350 is on an older scale than a level-90 character's 200.
// Below the cap even same-level item levels are not a ranking, so those ties
// fall to who was seen last, then name. The cap comes from the manifest.
export function levelOrder(manifest) {
  const cap = levelCap(manifest);
  const capped = m => cap !== null && (m.level || 0) >= cap;
  return (a, b) => (b.level || 0) - (a.level || 0)
    || (capped(a) && capped(b) ? (b.ilvl || 0) - (a.ilvl || 0) : 0)
    || (b.lastLogin || 0) - (a.lastLogin || 0)
    || a.name.localeCompare(b.name);
}

function comparator(sort, manifest) {
  const byLevel = levelOrder(manifest);
  switch (sort) {
    case 'name': return (a, b) => a.name.localeCompare(b.name);
    case 'recent': return (a, b) => (b.lastLogin || 0) - (a.lastLogin || 0) || byLevel(a, b);
    case 'class': return (a, b) =>
      (a.className ? 0 : 1) - (b.className ? 0 : 1)
      || (a.className || '').localeCompare(b.className || '') || byLevel(a, b);
    case 'rank': return (a, b) => (a.rank ?? 99) - (b.rank ?? 99) || byLevel(a, b);
    default: return byLevel;
  }
}

// --- Lead sentence -----------------------------------------------------------

function strong(text) { return el('b', { text: String(text) }); }

// One computed sentence instead of a row of stat tiles. It describes the
// whole guild, not the filtered list.
export function renderLead(container, state) {
  clear(container);
  const members = state.roster?.members || [];
  if (!members.length) return;
  const days = archiveDays(state.manifest);
  const cap = levelCap(state.manifest);
  const active = members.filter(m => isActiveByLogin(m, state.roster, state.manifest)).length;
  const p = el('p', { class: 'lead-line' });
  p.append(strong(members.length), ` ${members.length === 1 ? 'character' : 'characters'}. `);
  if (active) p.append(strong(active), ` seen in the last ${days} days`);
  else p.append(`Nobody seen in the last ${days} days`);
  if (cap !== null) {
    const capped = members.filter(m => isAtCap(m, state.manifest)).length;
    if (capped) {
      p.append(', ', strong(capped), ` at level ${cap}.`);
    } else {
      const top = Math.max(...members.map(m => m.level || 0));
      p.append('. Highest level so far: ', strong(top), ` of ${cap}.`);
    }
  } else {
    p.append('.');
  }
  container.append(p);
}

// --- Filters ---------------------------------------------------------------

function pill(label, pressed, onToggle, { swatch = null, fk } = {}) {
  const children = [];
  if (swatch) children.push(el('span', { class: 'swatch', style: { '--class-color': swatch } }));
  children.push(el('span', { text: label }));
  return el('button', {
    class: 'pill', type: 'button', 'aria-pressed': String(pressed),
    dataset: fk ? { fk } : {}, onclick: onToggle,
  }, ...children);
}

function group(label, ...children) {
  return el('div', { class: 'filter-group', role: 'group', 'aria-label': label },
    el('span', { class: 'filter-group-label', 'aria-hidden': 'true', text: label }),
    el('div', { class: 'filter-pills' }, ...children),
  );
}

export function activeFilterCount(state) {
  return state.owners.size + state.classes.size + state.races.size + (state.minLevel ? 1 : 0);
}

export function renderFilters(container, state, actions) {
  clear(container);
  const members = state.roster?.members || [];
  if (!members.length) return;

  const days = archiveDays(state.manifest);
  const cutActive = m => isActiveByLogin(m, state.roster, state.manifest);
  const activeCount = members.filter(cutActive).length;
  // [scope, label, label on a phone, count]. Only one of the two labels is
  // ever displayed, so the button's accessible name is the text on screen.
  const scopes = [
    ['all', 'Everyone', 'Everyone', members.length],
    ['active', `Seen in ${days} days`, 'Seen lately', activeCount],
    ['archive', 'Away longer', 'Away', members.length - activeCount],
  ];
  const scopeRow = el('div', { class: 'scope-tabs', role: 'group', 'aria-label': 'Who to show' });
  for (const [scope, label, short, count] of scopes) {
    scopeRow.append(el('button', {
      class: 'scope-tab', type: 'button', 'aria-pressed': String(state.scope === scope),
      dataset: { fk: `scope:${scope}` },
      onclick: () => actions.setScope(scope),
    },
      el('span', { class: 'long', text: label }), el('span', { class: 'short', text: short }),
      el('span', { class: 'pill-count', text: String(count) })));
  }

  const activeFilters = activeFilterCount(state);
  const open = !!state.filtersOpen;
  const toggle = el('button', {
    class: 'filters-toggle', type: 'button', 'aria-expanded': String(open),
    'aria-controls': 'filter-panel', dataset: { fk: 'filters-toggle' },
    onclick: () => actions.setFiltersOpen(!open),
  },
    el('span', { class: 'long', text: 'Class, race, level' }), el('span', { class: 'short', text: 'Filters' }),
    activeFilters ? el('span', { class: 'pill-count is-on', text: String(activeFilters) }) : null,
    el('span', { class: 'chev', 'aria-hidden': 'true' }),
  );
  container.append(el('div', { class: 'filters-bar' }, scopeRow, toggle));

  const panel = el('div', { id: 'filter-panel', class: 'filter-panel', hidden: !open });
  container.append(panel);
  if (!open) return;

  // Level thresholds come from config: the raid floor and the cap.
  const cfg = state.manifest?.config || {};
  const levels = [...new Set([cfg.raidMinLevel, cfg.levelCap].filter(n => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
  if (levels.length) {
    panel.append(group('Level',
      pill('Any', !state.minLevel, () => actions.setMinLevel(0), { fk: 'lvl:any' }),
      ...levels.map(lvl => pill(
        lvl === cfg.levelCap ? `${lvl} (cap)` : `${lvl}+`,
        state.minLevel === lvl,
        () => actions.setMinLevel(state.minLevel === lvl ? 0 : lvl),
        { fk: `lvl:${lvl}` },
      )),
    ));
  }

  const classes = [...new Set(members.map(m => m.className).filter(Boolean))].sort();
  if (classes.length) {
    panel.append(group('Class', ...classes.map(cls => pill(
      cls, state.classes.has(cls), () => actions.toggleClass(cls),
      { swatch: classColor(cls), fk: `class:${cls}` },
    ))));
  }

  const races = [...new Set(members.map(m => m.race).filter(Boolean))].sort();
  if (races.length > 1) {
    panel.append(group('Race', ...races.map(race => pill(
      race, state.races.has(race), () => actions.toggleRace(race),
      { fk: `race:${race}` },
    ))));
  }

  // Players are only offered as a filter when the manifest names them. The
  // raw owner ids are never shown.
  const owners = [...new Set(members.map(m => m.owner).filter(Boolean))]
    .map(id => [id, ownerLabel(state.manifest, id)])
    .filter(([, label]) => label)
    .sort((a, b) => a[1].localeCompare(b[1]));
  if (owners.length > 1) {
    panel.append(group('Player', ...owners.map(([id, label]) => pill(
      label, state.owners.has(id), () => actions.toggleOwner(id), { fk: `owner:${id}` },
    ))));
  }

  if (activeFilters) {
    panel.append(el('button', {
      class: 'linklike filter-clear', type: 'button', text: 'Clear these filters',
      dataset: { fk: 'filters-clear' }, onclick: actions.clearFilters,
    }));
  }
}

// --- Rows ------------------------------------------------------------------

function componentNote(member) {
  const c = member.components || {};
  if (c.details === 'carried_forward') return 'older data';
  return null;
}

function metaLine(member, now) {
  const parts = [];
  if (member.race) parts.push(member.race);
  const seen = seenText(member.lastLogin, now);
  if (seen) parts.push(seen);
  const note = componentNote(member);
  if (note) parts.push(note);
  return parts.join(' · ');
}

function row(member, state, onOpen, compare) {
  const key = identityKey(member);
  const selected = !!compare?.active && compare.selected.has(key);
  const known = hasProfile(member);
  const capped = isAtCap(member, state.manifest);
  const what = describe(member);
  const classes = ['char-card'];
  if (selected) classes.push('is-selected');
  if (!known) classes.push('is-bare');
  return el('button', {
    class: classes.join(' '), type: 'button',
    dataset: { key, fk: `row:${key}` },
    'aria-pressed': compare?.active ? String(selected) : null,
    title: compare?.active ? (selected ? 'Selected for comparison' : 'Select for comparison') : null,
    onclick: () => onOpen(member),
  },
    archThumb(member),
    el('span', { class: 'char-id' },
      el('span', { class: 'char-name', text: member.name }),
      el('span', { class: 'char-spec' },
        what ? classDot(member.className) : null,
        el('span', { text: what || 'No armory profile' }),
      ),
      el('span', { class: 'char-meta', text: metaLine(member, Date.now()) }),
    ),
    el('span', { class: 'char-figures' },
      el('span', { class: 'fig-level' },
        el('span', { class: 'visually-hidden', text: 'Level ' }),
        el('b', { text: member.level ? String(member.level) : '—' }),
      ),
      el('span', { class: capped ? 'fig-ilvl is-cap' : 'fig-ilvl' },
        el('span', { class: 'visually-hidden', text: ', item level ' }),
        el('b', { text: ilvlText(member.ilvl) }),
      ),
    ),
    compare?.active ? el('span', { class: 'pick-mark', 'aria-hidden': 'true' }) : null,
  );
}

function columnHead() {
  return el('div', { class: 'roster-colhead', 'aria-hidden': 'true' },
    el('span', { text: 'Level' }),
    el('span', {}, el('span', { class: 'long', text: 'Item level' }), el('span', { class: 'short', text: 'ilvl' })));
}

// The class make-up of the whole guild: one bar, then the counts in words.
function classMakeup(members) {
  const counts = new Map();
  for (const m of members) if (m.className) counts.set(m.className, (counts.get(m.className) || 0) + 1);
  if (!counts.size) return null;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = sorted.reduce((s, [, n]) => s + n, 0);
  const bar = el('div', { class: 'makeup-bar', 'aria-hidden': 'true' });
  const list = el('ul', { class: 'makeup-list' });
  for (const [cls, n] of sorted) {
    bar.append(el('span', { style: { '--class-color': classColor(cls), 'flex-grow': String(n) } }));
    list.append(el('li', {}, classDot(cls), el('span', { text: cls }), el('b', { text: String(n) })));
  }
  const unknown = members.length - total;
  return el('section', { class: 'aside-block' },
    el('h3', { class: 'eyebrow', text: 'Who we brought' }),
    bar, list,
    unknown ? el('p', { class: 'note', text: `${plural(unknown, 'member has', 'members have')} no armory profile, so their class is unknown.` }) : null,
  );
}

function aside(state) {
  const members = state.roster?.members || [];
  const cap = levelCap(state.manifest);
  const box = el('aside', { class: 'roster-aside', 'aria-label': 'About this guild' });
  const makeup = classMakeup(members);
  if (makeup) box.append(makeup);
  box.append(el('section', { class: 'aside-block' },
    el('h3', { class: 'eyebrow', text: 'Reading the numbers' }),
    el('p', { class: 'note', text: cap !== null
      ? `Item level only means something between characters at level ${cap}. Lower-level gear sits on older scales, so it is shown in grey and never ranked.`
      : 'Item level is shown as the armory reports it.' }),
    el('p', { class: 'note', text: 'A dash is a value the armory did not report. It is never zero.' }),
  ));
  return box;
}

// `compare` (optional): { active, selected: Set<key> } — in compare mode the
// rows become toggles and the selected ones are marked.
// `empty` (optional): { hasFilters, onClearFilters, scope, total, onShowAll }
// — an empty list always offers the one action that fills it.
export function renderRoster(container, filtered, state, onOpen, compare = null, empty = null) {
  clear(container);
  const layout = el('div', { class: 'roster-layout' });
  const main = el('div', { class: 'roster-main' });
  layout.append(main);

  if (!filtered.length) {
    const box = el('div', { class: 'empty-state' });
    if (empty?.hasFilters) {
      box.append(
        el('p', { class: 'empty-title', text: 'No characters match these filters.' }),
        el('p', { class: 'empty-hint', text: 'Try removing a filter or clearing the search.' }),
        el('button', { class: 'btn', type: 'button', text: 'Clear filters', dataset: { fk: 'empty-clear' }, onclick: empty.onClearFilters }),
      );
    } else if (empty?.scope && empty.scope !== 'all' && empty.total > 0) {
      const days = archiveDays(state.manifest);
      box.append(
        el('p', { class: 'empty-title', text: empty.scope === 'active' ? 'Nobody has been on lately.' : 'Everybody has been on lately.' }),
        el('p', { class: 'empty-hint', text: empty.scope === 'active'
          ? `No character has logged in within ${days} days of this snapshot.`
          : `Every character has logged in within ${days} days of this snapshot.` }),
        el('button', {
          class: 'btn', type: 'button', dataset: { fk: 'empty-all' },
          text: `Show all ${empty.total} characters`, onclick: empty.onShowAll,
        }),
      );
    } else {
      box.append(el('p', { class: 'empty-title', text: 'This guild has no members in the snapshot.' }));
    }
    main.append(box);
    container.append(layout);
    return;
  }

  const grid = el('div', { class: 'roster-grid' });
  grid.append(columnHead(), columnHead());
  for (const m of filtered) grid.append(row(m, state, onOpen, compare));
  main.append(grid);
  layout.append(aside(state));
  container.append(layout);
}
