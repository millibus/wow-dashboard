// The stage: the guild's group photo, built from the real full-body renders,
// with the guild name behind them at poster size.
//
// Three modes, one element:
//   full    — the roster home: figures in two rows, captions on the paper
//   slim    — every other view: the name on a short faction band
//   forever — the other game: an empty camp and "coming soon"
//
// Who stands where is plain and checkable: highest level first; among
// characters at the level cap the higher item level; otherwise whoever was
// seen last (item level is never compared below the cap or across levels).
// The front row is the first few of that order, placed centre-out.
//
// Image weight is the constraint that shapes this: STAGE.tiers caps how many
// renders load per viewport. A render that fails to load is dropped and the
// next character in the order steps in, so a gap never shows.

import { el, clear } from '../dom.js';
import { identityKey } from '../api.js';
import { STAGE, classColor } from '../config.js';
import { mainRawUrl, describe, isAtCap, ilvlText } from './parts.js';
import { levelOrder } from './roster.js';

const failed = new Set();      // render URLs that errored this session
const loaded = new Set();      // render URLs that have painted once
let lastSignature = null;
let observed = false;
let pending = 0;

function tierFor(width) {
  return STAGE.tiers.find(t => width >= t.minWidth) || STAGE.tiers[STAGE.tiers.length - 1];
}

// Index order that fills a row from the middle outwards: 2,1,3,0,4 for five.
function centreOut(n) {
  const mid = (n - 1) / 2;
  return [...Array(n).keys()].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
}

function jitter(id, span) {
  return ((Number(id) || 0) % (span * 2 + 1)) - span;
}

export function stageMode(state) {
  if (state.game === 'forever') return 'forever';
  return state.tab === 'roster' ? 'full' : 'slim';
}

// Scale the poster so the name spans the stage.
export function fitPoster(stage, title) {
  if (!stage.classList.contains('is-full')) {
    title.style.fontSize = '';
    return;
  }
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  const words = [...title.children];
  if (!W || !words.length) return;
  // One line at every width: on a phone a stacked name put its second word
  // behind the figures, and a guild name that cannot be read is not a poster.
  title.style.fontSize = '100px';
  const widths = words.map(w => w.getBoundingClientRect().width);
  const natural = widths.reduce((s, w) => s + w, 0) + 24 * (words.length - 1);
  if (!natural) return;
  const narrow = W < 700;
  const target = narrow ? W * 0.94 : Math.min(W * 0.9, 1320);
  const maxByHeight = H * (narrow ? 0.4 : 0.6);
  title.style.fontSize = `${Math.min(maxByHeight, 100 * target / natural).toFixed(1)}px`;
}

function pick(state, total) {
  const members = state.roster?.members || [];
  const byLevel = levelOrder(state.manifest);
  return members
    .map(m => ({ member: m, url: mainRawUrl(m) }))
    .filter(c => c.url && !failed.has(c.url) && c.member.components?.media !== 'unavailable')
    .sort((a, b) => byLevel(a.member, b.member))
    .slice(0, total);
}

function figure(candidate, row, x, groundY, scale, z, state, onOpen, rerender) {
  const { member, url } = candidate;
  const { hit, foot, source } = STAGE;
  const key = identityKey(member);
  const what = describe(member);
  const btn = el('button', {
    class: `fig fig-r${row}${loaded.has(url) ? ' is-loaded' : ''}`, type: 'button',
    'aria-label': [member.name, `level ${member.level}`, what].filter(Boolean).join(', '),
    dataset: { key, fk: `fig:${key}` },
    style: {
      left: `${(x + (hit.x0 - foot.x) * scale).toFixed(1)}px`,
      top: `${(groundY + (hit.y0 - foot.y) * scale).toFixed(1)}px`,
      width: `${((hit.x1 - hit.x0) * scale).toFixed(1)}px`,
      height: `${((hit.y1 - hit.y0) * scale).toFixed(1)}px`,
      'z-index': String(z),
      '--class-color': classColor(member.className),
    },
    onclick: () => onOpen(member),
  });
  const img = el('img', {
    src: url, alt: '', width: source.w, height: source.h, decoding: 'async', draggable: 'false',
    fetchpriority: row === 0 ? 'high' : 'low',
    style: {
      left: `${(-hit.x0 * scale).toFixed(1)}px`,
      top: `${(-hit.y0 * scale).toFixed(1)}px`,
      width: `${(source.w * scale).toFixed(1)}px`,
      height: `${(source.h * scale).toFixed(1)}px`,
    },
  });
  img.addEventListener('load', () => { loaded.add(url); btn.classList.add('is-loaded'); });
  img.addEventListener('error', () => { failed.add(url); rerender(); });
  btn.append(img);
  // Back-row figures carry no caption on the paper; their name appears on
  // hover and keyboard focus instead.
  if (row > 0) {
    btn.append(el('span', { class: 'plate', 'aria-hidden': 'true' },
      el('b', { text: member.name }),
      el('i', { text: isAtCap(member, state.manifest) ? `item level ${ilvlText(member.ilvl)}` : `level ${member.level}` }),
    ));
  }
  return btn;
}

