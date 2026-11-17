// Collections view: pets and mounts for one selected character.
//
// The index (small, per guild) drives the picker and the totals, and only the
// SELECTED character's collection file is fetched — then cached in the store
// for the session.

import { el, clear } from '../dom.js';
import { fetchSnapshotFile } from '../api.js';
import { num } from './parts.js';

const RARITY_ORDER = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

export function renderCollectionFilters(container, state, actions) {
  clear(container);
  const index = state.collectionsIndex?.characters || {};
  const keys = Object.keys(index).sort((a, b) => index[a].name.localeCompare(index[b].name));
  if (!keys.length) return;

  const select = el('select', {
    id: 'collection-char', 'aria-label': 'Character', dataset: { fk: 'collection-char' },
    onchange: e => actions.setCollectionKey(e.target.value),
  });
  for (const key of keys) {
    const entry = index[key];
    select.append(el('option', {
      value: key, selected: key === state.collectionKey,
      text: `${entry.name} — ${entry.pets?.total ?? '—'} pets, ${entry.mounts?.total ?? '—'} mounts`,
    }));
  }
  container.append(el('div', { class: 'filter-group' },
    el('span', { class: 'filter-group-label', 'aria-hidden': 'true', text: 'Whose' }),
    el('label', { class: 'select-box' }, select)));

  const seg = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Collection' });
  for (const [kind, label] of [['pets', 'Pets'], ['mounts', 'Mounts']]) {
    seg.append(el('button', {
      type: 'button', 'aria-pressed': String(state.collectionKind === kind),
      dataset: { fk: `kind:${kind}` }, text: label,
      onclick: () => actions.setCollectionKind(kind),
    }));
  }
  container.append(el('div', { class: 'filter-group' },
    el('span', { class: 'filter-group-label', 'aria-hidden': 'true', text: 'Show' }), seg));

  const pills = el('div', { class: 'filter-pills' });
  if (state.collectionKind === 'pets') {
    pills.append(el('button', {
      class: 'pill', type: 'button', 'aria-pressed': String(!state.rarity),
      dataset: { fk: 'rarity:any' }, text: 'Any', onclick: () => actions.setRarity(null),
    }));
    for (const rarity of RARITY_ORDER) {
      pills.append(el('button', {
        class: 'pill', type: 'button', 'aria-pressed': String(state.rarity === rarity),
        dataset: { fk: `rarity:${rarity}` },
        onclick: () => actions.setRarity(state.rarity === rarity ? null : rarity),
      }, el('span', { class: `swatch q-dot q-${rarity}` }), el('span', { text: rarity })));
    }
  }
  pills.append(el('button', {
    class: 'pill', type: 'button', 'aria-pressed': String(state.favoritesOnly),
    dataset: { fk: 'fav' }, text: '★ Favorites', onclick: () => actions.toggleFavorites(),
  }));
  container.append(el('div', { class: 'filter-group', role: 'group', 'aria-label': state.collectionKind === 'pets' ? 'Rarity' : 'Favorites' },
    el('span', { class: 'filter-group-label', 'aria-hidden': 'true', text: state.collectionKind === 'pets' ? 'Rarity' : 'Only' }), pills));
}

// Loads the selected character's collection file, caching it in the store.
export async function ensureCollection(state, setState) {
  const key = state.collectionKey;
  if (!key || state.collections?.[key] !== undefined) return;
  setState({ collections: { ...(state.collections || {}), [key]: null } }); // loading
  // `state` is the live store object: capture what this request is for, and
  // drop the answer if the guild or snapshot moved on while it was in flight.
  const { manifest, guild } = state;
  let file = 'error';
  try {
    file = await fetchSnapshotFile(manifest, `collections/${guild}/${key}.json`);
  } catch (_) { /* keep the sentinel */ }
  if (state.manifest !== manifest || state.guild !== guild) return;
  const current = state.collections || {};
  setState({ collections: { ...current, [key]: file } });
}

function empty(title, hint) {
  return el('div', { class: 'empty-state' },
    el('p', { class: 'empty-title', text: title }),
    hint ? el('p', { class: 'empty-hint', text: hint }) : null);
}

export function renderCollections(container, state) {
  clear(container);
  // A null index means the fetch is still in flight — saying "nothing was
  // published" before it lands would report a data gap that does not exist.
  if (!state.collectionsIndex || state.collectionsIndex.slug !== state.guild) {
    container.append(empty('Loading collections…'));
    return;
  }
  const index = state.collectionsIndex.characters || {};
  if (!Object.keys(index).length) {
    container.append(empty('No collection data was published for this guild.',
      'Pets and mounts are only fetched for a handful of tracked characters.'));
    return;
  }

  const key = state.collectionKey;
  const entry = index[key];
  const file = state.collections?.[key];

  if (file === undefined || file === null) {
    container.append(empty('Loading collection…'));
    return;
  }
  if (file === 'error') {
    container.append(empty(`${entry?.name || 'This character'}’s collection could not be loaded.`,
      'Try again after the next refresh.'));
    return;
  }

  const kind = state.collectionKind;
  const bucket = file[kind];
  if (!bucket || !Array.isArray(bucket[kind])) {
    // The file is there but this list is not: unknown, never "0 pets".
    container.append(empty(`${entry?.name ? `${entry.name}’s` : 'These'} ${kind} are not in this snapshot.`,
      'The armory did not report them this time. Unknown, not zero.'));
    return;
  }
  const items = bucket[kind];
  const favorites = items.filter(i => i.isFavorite).length;

  const figures = el('dl', { class: 'figures' });
  const figure = (value, label) => figures.append(el('div', {}, el('dt', { text: label }), el('dd', { text: value })));
  figure(num(bucket.total ?? items.length), kind === 'pets' ? 'pets' : 'mounts');
  if (kind === 'pets' && typeof bucket.unique === 'number') figure(num(bucket.unique), 'unique species');
  if (favorites) figure(num(favorites), 'favorites');
  container.append(el('div', { class: 'collection-head' },
    el('h3', { class: 'collection-title', text: entry?.name ? `${entry.name}’s ${kind}` : `The ${kind}` }),
    figures,
    file.status === 'carried_forward'
      ? el('p', { class: 'note', text: 'Older data, carried over from an earlier refresh.' })
      : null,
  ));

  const filtered = items
    .filter(i => !state.favoritesOnly || i.isFavorite)
    .filter(i => kind !== 'pets' || !state.rarity || i.quality === state.rarity)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!filtered.length) {
    container.append(empty(`No ${kind} match these filters.`));
    return;
  }

  const grid = el('ul', { class: 'collection-grid' });
  for (const item of filtered) {
    const quality = RARITY_ORDER.includes(item.quality) ? item.quality : null;
    grid.append(el('li', { class: 'collection-item' },
      quality ? el('span', { class: `q-dot q-${quality}`, 'aria-hidden': 'true' }) : null,
      el('span', { class: 'collection-name', text: item.name }),
      el('span', { class: 'collection-meta' },
        item.isFavorite ? el('span', { class: 'fav', title: 'Favorite', text: '★' }) : null,
        typeof item.level === 'number' ? el('span', { text: `Lv ${item.level}` }) : null,
        quality ? el('span', { text: quality }) : null,
        item.isUsable === false ? el('span', { text: 'unusable' }) : null,
      ),
    ));
  }
  container.append(grid);
  container.append(el('p', { class: 'note', text: 'Collections are shared across a Battle.net account, so one player’s characters list the same pets and mounts.' }));
}
