// The character sheet (a modal dialog). Loads characters/{slug}/{key}.json on
// open; components that are carried forward or unavailable say so explicitly —
// missing data is never rendered as zeros, and a member the armory has no
// profile for gets a designed "nothing on file" sheet instead of an error.
//
// The sheet states facts (level, item level, last seen, sockets, enchants).
// It does not judge whether a character is ready for anything.

import { el, clear } from '../dom.js';
import { fetchSnapshotFile, identityKey } from '../api.js';
import { classColor, levelCap, ownerLabel, SHEET_CROP, STAGE } from '../config.js';
import {
  archThumb, classDot, describe, hasProfile, ilvlText, mainRawUrl, num, agoText, rankText, plural,
} from './parts.js';
import { levelOrder } from './roster.js';

const QUALITY_CLASS = new Set([
  'Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Artifact', 'Heirloom',
]);

let opener = null;

export function setupDialog(dialog, onClosed) {
  dialog.addEventListener('close', () => {
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
    onClosed();
  });
  // Click on the backdrop closes (the dialog element itself is the target
  // only when the click lands outside .detail-body).
  dialog.addEventListener('click', e => {
    if (e.target === dialog) dialog.close();
  });
}

// `ctx`: { onOpen(member) } — lets the sheet step to another character (the
// same player's alts) without closing.
export async function openDetail(dialog, member, state, ctx = {}) {
  // Stepping from one sheet to another keeps the original opener, so closing
  // still returns focus to the row the reader started from.
  if (!dialog.open) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const key = identityKey(member);
  const snap = state.manifest?.snapshotId || '';
  // The same sheet re-opened under a newer snapshot (a refresh while it is on
  // screen): keep what is showing until the new file is in hand.
  const inPlace = dialog.open && dialog.dataset.key === key;
  dialog.dataset.snap = snap;

  if (!hasProfile(member)) {
    renderShell(dialog, member, null, state, ctx, { bare: true });
    if (!dialog.open) dialog.showModal();
    return;
  }

  if (!inPlace) renderShell(dialog, member, null, state, ctx, { status: 'Loading…' });
  if (!dialog.open) dialog.showModal();

  let charFile = null;
  let error = null;
  try {
    charFile = await fetchSnapshotFile(state.manifest, `characters/${state.guild}/${key}.json`);
  } catch (err) {
    error = err;
  }
  // closed, stepped to another sheet, or answered for an older snapshot
  if (!dialog.open || dialog.dataset.key !== key || dialog.dataset.snap !== snap) return;
  renderShell(dialog, member, charFile, state, ctx,
    error ? { status: 'The rest of this sheet could not be loaded. Try again after the next refresh.' } : {});
}

