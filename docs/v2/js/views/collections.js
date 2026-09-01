// Collections view: pets and mounts for one selected character.
//
// The old dashboard fetched a 1.12 MB combined collections file to show one
// character's pets. Here the index (small, per guild) drives the picker and
// the totals, and only the SELECTED character's collection file is fetched —
// then cached in the store for the session.

import { el, clear } from '../dom.js';
import { fetchSnapshotFile } from '../api.js';

const RARITY_ORDER = ['Poor', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

export function renderCollectionFilters(container, state, actions) {
  clear(container);
  const index = state.collectionsIndex?.characters || {};
  const keys = Object.keys(index).sort((a, b) => index[a].name.localeCompare(index[b].name));
  if (!keys.length) return;

  container.append(el('span', { class: 'filter-group-label', text: 'Character' }));
  const select = el('select', {
    id: 'collection-char', 'aria-label': 'Character',
    onchange: e => actions.setCollectionKey(e.target.value),
  });
  for (const key of keys) {
    const entry = index[key];
    select.append(el('option', {
      value: key, selected: key === state.collectionKey,
      text: `${entry.name} — ${entry.pets?.total ?? 0} pets, ${entry.mounts?.total ?? 0} mounts`,
    }));
  }
  container.append(el('label', { class: 'sort-box' }, select));

  container.append(el('span', { class: 'filter-group-label', text: 'Show' }));
  for (const kind of [['pets', 'Pets'], ['mounts', 'Mounts']]) {
    container.append(el('button', {
      class: 'pill', type: 'button',
      'aria-pressed': String(state.collectionKind === kind[0]),
      text: kind[1],
      onclick: () => actions.setCollectionKind(kind[0]),
    }));
  }
  if (state.collectionKind === 'pets') {
    container.append(el('span', { class: 'filter-group-label', text: 'Rarity' }));
    container.append(el('button', {
      class: 'pill', type: 'button', 'aria-pressed': String(!state.rarity),
      text: 'Any', onclick: () => actions.setRarity(null),
    }));
    for (const rarity of RARITY_ORDER) {
      container.append(el('button', {
        class: 'pill', type: 'button', 'aria-pressed': String(state.rarity === rarity),
        text: rarity,
        onclick: () => actions.setRarity(state.rarity === rarity ? null : rarity),
      }));
    }
  }
  container.append(el('button', {
    class: 'pill', type: 'button', 'aria-pressed': String(state.favoritesOnly),
    text: '★ Favorites', onclick: () => actions.toggleFavorites(),
  }));
}

// Loads the selected character's collection file, caching it in the store.
export async function ensureCollection(state, setState) {
  const key = state.collectionKey;
  if (!key || state.collections?.[key] !== undefined) return;
  setState({ collections: { ...(state.collections || {}), [key]: null } }); // loading
  let file = 'error';
  try {
    file = await fetchSnapshotFile(state.manifest, `collections/${state.guild}/${key}.json`);
  } catch (_) { /* keep the sentinel */ }
  const current = state.collections || {};
  setState({ collections: { ...current, [key]: file } });
}

export function renderCollections(container, state) {
  clear(container);
  const index = state.collectionsIndex?.characters || {};
  if (!Object.keys(index).length) {
    container.append(el('div', { class: 'empty-state' },
      el('p', { text: 'No collection data was published for this guild.' })));
    return;
  }

  const key = state.collectionKey;
  const entry = index[key];
  const file = state.collections?.[key];

  if (file === undefined || file === null) {
    container.append(el('div', { class: 'empty-state' }, el('p', { text: 'Loading collection…' })));
    return;
  }
  if (file === 'error') {
    container.append(el('div', { class: 'empty-state' },
      el('p', { text: `${entry?.name || 'This character'}’s collection could not be loaded.` })));
    return;
  }

  const kind = state.collectionKind;
  const bucket = file[kind] || {};
  const items = Array.isArray(bucket[kind]) ? bucket[kind] : [];

  container.append(el('div', { class: 'stat-strip' },
    el('div', { class: 'stat is-gold' },
      el('b', { text: String(bucket.total ?? items.length) }),
      el('span', { text: `${kind} collected` })),
    kind === 'pets' && typeof bucket.unique === 'number'
      ? el('div', { class: 'stat' }, el('b', { text: String(bucket.unique) }), el('span', { text: 'unique species' }))
      : null,
    file.status === 'carried_forward'
      ? el('div', { class: 'stat' }, el('b', { text: '⚠' }), el('span', { text: 'older data' }))
      : null,
  ));

  const filtered = items
    .filter(i => !state.favoritesOnly || i.isFavorite)
    .filter(i => kind !== 'pets' || !state.rarity || i.quality === state.rarity)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!filtered.length) {
    container.append(el('div', { class: 'empty-state' },
      el('p', { text: `No ${kind} match these filters.` })));
    return;
  }

  const grid = el('ul', { class: 'collection-grid' });
  for (const item of filtered) {
    const quality = RARITY_ORDER.includes(item.quality) ? item.quality : null;
    grid.append(el('li', { class: 'collection-item' },
      el('span', { class: quality ? `collection-name q-${quality}` : 'collection-name', text: item.name }),
      el('span', { class: 'collection-meta' },
        item.isFavorite ? el('span', { class: 'fav', title: 'Favorite', text: '★' }) : null,
        typeof item.level === 'number' ? el('span', { text: `Lv ${item.level}` }) : null,
        quality ? el('span', { text: quality }) : null,
        item.isUsable === false ? el('span', { class: 'piece-note', text: 'unusable' }) : null,
      ),
    ));
  }
  container.append(grid);
}
