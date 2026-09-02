// Side-by-side comparison of two characters. Rows read from the roster
// summaries first (always available) and the two character files once they
// load; anything unknown stays "—", and the better of two known values is
// marked, never a fabricated one.

import { el, clear } from '../dom.js';
import { fetchSnapshotFile, identityKey } from '../api.js';
import { classColor, classInk } from '../config.js';

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
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const keys = members.map(identityKey);
  dialog.dataset.keys = keys.join(',');
  render(dialog, members, [null, null], 'Loading…');
  if (!dialog.open) dialog.showModal();

  const files = await Promise.all(members.map(m =>
    fetchSnapshotFile(state.manifest, `characters/${state.guild}/${identityKey(m)}.json`).catch(() => null)));
  if (!dialog.open || dialog.dataset.keys !== keys.join(',')) return; // closed / superseded
  render(dialog, members, files, null);
}

// Each row: label, getter(member, file) → number|string|null, and whether a
// higher number is better (null = neutral, e.g. deaths).
const ROWS = [
  ['Level', (m) => m.level, true],
  ['Item level', (m, f) => f?.detail?.averageIlvl ?? m.ilvl, true],
  ['Crit', (m, f) => pct(f?.detail?.stats?.crit ?? m.stats?.crit), true],
  ['Haste', (m, f) => pct(f?.detail?.stats?.haste ?? m.stats?.haste), true],
  ['Mastery', (m, f) => pct(f?.detail?.stats?.mastery ?? m.stats?.mastery), true],
  ['Versatility', (m, f) => pct(f?.detail?.stats?.vers ?? m.stats?.vers), true],
  ['Health', (m, f) => f?.detail?.stats?.health, true],
  ['Equipped pieces', (m) => m.equipmentSummary?.count, true],
  ['Empty sockets', (m) => m.equipmentSummary?.emptySockets, false],
  ['Unenchanted pieces', (m) => m.equipmentSummary?.unenchanted, false],
  ['Achievement points', (m) => m.achievementPoints, true],
  ['Boss kills', (m) => m.lifeStats?.bossesDefeated, true],
  ['Dungeons entered', (m) => m.lifeStats?.dungeonsEntered, true],
  ['Quests completed', (m) => m.lifeStats?.questsCompleted, true],
  ['Total deaths', (m) => m.lifeStats?.totalDeaths, null],
];

function pct(v) { return typeof v === 'number' ? { value: v, text: `${v}%` } : null; }

function cellValue(raw) {
  if (raw === null || raw === undefined) return { value: null, text: '—' };
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'number') return { value: raw, text: raw.toLocaleString('en-US') };
  return { value: null, text: String(raw) };
}

function render(dialog, members, files, statusText) {
  const hadFocusInside = dialog.open &&
    (dialog.contains(document.activeElement) || document.activeElement === document.body);
  clear(dialog);
  const body = el('div', { class: 'detail-body compare-body' });
  const closeBtn = el('button', {
    class: 'dialog-close', type: 'button', autofocus: true,
    'aria-label': 'Close comparison', text: '✕', onclick: () => dialog.close(),
  });
  body.append(closeBtn);
  body.append(el('h2', { class: 'detail-title', id: 'compare-title', text: 'Compare' }));

  const table = el('table', { class: 'compare-table' });
  const head = el('tr', {}, el('th', { scope: 'col', class: 'visually-hidden', text: 'Statistic' }));
  members.forEach((m, i) => {
    head.append(el('th', { scope: 'col', style: { '--class-color': classColor(m.className), '--class-ink': classInk(m.className) } },
      el('span', { class: 'compare-name', text: m.name }),
      el('span', { class: 'compare-sub', text: [m.spec, m.className].filter(Boolean).join(' ') }),
      files[i]?.status === 'carried_forward' ? el('span', { class: 'piece-note', text: 'older data' }) : null,
    ));
  });
  table.append(el('thead', {}, head));

  const tbody = el('tbody');
  for (const [label, get, higherBetter] of ROWS) {
    const cells = members.map((m, i) => cellValue(get(m, files[i])));
    const known = cells.filter(c => typeof c.value === 'number');
    let best = -1;
    if (higherBetter !== null && known.length === 2 && cells[0].value !== cells[1].value) {
      best = (cells[0].value > cells[1].value) === higherBetter ? 0 : 1;
    }
    tbody.append(el('tr', {},
      el('th', { scope: 'row', text: label }),
      ...cells.map((c, i) => el('td', { class: i === best ? 'num is-best' : 'num', text: c.text })),
    ));
  }
  table.append(tbody);
  body.append(el('div', { class: 'matrix-wrap' }, table));
  if (statusText) body.append(el('p', { class: 'piece-note', role: 'status', text: statusText }));
  else body.append(el('p', { class: 'piece-note', text: 'Highlighted cells mark the better of two known values. “—” is unknown, never zero.' }));

  dialog.append(body);
  if (hadFocusInside) closeBtn.focus();
}
