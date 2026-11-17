// Small pieces every view shares: how a character is described in words, the
// arched portrait thumbnail, the class dot, and the "last seen" phrasing.

import { el, clear } from '../dom.js';
import { classColor, levelCap } from '../config.js';

// The roster summary only carries the square avatar; Blizzard's render
// service serves the full-body render beside it under a fixed suffix (every
// character file's mainRawUrl in the snapshot is exactly this substitution).
const AVATAR_SUFFIX = /-avatar\.jpg(\?.*)?$/;

export function mainRawUrl(member) {
  const avatar = member?.avatarUrl;
  if (typeof avatar !== 'string' || !AVATAR_SUFFIX.test(avatar)) return null;
  return avatar.replace(AVATAR_SUFFIX, '-main-raw.png');
}

// "Blood Death Knight" — the way the game itself names a character's role.
export function describe(member) {
  return [member.spec, member.className].filter(Boolean).join(' ') || null;
}

// A member the armory returned nothing for: name, level and rank only.
export function hasProfile(member) {
  return !!member.className || member.components?.profile !== 'unavailable';
}

export function isAtCap(member, manifest) {
  const cap = levelCap(manifest);
  return cap !== null && (member.level || 0) >= cap;
}

// Item level as a plain number; unknown is a dash, never zero.
export function ilvlText(value) {
  return typeof value === 'number' && value > 0 ? String(Math.round(value)) : '—';
}

export function num(value) {
  return typeof value === 'number' ? value.toLocaleString('en-US') : '—';
}

// Human distance for a login that is usually weeks or months old.
export function agoText(ms) {
  const days = Math.floor(ms / 86400e3);
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} months ago`;
  return `${Math.floor(days / 365.25)} years ago`;
}

export function seenText(lastLogin, now = Date.now()) {
  if (!lastLogin) return null;
  return `seen ${agoText(Math.max(0, now - lastLogin))}`;
}

// Only rank 0 has a name the data can vouch for.
export function rankText(rank) {
  if (rank === 0) return 'Guild Master';
  return typeof rank === 'number' ? `Guild rank ${rank}` : null;
}

export function classDot(className) {
  return el('span', {
    class: 'class-dot', 'aria-hidden': 'true',
    style: { '--class-color': classColor(className) },
  });
}

// The arched portrait: Blizzard's square avatar under a rounded lintel, or the
// character's initial when there is no avatar or it fails to load.
export function archThumb(member, { size = 48, eager = false } = {}) {
  const initial = (member.name || '?')[0];
  const box = el('span', {
    class: 'arch', 'aria-hidden': 'true',
    style: { '--class-color': classColor(member.className) },
  });
  const fallback = () => {
    clear(box);
    box.classList.add('is-empty');
    box.textContent = initial;
  };
  if (member.avatarUrl) {
    box.append(el('img', {
      src: member.avatarUrl, alt: '', width: size, height: size,
      loading: eager ? 'eager' : 'lazy', decoding: 'async', onerror: fallback,
    }));
  } else {
    fallback();
  }
  return box;
}

// "A, B and C"
export function listNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function plural(n, one, many) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}