function caption(candidate, width, state, onOpen) {
  const { member } = candidate;
  const capped = isAtCap(member, state.manifest);
  // The figure above is the real control; the caption repeats it for the
  // eye and for a pointer, and stays out of the tab order and the a11y tree.
  return el('div', {
    class: 'cap', 'aria-hidden': 'true',
    style: { width: `${width}px`, '--class-color': classColor(member.className) },
    onclick: () => onOpen(member),
  },
    el('span', { class: 'cap-name', text: member.name }),
    el('span', { class: 'cap-sub', text: capped && member.ilvl
      ? `Level ${member.level} · ilvl ${ilvlText(member.ilvl)}`
      : `Level ${member.level}` }),
  );
}

export function renderStage(ui, state, onOpen) {
  const { stage, title, lineup, captions } = ui;
  const mode = stageMode(state);
  const rerender = () => {
    // Coalesce: several renders can fail in the same frame.
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => renderStage(ui, state, onOpen));
  };

  if (!observed && 'ResizeObserver' in window) {
    observed = true;
    let width = stage.clientWidth;
    let height = stage.clientHeight;
    new ResizeObserver(() => {
      if (stage.clientWidth === width && stage.clientHeight === height) return;
      width = stage.clientWidth;
      height = stage.clientHeight;
      ui.rerenderStage?.();
    }).observe(stage);
    document.fonts?.ready?.then(() => fitPoster(stage, title));
  }

  const candidates = mode === 'full' ? pick(state, 99) : [];
  stage.classList.toggle('is-full', mode === 'full');
  stage.classList.toggle('is-slim', mode === 'slim');
  stage.classList.toggle('is-forever', mode === 'forever');
  stage.classList.toggle('is-bare', mode === 'full' && !!state.roster && !candidates.length);

  if (mode !== 'full' || !candidates.length) {
    lastSignature = null;
    clear(lineup);
    clear(captions);
    captions.hidden = true;
    fitPoster(stage, title);
    return;
  }

  const W = stage.clientWidth;
  const H = stage.clientHeight;
  const tier = tierFor(W);
  const picks = candidates.slice(0, tier.rows[0] + tier.rows[1]);
  const front = picks.slice(0, tier.rows[0]);
  let back = picks.slice(tier.rows[0]);
  // The back row stands in the gaps of the front row, so it needs the
  // opposite parity; one fewer is better than a figure hidden behind another.
  if (back.length > 1 && back.length % 2 === front.length % 2) back = back.slice(0, -1);

  const signature = [state.guild, W, H, state.manifest?.config?.levelCap,
    ...[...front, ...back].map(c => `${c.url}:${c.member.level}:${c.member.ilvl}`)].join('|');
  if (signature === lastSignature && lineup.childElementCount) { fitPoster(stage, title); return; }
  lastSignature = signature;

  const spacing = Math.min(tier.spacing, (W - 24) / Math.max(front.length, back.length + 1));
  const frontGround = H + 14;            // the front row steps over the seam onto the paper
  const backGround = H - tier.lift;
  clear(lineup);
  clear(captions);

  const place = (row, list, ground, scale, zBase) => {
    const order = centreOut(list.length);
    const slots = new Array(list.length);
    list.forEach((c, i) => { slots[order[i]] = c; });
    slots.forEach((c, slot) => {
      const x = W / 2 + (slot - (list.length - 1) / 2) * spacing + jitter(c.member.id, row ? 8 : 3);
      const y = ground + jitter(c.member.id >> 3, 3);
      const z = zBase + (list.length - Math.abs(slot - (list.length - 1) / 2) * 2);
      lineup.append(figure(c, row, x, y, scale, Math.round(z), state, onOpen, rerender));
      if (row === 0) {
        lineup.append(el('span', {
          class: 'fig-shadow', 'aria-hidden': 'true',
          style: { left: `${x.toFixed(1)}px`, top: `${(frontGround - 9).toFixed(1)}px`, width: `${(300 * scale).toFixed(0)}px` },
        }));
      }
    });
    return slots;
  };

  place(1, back, backGround, tier.scale[1], 10);
  lineup.append(el('span', { class: 'fog', 'aria-hidden': 'true', style: { height: `${Math.round(tier.lift + 150 * tier.scale[1] * 2)}px` } }));
  const frontSlots = place(0, front, frontGround, tier.scale[0], 30);

  const capRow = el('div', { class: 'cap-row' });
  for (const c of frontSlots) capRow.append(caption(c, Math.floor(spacing), state, onOpen));
  captions.append(capRow, el('p', {
    class: 'stage-legend',
    text: 'In front: highest level, then item level at the cap.',
  }));
  captions.hidden = false;
  fitPoster(stage, title);
}