function renderShell(dialog, member, charFile, state, ctx, { status = null, bare = false } = {}) {
  // Rebuilding an OPEN dialog destroys the focused node and `autofocus` is
  // only honored by showModal(), so focus must be restored by hand below.
  const active = dialog.open && dialog.contains(document.activeElement) ? document.activeElement : null;
  const hadFocusInside = dialog.open && (!!active || document.activeElement === document.body);
  const focusKey = active ? sheetFocusKey(active) : null;
  // Re-rendering the sheet that is already showing (its file arrived, or a
  // newer snapshot did) keeps the reader's place; a different sheet starts
  // at the top.
  const scrollTop = dialog.open && dialog.dataset.key === identityKey(member) ? dialog.scrollTop : 0;
  clear(dialog);
  dialog.dataset.key = identityKey(member);
  const detail = charFile?.detail || null;

  const body = el('div', {
    class: bare ? 'detail-body sheet is-bare' : 'detail-body sheet',
    style: { '--class-color': classColor(member.className) },
  });

  const closeBtn = el('button', {
    class: 'dialog-close', type: 'button', autofocus: true, 'aria-label': 'Close dialog',
    onclick: () => dialog.close(),
  }, el('span', { 'aria-hidden': 'true', text: '←' }), el('span', { text: 'Back' }));
  body.append(el('div', { class: 'sheet-bar' }, closeBtn));
  // Focus goes back to the control the reader was on when it still exists
  // (matched by what it is, since the node itself was rebuilt), else to Back.
  const restoreFocus = () => {
    dialog.scrollTop = scrollTop;
    if (!hadFocusInside) return;
    const same = focusKey
      ? [...dialog.querySelectorAll('a[href], button')].find(n => sheetFocusKey(n) === focusKey)
      : null;
    (same || closeBtn).focus({ preventScroll: true });
  };

  const top = el('div', { class: 'sheet-top' });
  top.append(renderArt(member, detail));

  const id = el('div', { class: 'sheet-id' });
  const guildName = state.roster?.guild;
  id.append(el('p', { class: 'eyebrow', text: [guildName, rankText(member.rank)].filter(Boolean).join(' · ') }));
  id.append(el('h2', { class: 'detail-title', id: 'detail-title', text: member.name }));
  const epithet = detail?.title && detail.title !== member.name ? detail.title : null;
  if (epithet) id.append(el('p', { class: 'detail-epithet', text: epithet }));
  const what = [member.race, describe(member)].filter(Boolean).join(' · ');
  id.append(el('p', { class: 'detail-sub' },
    member.className ? classDot(member.className) : null,
    el('span', { text: what || 'No armory profile' })));

  const ilvl = detail?.averageIlvl ?? member.ilvl;
  const login = detail?.lastLogin ?? member.lastLogin;
  const cap = levelCap(state.manifest);
  const figures = el('dl', { class: 'figures sheet-figures' });
  figures.append(
    el('div', {},
      el('dt', { text: cap !== null ? `Level / ${cap}` : 'Level' }),
      el('dd', { text: member.level ? String(member.level) : '—' })),
    el('div', { class: 'detail-ilvl' },
      el('dt', { text: 'Item level' }),
      el('dd', {}, el('b', { text: ilvlText(ilvl) }))),
    el('div', {},
      el('dt', { text: 'Last seen' }),
      el('dd', { class: 'is-words', text: login ? agoText(Math.max(0, Date.now() - login)) : '—' })),
  );
  id.append(figures);

  if (bare) {
    id.append(el('p', { class: 'sheet-note', text:
      `The armory has no profile for ${member.name} right now, which usually means the character has not been played in a long while. ` +
      'Name, level and rank come from the guild roster; everything else is unknown rather than zero.' }));
  }
  // No armory link on a bare sheet: the armory is exactly what has no page.
  const link = bare ? null : armoryLink(member);
  if (link) id.append(link);
  top.append(id);
  body.append(top);

  if (status) body.append(el('p', { class: 'note sheet-status', role: 'status', text: status }));

  if (!bare && !status) {
    const components = charFile?.components || member.components || {};
    appendGear(body, detail, components, charFile);
    appendStats(body, detail, components, charFile);
    appendLife(body, member, detail, components, charFile);
  }
  appendAlts(body, member, state, ctx);

  dialog.append(body);
  restoreFocus();
}

// Identity of a focusable control in the sheet that survives a rebuild.
function sheetFocusKey(node) {
  return [node.tagName, node.getAttribute('href') || '', node.dataset?.fk || '', node.textContent.trim()].join('|');
}

// The full-body render under an arch. The render service gives no bounds, so
// one generic crop (SHEET_CROP) frames every character; a missing or broken
// render falls back to the initial, never a broken image.
function renderArt(member, detail) {
  const url = detail?.mainRawUrl || mainRawUrl(member);
  const frame = el('div', { class: 'sheet-art', style: { '--class-color': classColor(member.className) } });
  const arch = el('div', { class: 'arch-frame' });
  const fallback = () => {
    clear(arch);
    arch.classList.add('is-empty');
    arch.append(el('span', { class: 'arch-initial', 'aria-hidden': 'true', text: (member.name || '?')[0] }));
  };
  if (url) {
    const { source } = STAGE;
    arch.append(el('img', {
      class: 'sheet-render', src: url, alt: `Full-body render of ${member.name}`,
      width: source.w, height: source.h, decoding: 'async', onerror: fallback,
      style: {
        width: `${(source.w / SHEET_CROP.w * 100).toFixed(2)}%`,
        left: `${(-SHEET_CROP.x / SHEET_CROP.w * 100).toFixed(2)}%`,
        top: `${(-SHEET_CROP.y / SHEET_CROP.h * 100).toFixed(2)}%`,
      },
    }));
  } else {
    fallback();
  }
  frame.append(arch);
  return frame;
}

