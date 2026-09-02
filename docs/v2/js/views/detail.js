// Character detail dialog. Loads characters/{slug}/{key}.json on open;
// components that are carried forward or unavailable say so explicitly —
// missing data is never rendered as zeros.

import { el, clear } from '../dom.js';
import { fetchSnapshotFile, identityKey, relAge } from '../api.js';
import { classColor, classInk } from '../config.js';

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

export async function openDetail(dialog, member, state) {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const key = identityKey(member);
  renderShell(dialog, member, null, 'Loading…');
  if (!dialog.open) dialog.showModal();

  let charFile = null;
  let error = null;
  try {
    charFile = await fetchSnapshotFile(state.manifest, `characters/${state.guild}/${key}.json`);
  } catch (err) {
    error = err;
  }
  if (!dialog.open || dialog.dataset.key !== key) return; // closed / superseded
  renderShell(dialog, member, charFile, error ? 'Details could not be loaded.' : null);
}

function renderShell(dialog, member, charFile, statusText) {
  // Rebuilding an OPEN dialog destroys the focused node and `autofocus` is
  // only honored by showModal(), so focus must be restored by hand below.
  const hadFocusInside = dialog.open &&
    (dialog.contains(document.activeElement) || document.activeElement === document.body);
  clear(dialog);
  dialog.dataset.key = identityKey(member);
  const color = classColor(member.className);
  const detail = charFile?.detail || null;

  const body = el('div', {
    class: 'detail-body',
    style: { '--class-color': color, '--class-ink': classInk(member.className) },
  });

  const closeBtn = el('button', {
    class: 'dialog-close', type: 'button', autofocus: true,
    'aria-label': 'Close dialog', text: '✕',
    onclick: () => dialog.close(),
  });
  body.append(closeBtn);
  const restoreFocus = () => { if (hadFocusInside) closeBtn.focus(); };

  const mono = el('div', { class: 'monogram', 'aria-hidden': 'true', style: { '--class-color': color } });
  const avatar = detail?.avatarUrl || member.avatarUrl;
  if (avatar) mono.append(el('img', { src: avatar, alt: '' }));
  else mono.textContent = member.name[0] || '?';

  const ilvl = detail?.averageIlvl ?? member.ilvl;
  body.append(el('div', { class: 'detail-head' },
    mono,
    el('div', {},
      el('h2', { class: 'detail-title', id: 'detail-title', text: member.name }),
      el('p', { class: 'detail-sub', text: [member.spec, member.className].filter(Boolean).join(' ') || 'Unknown' }),
      el('p', { class: 'detail-sub2', text: subLine(member, detail) }),
    ),
    el('div', { class: 'detail-ilvl' },
      el('b', { text: ilvl ? String(Math.round(ilvl)) : '—' }),
      el('span', { text: 'ITEM LEVEL' }),
    ),
  ));

  if (statusText) {
    body.append(el('p', { class: 'piece-note', role: 'status', text: statusText }));
    dialog.append(body);
    restoreFocus();
    return;
  }

  appendPortrait(body, member, detail);
  const components = charFile?.components || member.components || {};
  appendStats(body, detail, components, charFile);
  appendGear(body, detail, components, charFile);
  appendLifeStats(body, detail, components, charFile);
  dialog.append(body);
  restoreFocus();
}

// Full-body render from Blizzard's media endpoint, behind a toggle: it is a
// large image, so it loads only when asked for.
function appendPortrait(body, member, detail) {
  const url = detail?.mainRawUrl;
  if (!url) return;
  const frame = el('div', { class: 'portrait-frame', hidden: true });
  const toggle = el('button', {
    class: 'btn btn-quiet portrait-toggle', type: 'button', 'aria-expanded': 'false',
    text: 'Show full portrait',
    onclick: () => {
      const show = frame.hidden;
      if (show && !frame.firstChild) {
        frame.append(el('img', { src: url, alt: `Full-body render of ${member.name}`, loading: 'lazy' }));
      }
      frame.hidden = !show;
      toggle.setAttribute('aria-expanded', String(show));
      toggle.textContent = show ? 'Hide full portrait' : 'Show full portrait';
    },
  });
  body.append(toggle, frame);
}

