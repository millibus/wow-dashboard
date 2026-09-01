// Roster view: filter pills, stat strip, character card grid.
// The dashboard is scoped to owned characters (owner mapping comes from the
// snapshot's config projection via each member's `owner` field):
//   active  = owned, logged in within the archive threshold
//   archive = owned, not logged in for that long (or never)
//   all     = every owned character
// The threshold compares lastLogin against the ROSTER's own data timestamp
// (when its content last actually changed), not the viewer's clock and not
// the manifest publish time: a carried-forward or unchanged roster republished
// hourly must not gradually reshuffle its members into the archive.

import { el, clear } from '../dom.js';
import { identityKey } from '../api.js';
import { classColor, ownerColor } from '../config.js';

const DEFAULT_ARCHIVE_DAYS = 30;

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
  if (!member.owner) return false;
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
    .filter(m => !q ||
      m.name.toLowerCase().includes(q) ||
      (m.className || '').toLowerCase().includes(q) ||
      (m.spec || '').toLowerCase().includes(q))
    .sort(comparator(state.sort));
}

function comparator(sort) {
  switch (sort) {
    case 'name': return (a, b) => a.name.localeCompare(b.name);
    case 'level': return (a, b) => (b.level || 0) - (a.level || 0) || (b.ilvl || 0) - (a.ilvl || 0);
    case 'class': return (a, b) => (a.className || '').localeCompare(b.className || '') || (b.ilvl || 0) - (a.ilvl || 0);
    default: return (a, b) => (b.ilvl || 0) - (a.ilvl || 0) || (b.level || 0) - (a.level || 0);
  }
}

// --- Filters ---------------------------------------------------------------

function pill(label, pressed, onToggle, swatchColor) {
  const children = [];
  if (swatchColor) children.push(el('span', { class: 'swatch', style: { '--class-color': swatchColor } }));
  children.push(el('span', { text: label }));
  return el('button', {
    class: 'pill', type: 'button', 'aria-pressed': String(pressed), onclick: onToggle,
  }, ...children);
}

export function renderFilters(container, state, actions) {
  clear(container);
  const members = (state.roster?.members || []).filter(m => m.owner);
  if (!members.length) return;

  const cutActive = m => isActiveByLogin(m, state.roster, state.manifest);
  const counts = {
    active: members.filter(cutActive).length,
    archive: members.filter(m => !cutActive(m)).length,
    all: members.length,
  };
  container.append(el('span', { class: 'filter-group-label', text: 'Show' }));
  for (const scope of ['active', 'archive', 'all']) {
    const label = `${scope[0].toUpperCase()}${scope.slice(1)} (${counts[scope]})`;
    container.append(pill(label, state.scope === scope, () => actions.setScope(scope)));
  }

  const owners = [...new Set(members.map(m => m.owner))].sort();
  if (owners.length > 1) {
    container.append(el('span', { class: 'filter-group-label', text: 'Owner' }));
    for (const owner of owners) {
      container.append(pill(owner, state.owners.has(owner), () => actions.toggleOwner(owner), ownerColor(owner)));
    }
  }

  const classes = [...new Set(members.map(m => m.className).filter(Boolean))].sort();
  container.append(el('span', { class: 'filter-group-label', text: 'Class' }));
  for (const cls of classes) {
    container.append(pill(cls, state.classes.has(cls), () => actions.toggleClass(cls), classColor(cls)));
  }
}

// --- Stat strip ------------------------------------------------------------

export function renderStats(container, filtered) {
  clear(container);
  if (!filtered.length) return;
  const withIlvl = filtered.filter(m => m.ilvl);
  const avgIlvl = withIlvl.length
    ? Math.round(withIlvl.reduce((s, m) => s + m.ilvl, 0) / withIlvl.length)
    : null;
  const maxLevel = Math.max(...filtered.map(m => m.level || 0));
  const stats = [
    ['Characters', String(filtered.length), false],
    ['Avg item level', avgIlvl === null ? '—' : String(avgIlvl), true],
    ['Max level', `${filtered.filter(m => m.level === maxLevel).length} at ${maxLevel}`, false],
  ];
  for (const [label, value, gold] of stats) {
    container.append(el('div', { class: gold ? 'stat is-gold' : 'stat' },
      el('b', { text: value }),
      el('span', { text: label }),
    ));
  }
}

// --- Cards -----------------------------------------------------------------

function monogram(member) {
  const box = el('span', { class: 'monogram', style: { '--class-color': classColor(member.className) }, 'aria-hidden': 'true' });
  if (member.avatarUrl) {
    box.append(el('img', { src: member.avatarUrl, alt: '', loading: 'lazy' }));
    // A broken render-service image falls back to the initial.
    box.firstChild?.addEventListener('error', () => {
      clear(box);
      box.textContent = member.name[0] || '?';
    });
  } else {
    box.textContent = member.name[0] || '?';
  }
  return box;
}

function componentNote(member) {
  const c = member.components || {};
  if (c.details === 'unavailable') return 'details unavailable';
  if (c.details === 'carried_forward') return 'older data';
  return null;
}

export function renderRoster(container, filtered, onOpen) {
  clear(container);
  if (!filtered.length) {
    container.append(el('div', { class: 'empty-state' },
      el('p', { text: 'No characters match the current filters.' }),
    ));
    return;
  }
  const grid = el('div', { class: 'roster-grid' });
  for (const m of filtered) {
    const color = classColor(m.className);
    const note = componentNote(m);
    const card = el('button', {
      class: 'char-card', type: 'button',
      style: { '--class-color': color },
      dataset: { key: identityKey(m) },
      onclick: () => onOpen(m),
    },
      el('span', { class: 'row' },
        monogram(m),
        el('span', { class: 'char-id' },
          el('span', { class: 'char-name', text: m.name }),
          el('span', { class: 'char-spec', text: [m.spec, m.className].filter(Boolean).join(' ') || 'Unknown' }),
        ),
        el('span', { class: 'char-ilvl' },
          el('b', { text: m.ilvl ? String(Math.round(m.ilvl)) : '—' }),
          el('span', { text: 'ILVL' }),
        ),
      ),
      el('span', { class: 'char-meta' },
        el('span', { class: 'lvl', text: `Lv ${m.level || '?'}` }),
        m.race ? el('span', { text: m.race }) : null,
        note ? el('span', { class: 'piece-note', text: note }) : null,
        m.owner ? el('span', { class: 'owner' },
          el('span', { class: 'dot', style: { '--owner-color': ownerColor(m.owner) } }),
          el('span', { text: m.owner }),
        ) : null,
      ),
    );
    grid.append(card);
  }
  container.append(grid);
}