// Blizzard's public armory profile. Built only from the identity fields the
// snapshot already keys on; a member missing any of them gets no link.
export function armoryUrl(member) {
  if (!member.region || !member.realmSlug || !member.name) return null;
  const name = encodeURIComponent(member.name.toLowerCase());
  return `https://worldofwarcraft.blizzard.com/en-us/character/${encodeURIComponent(member.region)}/${encodeURIComponent(member.realmSlug)}/${name}`;
}

function armoryLink(member) {
  const href = armoryUrl(member);
  if (!href) return null;
  return el('a', {
    class: 'detail-link', href, target: '_blank', rel: 'noopener noreferrer',
    text: 'View on Armory ↗',
  });
}

// The character file carries ONE timestamp, sourceUpdatedAt, and it tracks
// the profile: when the profile was fetched fresh this run but a single
// component (gear, stats) was carried forward, that timestamp is "now" and
// says nothing about how old the carried component is. So the date is shown
// only when the whole record was carried forward; otherwise the note stays
// generic rather than claiming "from just now" about genuinely old data.
function sectionNote(state, charFile) {
  if (state === 'carried_forward') {
    const wholeRecordCarried = charFile?.components?.profile === 'carried_forward';
    const src = Date.parse(charFile?.sourceUpdatedAt || '');
    return wholeRecordCarried && Number.isFinite(src)
      ? `Older data (from ${agoText(Math.max(0, Date.now() - src))})`
      : 'Older data from a previous refresh';
  }
  if (state === 'unavailable') return 'Currently unavailable';
  return null;
}

function section(title, note, aside = null) {
  const sec = el('section', { class: 'detail-section' },
    el('div', { class: 'section-head' }, el('h3', { text: title }), aside ? el('p', { class: 'section-aside', text: aside }) : null));
  if (note) sec.append(el('p', { class: 'note', text: note }));
  return sec;
}

function appendGear(body, detail, components, charFile) {
  const note = sectionNote(components.equipment, charFile);
  const items = Array.isArray(detail?.equipment) ? detail.equipment : null;
  // Plain gear facts, counted from the pieces themselves. No verdict.
  let facts = null;
  if (items?.length) {
    const sockets = items.filter(i => i.hasEmptySocket).length;
    const enchanted = items.filter(i => (i.enchantCount || 0) > 0).length;
    facts = [
      plural(items.length, 'piece', 'pieces'),
      sockets ? plural(sockets, 'empty socket', 'empty sockets') : 'no empty sockets',
      enchanted ? `${enchanted} enchanted` : 'no enchants',
    ].join(' · ');
  }
  const sec = section('What they’re wearing', note, facts);
  if (items?.length) {
    const table = el('table', { class: 'gear-table' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col', text: 'Slot' }), el('th', { scope: 'col', text: 'Item' }),
        el('th', { scope: 'col', class: 'num', text: 'Item level' }),
      )),
    );
    const tbody = el('tbody');
    for (const item of items) {
      const quality = QUALITY_CLASS.has(item.quality) ? item.quality : 'Common';
      const marks = [];
      if (item.hasEmptySocket) marks.push('Empty socket');
      if ((item.enchantCount || 0) > 0) marks.push('Enchanted');
      tbody.append(el('tr', {},
        el('td', { class: 'gear-slot', text: item.slot || '?' }),
        el('td', { class: 'gear-item' },
          el('span', { class: `q-dot q-${quality}`, title: quality, 'aria-hidden': 'true' }),
          el('span', { class: `gear-name q-${quality}`, text: item.name || '?' }),
          marks.length ? el('span', { class: 'gear-marks', text: marks.join(' · ') }) : null,
        ),
        el('td', { class: 'num', text: item.ilvl ? String(item.ilvl) : '—' }),
      ));
    }
    table.append(tbody);
    sec.append(table);
  } else if (!note) {
    sec.append(el('p', { class: 'note', text: 'No equipment recorded.' }));
  }
  body.append(sec);
}

function pct(v) { return typeof v === 'number' ? `${v}%` : '—'; }

