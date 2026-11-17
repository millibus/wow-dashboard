// Raids view: one tier at a time. With kills on record it is a boss-kill
// matrix (raiders × bosses) under per-difficulty progress; with none — which
// is the guild's real state most of the time — it is the raid's encounter
// list, standing ready, rather than a grid of dashes.
//
// The tier list and boss columns come from the DISCOVERED catalog
// (raid-catalog.json), not from hardcoded IDs. When a member has no kill
// record for a boss the cell reads "—": absence of a kill record is not the
// same as a zero.

import { el, clear } from '../dom.js';
import { DIFFICULTIES } from '../config.js';
import { classDot, plural } from './parts.js';
import { identityKey } from '../api.js';

function tiersOf(catalog) {
  return Array.isArray(catalog?.tiers) ? catalog.tiers : [];
}

// kills[difficulty] per boss, keyed by boss id, for one member.
function killsByBoss(memberRaid, tierId) {
  const tier = (memberRaid?.tiers || []).find(t => t.id === tierId);
  const map = new Map();
  for (const boss of tier?.bosses || []) map.set(boss.id, boss.kills || {});
  return map;
}

export function renderRaidFilters(container, state, actions) {
  clear(container);
  const tiers = tiersOf(state.catalog);
  if (!tiers.length) return;

  const tierRow = el('div', { class: 'filter-group', role: 'group', 'aria-label': 'Raid' },
    el('span', { class: 'filter-group-label', 'aria-hidden': 'true', text: 'Raid' }));
  const pills = el('div', { class: 'filter-pills' });
  for (const tier of tiers) {
    pills.append(el('button', {
      class: 'pill', type: 'button',
      'aria-pressed': String(state.tierId === tier.id),
      dataset: { fk: `tier:${tier.id}` },
      text: tier.season ? `${tier.name} · ${tier.season}` : tier.name,
      onclick: () => actions.setTier(tier.id),
    }));
  }
  tierRow.append(pills);
  container.append(tierRow);

  const seg = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Raid difficulty' });
  for (const d of DIFFICULTIES) {
    seg.append(el('button', {
      type: 'button', 'aria-pressed': String(state.difficulty === d.key),
      dataset: { fk: `diff:${d.key}` },
      text: d.label, onclick: () => actions.setDifficulty(d.key),
    }));
  }
  container.append(el('div', { class: 'filter-group' },
    el('span', { class: 'filter-group-label', 'aria-hidden': 'true', text: 'Difficulty' }), seg));
}

export function renderRaids(container, state, onOpen) {
  clear(container);
  const tiers = tiersOf(state.catalog);

  if (state.raids === null && state.catalog === undefined) {
    container.append(el('div', { class: 'empty-state' }, el('p', { class: 'empty-title', text: 'Loading raids…' })));
    return;
  }
  if (!state.raids || !tiers.length) {
    container.append(el('div', { class: 'empty-state' },
      el('p', { class: 'empty-title', text: state.catalog === null
        ? 'The raid catalog is unavailable in this snapshot.'
        : 'No raid data in this snapshot yet.' }),
      el('p', { class: 'empty-hint', text: 'Boss progress will show here once the next refresh brings it in.' })));
    return;
  }

  const tier = tiers.find(t => t.id === state.tierId) || tiers[0];
  const bosses = tier.bosses || [];
  // Join on the stable Blizzard character id, never the display name: two
  // characters in one guild can share a name across realms, and a name join
  // would give one of them the other's class and detail link.
  const rosterById = new Map((state.roster?.members || []).map(m => [m.id, m]));
  const raiders = (state.raids.members || [])
    .map(r => ({ raid: r, member: rosterById.get(r.id), kills: killsByBoss(r, tier.id) }))
    .filter(row => row.member);

  const clearedAt = d => bosses.filter(boss =>
    raiders.some(r => (r.kills.get(boss.id)?.[d.key] || 0) > 0)).length;
  const cleared = Object.fromEntries(DIFFICULTIES.map(d => [d.key, clearedAt(d)]));
  const anyKill = DIFFICULTIES.some(d => cleared[d.key] > 0);

  container.append(renderTierHeader(tier, bosses, raiders, cleared, state.catalog?.expansionName));

  if (!bosses.length) {
    container.append(el('div', { class: 'empty-state' },
      el('p', { class: 'empty-title', text: `No encounters are listed for ${tier.name}.` }),
      el('p', { class: 'empty-hint', text: 'The discovered catalog has this raid but not its bosses yet.' })));
    return;
  }
  if (!raiders.length) {
    container.append(el('div', { class: 'empty-state' },
      el('p', { class: 'empty-title', text: 'No characters have raid records in this snapshot.' })));
    return;
  }

  if (!anyKill) {
    container.append(renderUnopened(tier, bosses, raiders));
    return;
  }

  const diff = state.difficulty;
  const wrap = el('div', { class: 'matrix-wrap', tabindex: '0', role: 'region', 'aria-label': `${tier.name} boss kills, ${diff}` });
  const table = el('table', { class: 'matrix' });
  const headRow = el('tr', {}, el('th', { scope: 'col', class: 'matrix-corner', text: 'Raider' }));
  for (const boss of bosses) {
    headRow.append(el('th', { scope: 'col', class: 'matrix-boss', title: boss.name },
      el('span', { text: boss.short || boss.name })));
  }
  table.append(el('thead', {}, headRow));

  const tbody = el('tbody');
  for (const { raid, member, kills } of raiders) {
    const row = el('tr', {});
    const nameCell = el('th', { scope: 'row', class: 'matrix-name' });
    nameCell.append(
      member.className ? classDot(member.className) : null,
      el('button', {
        class: 'linklike', type: 'button', dataset: { fk: `raid:${identityKey(member)}` },
        text: member.name, onclick: () => onOpen(member),
      }),
    );
    if (raid.status === 'carried_forward') {
      nameCell.append(el('span', { class: 'note', text: 'older data' }));
    }
    row.append(nameCell);
    for (const boss of bosses) {
      const count = kills.get(boss.id)?.[diff];
      const killed = typeof count === 'number' && count > 0;
      row.append(el('td', {
        class: killed ? 'matrix-cell is-killed' : 'matrix-cell',
        title: `${member.name} — ${boss.name} (${diff}): ${killed ? `${count} kill${count > 1 ? 's' : ''}` : 'no kills recorded'}`,
      }, el('span', { text: killed ? String(count) : '—' })));
    }
    tbody.append(row);
  }
  table.append(tbody);
  wrap.append(table);
  container.append(wrap);
  container.append(el('p', { class: 'note', text: 'Kills are counted per character. A dash means no kill on record, which is not the same as zero attempts. Select a name to open their sheet.' }));
}