function subLine(member, detail) {
  const parts = [];
  if (member.race) parts.push(member.race);
  parts.push(`Level ${member.level || '?'}`);
  if (member.realmSlug) parts.push(member.realmSlug);
  const login = detail?.lastLogin ?? member.lastLogin;
  if (login) parts.push(`last seen ${relAge(Math.max(0, Date.now() - login))}`);
  return parts.join(' · ');
}

function sectionNote(state, charFile) {
  if (state === 'carried_forward') {
    const src = Date.parse(charFile?.sourceUpdatedAt || '');
    return Number.isFinite(src)
      ? `Older data (from ${relAge(Math.max(0, Date.now() - src))})`
      : 'Older data from a previous refresh';
  }
  if (state === 'unavailable') return 'Currently unavailable';
  return null;
}

function section(title, note) {
  const h = el('div', { class: 'detail-section' }, el('h3', { text: title }));
  if (note) h.append(el('p', { class: 'piece-note', text: note }));
  return h;
}

function appendStats(body, detail, components, charFile) {
  const note = sectionNote(components.statistics, charFile);
  const sec = section('Combat stats', note);
  const s = detail?.stats;
  if (s) {
    const tiles = el('div', { class: 'stat-tiles' });
    const rows = [
      ['Crit', pct(s.crit)], ['Haste', pct(s.haste)],
      ['Mastery', pct(s.mastery)], ['Versatility', pct(s.vers)],
      ['Health', num(s.health)], ['Stamina', num(s.stamina)],
    ];
    for (const [label, value] of rows) {
      tiles.append(el('div', { class: 'stat-tile' },
        el('span', { text: label }),
        el('b', { text: value }),
      ));
    }
    sec.append(tiles);
  } else if (!note) {
    sec.append(el('p', { class: 'piece-note', text: 'No stats recorded.' }));
  }
  body.append(sec);
}

function appendGear(body, detail, components, charFile) {
  const note = sectionNote(components.equipment, charFile);
  const sec = section('Equipment', note);
  const items = Array.isArray(detail?.equipment) ? detail.equipment : null;
  if (items?.length) {
    const table = el('table', { class: 'gear-table' },
      el('thead', {}, el('tr', {},
        el('th', { text: 'Slot' }), el('th', { text: 'Item' }),
        el('th', { class: 'num', text: 'iLvl' }),
      )),
    );
    const tbody = el('tbody');
    for (const item of items) {
      const quality = QUALITY_CLASS.has(item.quality) ? item.quality : 'Common';
      tbody.append(el('tr', {},
        el('td', { text: item.slot || '?' }),
        el('td', { class: `q-${quality}`, text: item.name || '?' }),
        el('td', { class: 'num', text: item.ilvl ? String(item.ilvl) : '—' }),
      ));
    }
    table.append(tbody);
    sec.append(table);
  } else if (!note) {
    sec.append(el('p', { class: 'piece-note', text: 'No equipment recorded.' }));
  }
  body.append(sec);
}

function appendLifeStats(body, detail, components, charFile) {
  const life = detail?.lifeStats;
  const note = sectionNote(components.achievements, charFile);
  if (!life && !note) return;
  const sec = section('Lifetime', note);
  if (life) {
    const tiles = el('div', { class: 'stat-tiles' });
    const rows = Object.entries(life).filter(([, v]) => typeof v === 'number');
    for (const [key, value] of rows) {
      tiles.append(el('div', { class: 'stat-tile' },
        el('span', { text: labelize(key) }),
        el('b', { text: num(value) }),
      ));
    }
    sec.append(tiles);
  }
  body.append(sec);
}

function labelize(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
}

function pct(v) { return typeof v === 'number' ? `${v}%` : '—'; }
function num(v) { return typeof v === 'number' ? v.toLocaleString('en-US') : '—'; }
