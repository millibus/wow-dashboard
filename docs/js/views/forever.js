// World of Warcraft: Forever — the coming-soon state.
//
// There is no Forever guild yet, so this view shows no characters, no sample
// data and no dates. It says what is true (nothing is here), what will be
// here once a guild exists, and how to get back to the game that has data.

import { el, clear } from '../dom.js';

const WAITING = [
  ['Roster', 'Everyone in the guild, the day there is a guild to list.'],
  ['Raids', 'Boss kills, counted per character.'],
  ['Collections', 'Pets and mounts, once the armory reports them.'],
];

export function renderForever(container, { guildNames = [], onRetail }) {
  clear(container);
  const box = el('div', { class: 'forever' });
  box.append(
    el('p', { class: 'eyebrow', text: 'World of Warcraft: Forever' }),
    el('h2', { class: 'forever-title', text: 'Coming soon' }),
    el('p', { class: 'forever-lede', text:
      'The fire is lit, but nobody has pitched a tent yet. There is no Forever guild so far, so there is nothing to show here: no roster, no kills, no numbers.' }),
  );

  const list = el('ul', { class: 'forever-list', 'aria-label': 'What will be here' });
  for (const [title, text] of WAITING) {
    list.append(el('li', {},
      el('span', { class: 'forever-item-title', text: title }),
      el('span', { class: 'forever-item-text', text }),
      el('span', { class: 'forever-item-state', text: 'Not yet' }),
    ));
  }
  box.append(list);

  const where = guildNames.length
    ? `${guildNames.join(' and ')} ${guildNames.length === 1 ? 'is' : 'are'} over in Retail.`
    : 'The guilds are over in Retail.';
  box.append(el('p', { class: 'forever-back' },
    el('span', { text: `${where} ` }),
    el('button', { class: 'btn', type: 'button', text: 'Back to Retail', dataset: { fk: 'forever-back' }, onclick: onRetail }),
  ));
  container.append(box);
}