function renderTierHeader(tier, bosses, raiders, cleared, expansionName) {
  const head = el('div', { class: 'tier-head' });
  head.append(el('div', { class: 'tier-title' },
    el('p', { class: 'eyebrow', text: [expansionName, tier.season].filter(Boolean).join(' · ') || 'Raid' }),
    el('h3', { text: tier.name }),
    el('p', { class: 'tier-sub', text: [
      plural(bosses.length, 'encounter', 'encounters'),
      `${plural(raiders.length, 'character', 'characters')} tracked`,
    ].join(' · ') }),
  ));

  const meters = el('div', { class: 'tier-meters' });
  for (const d of DIFFICULTIES) {
    const n = cleared[d.key];
    const pct = bosses.length ? Math.round((n / bosses.length) * 100) : 0;
    meters.append(el('div', { class: n ? 'tier-meter is-started' : 'tier-meter' },
      el('span', { class: 'tier-meter-value' },
        el('b', { text: String(n) }),
        el('span', { text: `/${bosses.length}` }),
      ),
      el('span', { class: 'tier-meter-label', text: d.label }),
      el('span', {
        class: 'meter', role: 'img',
        'aria-label': `${d.label}: ${n} of ${bosses.length} bosses down`,
      }, el('span', { class: 'meter-fill', style: { width: `${pct}%` } })),
    ));
  }
  head.append(meters);
  return head;
}

// No kills at any difficulty: show the raid itself — its bosses in order —
// instead of an empty grid.
function renderUnopened(tier, bosses, raiders) {
  const box = el('div', { class: 'unopened' });
  box.append(
    el('div', { class: 'unopened-lede' },
      el('div', { class: 'portal', 'aria-hidden': 'true' }, el('span', {})),
      el('div', {},
        el('p', { class: 'unopened-title', text: 'Nobody has a kill in here yet.' }),
        el('p', { class: 'unopened-hint', text:
          `${tier.name} is untouched on every difficulty. The first boss to fall will be marked here after the next hourly refresh.` }),
      ),
    ),
  );
  const list = el('ol', { class: 'boss-list' });
  bosses.forEach((boss, i) => {
    list.append(el('li', { class: 'boss' },
      el('span', { class: 'boss-n', 'aria-hidden': 'true', text: String(i + 1).padStart(2, '0') }),
      el('span', { class: 'boss-name', text: boss.name }),
      el('span', { class: 'boss-pips', role: 'img', 'aria-label': 'No kills on Normal, Heroic or Mythic' },
        ...DIFFICULTIES.map(d => el('span', { class: 'pip', text: d.short }))),
    ));
  });
  box.append(list);
  box.append(el('p', { class: 'note', text:
    `Tracked for raids: ${raiders.map(r => r.member.name).sort((a, b) => a.localeCompare(b)).join(', ')}.` }));
  return box;
}
