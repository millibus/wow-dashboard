// Raid-readiness view. Scores come entirely from the roster summary
// (equipmentSummary + lifeStats + level + ilvl) — no detail files needed.
//
// Scoring thresholds live in manifest.config.readiness, never here: item-level
// floors move every patch, and a hardcoded one is exactly the kind of silent
// drift this rebuild exists to eliminate.
//
// A character whose equipment component is unavailable gets NO score. Scoring
// it from a missing-equipment record would report "not ready" for what is
// really "we don't know" — the same class of bug as fabricating empty gear.

import { el, clear } from '../dom.js';
import { identityKey } from '../api.js';
import { classColor, READINESS_DEFAULTS } from '../config.js';

export const RISKS = [
  { key: 'ready', label: 'Ready' },
  { key: 'watch', label: 'Watch' },
  { key: 'risk', label: 'At risk' },
  { key: 'unknown', label: 'Unknown' },
];

function rules(manifest) {
  return { ...READINESS_DEFAULTS, ...(manifest?.config?.readiness || {}) };
}

// Returns { risk: 'ready'|'watch'|'risk'|'unknown', score, actions, reason }
export function readinessOf(member, manifest) {
  const r = rules(manifest);
  const eq = member.equipmentSummary;
  const gearKnown = member.components?.equipment !== 'unavailable' && eq && eq.count > 0;

  if (!gearKnown) {
    return {
      risk: 'unknown', score: null,
      reason: member.components?.equipment === 'carried_forward'
        ? 'Gear data is from an earlier refresh'
        : 'Gear data unavailable — cannot score',
      actions: [],
    };
  }

  const ilvl = member.ilvl || 0;
  const ls = member.lifeStats || {};
  const enchantRatio = (eq.count - eq.unenchanted) / eq.count;
  const content = (ls.dungeonsEntered || 0) + (ls.raidsEntered || 0) + (ls.delvesCompleted || 0);
  const bossKills = ls.bossesDefeated || 0;

  const ilvlScore = Math.min(45, Math.max(0, (ilvl - r.ilvlFloor) / 3));
  const prepScore = Math.max(0, 25 - eq.emptySockets * 8) + Math.round(enchantRatio * 10);
  const activityScore = Math.min(20, Math.round(content / 40) + Math.round(bossKills / 15));
  const penalty = (member.level || 0) >= r.minLevel ? 0 : r.belowLevelPenalty;
  const score = Math.max(0, Math.min(100, Math.round(ilvlScore + prepScore + activityScore - penalty)));

  const actions = [];
  if ((member.level || 0) < r.minLevel) actions.push(`Level to ${r.minLevel} first (${member.level || 0}/${r.minLevel})`);
  if (ilvl && ilvl < r.ilvlTarget) actions.push(`Gear up: average item level ${Math.round(ilvl)} of ${r.ilvlTarget}`);
  if (eq.emptySockets) actions.push(`${eq.emptySockets} empty socket${eq.emptySockets > 1 ? 's' : ''}`);
  if (enchantRatio < 0.25) actions.push('Missing enchants on most gear');
  if (!content && member.components?.achievements !== 'unavailable') actions.push('No dungeon, raid, or delve activity recorded');
  if (!actions.length) actions.push('Ready — check raid boss gaps next');

  const risk = score >= r.readyScore ? 'ready' : score >= r.watchScore ? 'watch' : 'risk';
  return { risk, score, actions, reason: null };
}

export function renderReadinessFilters(container, state, actions) {
  clear(container);
  const scored = (state.roster?.members || [])
    .filter(m => m.owner)
    .map(m => readinessOf(m, state.manifest));
  if (!scored.length) return;

  container.append(el('span', { class: 'filter-group-label', text: 'Status' }));
  container.append(el('button', {
    class: 'pill', type: 'button', 'aria-pressed': String(!state.risk),
    text: `All (${scored.length})`, onclick: () => actions.setRisk(null),
  }));
  for (const risk of RISKS) {
    const count = scored.filter(s => s.risk === risk.key).length;
    if (!count) continue;
    container.append(el('button', {
      class: `pill risk-${risk.key}`, type: 'button',
      'aria-pressed': String(state.risk === risk.key),
      text: `${risk.label} (${count})`,
      onclick: () => actions.setRisk(state.risk === risk.key ? null : risk.key),
    }));
  }
}

export function renderReadiness(container, state, onOpen) {
  clear(container);
  const members = (state.roster?.members || []).filter(m => m.owner);
  const rows = members
    .map(m => ({ member: m, readiness: readinessOf(m, state.manifest) }))
    .filter(row => !state.risk || row.readiness.risk === state.risk)
    .sort((a, b) => (b.readiness.score ?? -1) - (a.readiness.score ?? -1));

  if (!rows.length) {
    container.append(el('div', { class: 'empty-state' },
      el('p', { text: 'No characters match this readiness filter.' })));
    return;
  }

  const grid = el('div', { class: 'readiness-grid' });
  for (const { member, readiness } of rows) {
    const color = classColor(member.className);
    const card = el('button', {
      class: `readiness-card risk-${readiness.risk}`, type: 'button',
      style: { '--class-color': color },
      dataset: { key: identityKey(member) },
      onclick: () => onOpen(member),
    },
      el('span', { class: 'readiness-head' },
        el('span', { class: 'char-id' },
          el('span', { class: 'char-name', text: member.name }),
          el('span', { class: 'char-spec', text: [member.spec, member.className].filter(Boolean).join(' ') }),
        ),
        el('span', { class: 'readiness-score' },
          el('b', { text: readiness.score === null ? '—' : String(readiness.score) }),
          el('span', { text: RISKS.find(r => r.key === readiness.risk)?.label || '' }),
        ),
      ),
      readiness.score !== null
        ? el('span', { class: 'meter', role: 'img', 'aria-label': `Readiness score ${readiness.score} of 100` },
            el('span', { class: 'meter-fill', style: { width: `${readiness.score}%` } }))
        : null,
      readiness.reason
        ? el('span', { class: 'piece-note', text: readiness.reason })
        : el('ul', { class: 'readiness-actions' },
            ...readiness.actions.map(a => el('li', { text: a }))),
    );
    grid.append(card);
  }
  container.append(grid);
}
