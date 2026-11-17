// Side-by-side comparison of two characters. Rows read from the roster
// summaries first (always available) and the two character files once they
// load; anything unknown stays "—", and the higher of two known values is
// marked, never a fabricated one.
//
// Item level is only marked when BOTH characters are at the level cap: below
// it the scales differ and "higher" would be a false statement. Gear facts
// (sockets, enchants) are shown plain, with no mark.

import { el, clear } from '../dom.js';
import { fetchSnapshotFile, identityKey } from '../api.js';
import { classColor } from '../config.js';
import { archThumb, describe, isAtCap } from './parts.js';

let opener = null;

export function setupCompareDialog(dialog, onClosed) {
  dialog.addEventListener('close', () => {
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
    onClosed();
  });
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
}

export async function openCompare(dialog, members, state) {
  const keys = members.map(identityKey);
  const snap = state.manifest?.snapshotId || '';
  // The same comparison under a newer snapshot (a refresh while it is open)
  // is re-rendered in place once the new files arrive.
  const inPlace = dialog.open && dialog.dataset.keys === keys.join(',');
  if (!dialog.open) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.dataset.keys = keys.join(',');
  dialog.dataset.snap = snap;
  if (!inPlace) render(dialog, members, [null, null], state, 'Loading…');
  if (!dialog.open) dialog.showModal();

  const files = await Promise.all(members.map(m =>
    fetchSnapshotFile(state.manifest, `characters/${state.guild}/${identityKey(m)}.json`).catch(() => null)));
  // closed, superseded, or answered for an older snapshot
  if (!dialog.open || dialog.dataset.keys !== keys.join(',') || dialog.dataset.snap !== snap) return;
  render(dialog, members, files, state, null);
}

// Each row: label, getter(member, file) → number|string|null, and how to mark
// it: 'higher' marks the larger known value, 'cap' does so only when both
// characters are at the level cap, null never marks.
const ROWS = [
  ['Level', (m) => m.level, 'higher'],
  ['Item level', (m, f) => f?.detail?.averageIlvl ?? m.ilvl, 'cap'],
  ['Critical strike', (m, f) => pct(f?.detail?.stats?.crit ?? m.stats?.crit), null],
  ['Haste', (m, f) => pct(f?.detail?.stats?.haste ?? m.stats?.haste), null],
  ['Mastery', (m, f) => pct(f?.detail?.stats?.mastery ?? m.stats?.mastery), null],
  ['Versatility', (m, f) => pct(f?.detail?.stats?.vers ?? m.stats?.vers), null],
  ['Health', (m, f) => f?.detail?.stats?.health, 'cap'],
  ['Equipped pieces', (m) => m.equipmentSummary?.count, null],
  ['Empty sockets', (m) => m.equipmentSummary?.emptySockets, null],
  ['Pieces without an enchant', (m) => m.equipmentSummary?.unenchanted, null],
  ['Achievement points', (m) => m.achievementPoints, 'higher'],
  ['Boss kills', (m) => m.lifeStats?.bossesDefeated, 'higher'],
  ['Dungeons entered', (m) => m.lifeStats?.dungeonsEntered, 'higher'],
  ['Quests completed', (m) => m.lifeStats?.questsCompleted, 'higher'],
  ['Total deaths', (m) => m.lifeStats?.totalDeaths, null],
];

function pct(v) { return typeof v === 'number' ? { value: v, text: `${v}%` } : null; }

function cellValue(raw) {
  if (raw === null || raw === undefined) return { value: null, text: '—' };
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'number') return { value: raw, text: raw.toLocaleString('en-US') };
  return { value: null, text: String(raw) };
}

function render(dialog, members, files, state, statusText) {
  const hadFocusInside = dialog.open &&
    (dialog.contains(document.activeElement) || document.activeElement === document.body);
  clear(dialog);
  const body = el('div', { class: 'detail-body sheet compare-body' });
  const closeBtn = el('button', {
    class: 'dialog-close', type: 'button', autofocus: true, 'aria-label': 'Close comparison',
    onclick: () => dialog.close(),
  }, el('span', { 'aria-hidden': 'true', text: '←' }), el('span', { text: 'Back' }));
  body.append(el('div', { class: 'sheet-bar' }, closeBtn));
  body.append(el('p', { class: 'eyebrow', text: 'Side by side' }));
  body.append(el('h2', { class: 'detail-title compare-title', id: 'compare-title', text: 'Compare' }));

  const bothCapped = members.every(m => isAtCap(m, state.manifest));
  const table = el('table', { class: 'compare-table' });
  const head = el('tr', {}, el('th', { scope: 'col' }, el('span', { class: 'visually-hidden', text: 'Statistic' })));
  members.forEach((m, i) => {
    head.append(el('th', { scope: 'col', style: { '--class-color': classColor(m.className) } },
      archThumb(m, { size: 56, eager: true }),
      el('span', { class: 'compare-name', text: m.name }),
      el('span', { class: 'compare-sub', text: describe(m) || 'No armory profile' }),
      files[i]?.status === 'carried_forward' ? el('span', { class: 'note', text: 'older data' }) : null,
    ));
  });
  table.append(el('thead', {}, head));

  const tbody = el('tbody');
  for (const [label, get, mark] of ROWS) {
    const cells = members.map((m, i) => cellValue(get(m, files[i])));
    const known = cells.filter(c => typeof c.value === 'number');
    const marks = mark === 'higher' || (mark === 'cap' && bothCapped);
    let best = -1;
    if (marks && known.length === 2 && cells[0].value !== cells[1].value) {
      best = cells[0].value > cells[1].value ? 0 : 1;
    }
    tbody.append(el('tr', {},
      el('th', { scope: 'row', text: label }),
      ...cells.map((c, i) => el('td', { class: i === best ? 'num is-best' : 'num' },
        el('span', { text: c.text }),
        i === best ? el('span', { class: 'visually-hidden', text: ' (higher)' }) : null)),
    ));
  }
  table.append(tbody);
  body.append(el('div', { class: 'compare-wrap' }, table));
  if (statusText) {
    body.append(el('p', { class: 'note', role: 'status', text: statusText }));
  } else {
    body.append(el('p', { class: 'note', text: bothCapped
      ? 'The higher of two known values is marked. A dash is unknown, never zero.'
      : 'The higher of two known values is marked. Item level and health are left unmarked here because these two are not both at the level cap, and gear does not compare across levels. A dash is unknown, never zero.' }));
  }

  dialog.append(body);
  if (hadFocusInside) closeBtn.focus();
}