function appendStats(body, detail, components, charFile) {
  const note = sectionNote(components.statistics, charFile);
  const sec = section('The finer details', note);
  const s = detail?.stats;
  if (s) {
    const primary = [['Strength', s.strength], ['Agility', s.agility], ['Intellect', s.intellect]]
      .filter(([, v]) => typeof v === 'number').sort((a, b) => b[1] - a[1])[0];
    const rows = [
      ['Critical strike', pct(s.crit)], ['Haste', pct(s.haste)],
      ['Mastery', pct(s.mastery)], ['Versatility', pct(s.vers)],
      ['Health', num(s.health)], ['Stamina', num(s.stamina)],
    ];
    if (primary) rows.push([primary[0], num(primary[1])]);
    if (typeof s.armor === 'number') rows.push(['Armor', num(s.armor)]);
    const dl = el('dl', { class: 'figures stat-figures' });
    for (const [label, value] of rows) dl.append(el('div', {}, el('dt', { text: label }), el('dd', { text: value })));
    sec.append(dl);
  } else if (!note) {
    sec.append(el('p', { class: 'note', text: 'No stats recorded.' }));
  }
  body.append(sec);
}

// The lifetime statistics, written as a sentence rather than a grid of tiles.
function appendLife(body, member, detail, components, charFile) {
  const life = detail?.lifeStats;
  const note = sectionNote(components.achievements, charFile);
  const points = detail?.achievementPoints ?? member.achievementPoints;
  if (!life && !note && typeof points !== 'number') return;
  const sec = section('Life so far', note);
  const bits = [];
  const add = (value, before, one, many) => {
    if (typeof value === 'number' && value > 0) bits.push([before, value, value === 1 ? one : many]);
  };
  if (life) {
    add(life.questsCompleted, 'finished ', ' quest', ' quests');
    add(life.killingBlows, 'landed ', ' killing blow', ' killing blows');
    add(life.dungeonsEntered, 'walked into ', ' dungeon', ' dungeons');
    add(life.delvesCompleted, 'cleared ', ' delve', ' delves');
    add(life.bossesDefeated, 'put down ', ' boss', ' bosses');
    add(life.flightPaths, 'found ', ' flight path', ' flight paths');
    add(life.timesHearthed, 'hearthed home ', ' time', ' times');
  }
  const p = el('p', { class: 'life' });
  if (bits.length) {
    p.append(`${member.name} has `);
    bits.forEach(([before, value, after], i) => {
      if (i) p.append(i === bits.length - 1 ? ' and ' : ', ');
      p.append(before, el('b', { text: num(value) }), after);
    });
    p.append('.');
  }
  if (life && typeof life.totalDeaths === 'number') {
    p.append(bits.length ? ' Died ' : `${member.name} has died `, el('b', { text: num(life.totalDeaths) }),
      life.totalDeaths === 1 ? ' time' : ' times');
    if (typeof life.deathsFromFalling === 'number' && life.deathsFromFalling > 0) {
      p.append(', ', el('b', { text: num(life.deathsFromFalling) }), ' of them from falling');
    }
    p.append('.');
  }
  if (typeof points === 'number') {
    p.append(' ', el('b', { text: num(points) }), ' achievement points.');
  }
  if (p.childNodes.length) sec.append(p);
  else if (!note) sec.append(el('p', { class: 'note', text: 'Nothing recorded yet.' }));
  body.append(sec);
}

// Alts are grouped quietly: the other characters that belong to the same
// player, with the player's name only if the manifest supplies one. The raw
// owner id is never shown.
function appendAlts(body, member, state, ctx) {
  if (!member.owner) return;
  const alts = (state.roster?.members || [])
    .filter(m => m.owner === member.owner && identityKey(m) !== identityKey(member))
    .sort(levelOrder(state.manifest));
  if (!alts.length) return;
  const label = ownerLabel(state.manifest, member.owner);
  const sec = section(label ? `${label}’s other characters` : 'Same player, other characters', null,
    plural(alts.length, 'alt', 'alts'));
  const list = el('ul', { class: 'alt-list' });
  for (const alt of alts) {
    list.append(el('li', {}, el('button', {
      class: 'alt', type: 'button', onclick: () => ctx.onOpen?.(alt),
    },
      archThumb(alt, { size: 36 }),
      el('span', { class: 'alt-id' },
        el('span', { class: 'alt-name', text: alt.name }),
        el('span', { class: 'alt-sub', text: [`Level ${alt.level}`, describe(alt)].filter(Boolean).join(' · ') }),
      ),
    )));
  }
  sec.append(list);
  body.append(sec);
}
