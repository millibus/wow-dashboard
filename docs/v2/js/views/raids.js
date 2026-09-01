// Raids view: a boss-kill matrix (raiders × bosses) for one tier at one
// difficulty, above per-difficulty tier progress meters.
//
// The tier list and boss columns come from the DISCOVERED catalog
// (raid-catalog.json), not from hardcoded IDs — that hardcoding is why the
// old raid tab served empty tiers for every member after a patch. When a
// member has no kill record for a boss the cell reads "—": absence of a kill
// record is not the same as a zero.

import { el, clear } from '../dom.js';
import { classInk, DIFFICULTIES } from '../config.js';

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

  container.append(el('span', { class: 'filter-group-label', text: 'Tier' }));
  for (const tier of tiers) {
    container.append(el('button', {
      class: 'pill', type: 'button',
      'aria-pressed': String(state.tierId === tier.id),
      title: tier.name,
      text: tier.season ? `${tier.name} · ${tier.season}` : tier.name,
      onclick: () => actions.setTier(tier.id),
    }));
  }

  container.append(el('span', { class: 'filter-group-label', text: 'Difficulty' }));
  const seg = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Raid difficulty' });
  for (const d of DIFFICULTIES) {
    seg.append(el('button', {
      type: 'button', 'aria-pressed': String(state.difficulty === d.key),
      text: d.label, onclick: () => actions.setDifficulty(d.key),
    }));
  }
  container.append(seg);
}

export function renderRaids(container, state, onOpen) {
  clear(container);
  const tiers = tiersOf(state.catalog);

  if (!state.raids || !tiers.length) {
    container.append(el('div', { class: 'empty-state' },
      el('p', {
        text: state.catalog === null
          ? 'The raid catalog is unavailable in this snapshot, so boss progress cannot be shown.'
          : 'No raid data in this snapshot yet.',
      })));
    return;
  }

  const tier = tiers.find(t => t.id === state.tierId) || tiers[0];
  const bosses = tier.bosses || [];
  // Join on the stable Blizzard character id, never the display name: two
  // characters in one guild can share a name across realms, and a name join
  // would give one of them the other's owner, class, and detail link.
  const rosterById = new Map((state.roster?.members || []).map(m => [m.id, m]));
  // Only owned characters, matching every other view's scoping.
  const raiders = (state.raids.members || [])
    .map(r => ({ raid: r, member: rosterById.get(r.id), kills: killsByBoss(r, tier.id) }))
    .filter(row => row.member?.owner);

  container.append(renderTierHeader(tier, bosses, raiders));

  if (!bosses.length) {
    container.append(el('div', { class: 'empty-state' },
      el('p', { text: `No encounters are listed for ${tier.name} in the discovered catalog.` })));
    return;
  }
  if (!raiders.length) {
    container.append(el('div', { class: 'empty-state' },
      el('p', { text: 'No tracked characters have raid records in this snapshot.' })));
    return;
  }

  const diff = state.difficulty;
  const wrap = el('div', { class: 'matrix-wrap' });
  const table = el('table', { class: 'matrix' });
  const headRow = el('tr', {}, el('th', { scope: 'col', class: 'matrix-corner', text: 'Raider' }));
  for (const boss of bosses) {
    headRow.append(el('th', { scope: 'col', class: 'matrix-boss', title: boss.name },
      el('span', { text: boss.short || boss.name })));
  }
  table.append(el('thead', {}, headRow));

  const tbody = el('tbody');
  for (const { raid, member, kills } of raiders) {
    const color = classInk(member.className);
    const row = el('tr', {});
    const nameCell = el('th', { scope: 'row', class: 'matrix-name' });
    nameCell.append(el('button', {
      class: 'linklike', type: 'button', style: { color },
      text: member.name, onclick: () => onOpen(member),
    }));
    if (raid.status === 'carried_forward') {
      nameCell.append(el('span', { class: 'piece-note', text: 'older data' }));
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
  container.append(el('p', { class: 'piece-note', text: 'Boss kills counted per character. Select a name to open their detail.' }));
}

function renderTierHeader(tier, bosses, raiders) {
  const head = el('div', { class: 'tier-head' });
  head.append(el('div', { class: 'tier-title' },
    el('p', { class: 'tier-eyebrow', text: 'Current tier · discovered automatically' }),
    el('h2', { text: tier.name }),
    el('p', { class: 'tier-sub', text: [
      `${bosses.length} encounter${bosses.length === 1 ? '' : 's'}`,
      `${raiders.length} tracked raider${raiders.length === 1 ? '' : 's'}`,
      tier.season,
    ].filter(Boolean).join(' · ') }),
  ));

  const meters = el('div', { class: 'tier-meters' });
  for (const d of DIFFICULTIES) {
    // A boss counts as cleared at this difficulty if ANY tracked raider has a kill.
    const cleared = bosses.filter(boss =>
      raiders.some(r => (r.kills.get(boss.id)?.[d.key] || 0) > 0)).length;
    const pct = bosses.length ? Math.round((cleared / bosses.length) * 100) : 0;
    meters.append(el('div', { class: 'tier-meter' },
      el('span', { class: 'tier-meter-value' },
        el('b', { text: String(cleared) }),
        el('span', { text: `/${bosses.length}` }),
      ),
      el('span', { class: 'tier-meter-label', text: d.label }),
      el('span', {
        class: 'meter', role: 'img',
        'aria-label': `${d.label}: ${cleared} of ${bosses.length} bosses cleared`,
      }, el('span', { class: 'meter-fill', style: { width: `${pct}%`, background: d.color } })),
    ));
  }
  head.append(meters);
  return head;
}
