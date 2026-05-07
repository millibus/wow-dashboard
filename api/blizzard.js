// Shared Blizzard API client.
// Used by both api/server.js (live VPS proxy) and scripts/build-snapshot.js
// (hourly GitHub Actions snapshot builder). Keep this file framework-free —
// no Express, no NodeCache — so it imports cleanly from anywhere.

const axios = require('axios');

const BASE = 'https://us.api.blizzard.com';
const OAUTH_URL = 'https://oauth.battle.net/token';

let tokenData = null;

function clientCreds() {
  const id = process.env.BLIZZARD_CLIENT_ID;
  const secret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET must be set');
  }
  return { id, secret };
}

async function getToken() {
  if (tokenData && tokenData.expires > Date.now()) return tokenData.token;
  const { id, secret } = clientCreds();
  const res = await axios.post(
    OAUTH_URL,
    new URLSearchParams({ grant_type: 'client_credentials' }),
    { auth: { username: id, password: secret } }
  );
  tokenData = {
    token: res.data.access_token,
    expires: Date.now() + (res.data.expires_in - 60) * 1000,
  };
  return tokenData.token;
}

async function bnet(path) {
  const token = await getToken();
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}locale=en_US`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

function calcAvgIlvl(items) {
  const ilvls = items
    .map(i => i.level?.value || 0)
    .filter(v => v > 0);
  if (!ilvls.length) return 0;
  return Math.round(ilvls.reduce((a, b) => a + b, 0) / ilvls.length);
}

function realmSlug(realm) {
  return realm.toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');
}

async function fetchCharacter(realm, name) {
  const encoded = encodeURIComponent(name.toLowerCase());
  const slug = realmSlug(realm);

  const [profile, equipment, stats, media, achStats] = await Promise.allSettled([
    bnet(`/profile/wow/character/${slug}/${encoded}?namespace=profile-us`),
    bnet(`/profile/wow/character/${slug}/${encoded}/equipment?namespace=profile-us`),
    bnet(`/profile/wow/character/${slug}/${encoded}/statistics?namespace=profile-us`),
    bnet(`/profile/wow/character/${slug}/${encoded}/character-media?namespace=profile-us`),
    bnet(`/profile/wow/character/${slug}/${encoded}/achievements/statistics?namespace=profile-us`),
  ]);

  if (profile.status === 'rejected') return null;

  const p = profile.value;
  const eq = equipment.status === 'fulfilled' ? equipment.value : {};
  const st = stats.status === 'fulfilled' ? stats.value : {};
  const mediaAssets = media.status === 'fulfilled' ? (media.value.assets || []) : [];
  const avatarUrl = mediaAssets.find(a => a.key === 'avatar')?.value || null;
  const mainRawUrl = mediaAssets.find(a => a.key === 'main-raw')?.value || null;

  const achData = achStats.status === 'fulfilled' ? achStats.value : {};
  const achMap = {};
  (function extract(categories) {
    for (const cat of (categories || [])) {
      for (const stat of (cat.statistics || [])) {
        if (stat.quantity > 0) achMap[stat.name] = stat.quantity;
      }
      extract(cat.sub_categories || []);
    }
  })(achData.categories || []);

  const items = (eq.equipped_items || []).map(item => ({
    slot: item.slot?.name || '?',
    name: item.name || '?',
    ilvl: item.level?.value || 0,
    quality: item.quality?.name || 'Common',
    hasEmptySocket: (item.sockets || []).some(s => !s.item),
    enchantCount: (item.enchantments || []).length,
    stats: (item.stats || []).slice(0, 4).map(s => ({
      name: s.type?.name || '?',
      value: s.value || 0,
    })),
  }));

  return {
    name: p.name || name,
    realm: p.realm?.name || realm,
    lastLogin: p.last_login_timestamp || null,
    level: p.level || 0,
    race: p.race?.name || '?',
    className: p.character_class?.name || '?',
    spec: p.active_spec?.name || '?',
    faction: p.faction?.name || '?',
    guild: p.guild?.name || '',
    title: p.active_title?.display_string?.replace('{name}', p.name) || '',
    achievementPoints: p.achievement_points || 0,
    avatarUrl,
    mainRawUrl,
    averageIlvl: calcAvgIlvl(items) || p.equipped_item_level || p.average_item_level || 0,
    equipment: items,
    stats: {
      health: st.health || 0,
      strength: st.strength?.effective || 0,
      agility: st.agility?.effective || 0,
      intellect: st.intellect?.effective || 0,
      stamina: st.stamina?.effective || 0,
      crit: parseFloat((st.melee_crit?.value || 0).toFixed(1)),
      haste: parseFloat((st.melee_haste?.value || 0).toFixed(1)),
      mastery: parseFloat((st.mastery?.value || 0).toFixed(1)),
      vers: parseFloat((st.versatility_damage_done_bonus || 0).toFixed(1)),
      armor: st.armor?.effective || 0,
    },
    lifeStats: {
      totalDeaths: achMap['Total deaths'] || 0,
      deathsFromFalling: achMap['Deaths from falling'] || 0,
      deathsFromPlayers: achMap['Total deaths from other players'] || 0,
      deathsInDungeons: achMap['Total deaths in dungeons'] || 0,
      deathsInRaids: achMap['Total deaths in raids'] || 0,
      killingBlows: achMap['Total Killing Blows'] || 0,
      creaturesKilled: achMap['Creatures killed'] || 0,
      crittersKilled: achMap['Critters killed'] || 0,
      questsCompleted: achMap['Quests completed'] || 0,
      questsAbandoned: achMap['Quests abandoned'] || 0,
      flightPaths: achMap['Flight paths taken'] || 0,
      timesHearthed: achMap['Number of times hearthed'] || 0,
      honorableKills: achMap['Total Honorable Kills'] || 0,
      dungeonsEntered: achMap['Total 5-player dungeons entered'] || 0,
      delvesCompleted: achMap['Total delves completed'] || 0,
      raidsEntered: (achMap['Total 10-player raids entered'] || 0) + (achMap['Total 25-player raids entered'] || 0),
      bossesDefeated: Object.entries(achMap)
        .filter(([k]) => /bosses defeated/i.test(k) && /player/i.test(k))
        .reduce((sum, [, v]) => sum + v, 0),
    },
  };
}

async function fetchPets(realm, name) {
  const encoded = encodeURIComponent(name.toLowerCase());
  const slug = realmSlug(realm);
  const data = await bnet(`/profile/wow/character/${slug}/${encoded}/collections/pets?namespace=profile-us`);

  const pets = (data.pets || []).map(p => ({
    name: p.species?.name || '?',
    quality: p.quality?.name || 'Common',
    level: p.level || 1,
    isFavorite: p.is_favorite || false,
    speciesId: p.species?.id || 0,
  }));

  const seen = {};
  const unique = [];
  for (const p of pets) {
    const key = `${p.name}|${p.quality}`;
    if (!seen[key] || seen[key].level < p.level) seen[key] = p;
  }
  for (const p of Object.values(seen)) unique.push(p);
  unique.sort((a, b) => {
    const rOrder = { Epic: 0, Rare: 1, Uncommon: 2, Common: 3, Poor: 4 };
    const ra = rOrder[a.quality] ?? 5, rb = rOrder[b.quality] ?? 5;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });

  return { total: pets.length, unique: unique.length, pets: unique };
}

async function fetchMounts(realm, name) {
  const encoded = encodeURIComponent(name.toLowerCase());
  const slug = realmSlug(realm);
  const data = await bnet(`/profile/wow/character/${slug}/${encoded}/collections/mounts?namespace=profile-us`);

  const mounts = (data.mounts || []).map(m => ({
    name: m.mount?.name || '?',
    mountId: m.mount?.id || 0,
    isUsable: m.is_usable !== false,
    isFavorite: m.is_favorite || false,
  })).sort((a, b) => a.name.localeCompare(b.name));

  return { total: mounts.length, mounts };
}

const RAID_TIERS = [
  {
    name: 'Liberation of Undermine',
    short: 'LoU',
    season: 'TWW S2',
    id: 1296,
    bosses: [
      { name: 'Vexie and the Geargrinders', id: 2639, short: 'Vexie' },
      { name: 'Cauldron of Carnage', id: 2640, short: 'Cauldron' },
      { name: 'Rik Reverb', id: 2641, short: 'Rik' },
      { name: 'Stix Bunkjunker', id: 2642, short: 'Stix' },
      { name: 'Sprocketmonger Lockenstock', id: 2653, short: 'Sprocket' },
      { name: 'The One-Armed Bandit', id: 2644, short: 'Bandit' },
      { name: "Mug'Zee, Heads of Security", id: 2645, short: "Mug'Zee" },
      { name: 'Chrome King Gallywix', id: 2646, short: 'Gallywix' },
    ],
  },
  {
    name: 'Nerub-ar Palace',
    short: 'NaP',
    season: 'TWW S1',
    id: 1273,
    bosses: [
      { name: 'Ulgrax the Devourer', id: 2607, short: 'Ulgrax' },
      { name: 'The Bloodbound Horror', id: 2611, short: 'Bloodbound' },
      { name: 'Sikran, Captain of the Sureki', id: 2599, short: 'Sikran' },
      { name: "Rasha'nan", id: 2609, short: "Rasha'nan" },
      { name: "Broodtwister Ovi'nax", id: 2612, short: "Ovi'nax" },
      { name: "Nexus-Princess Ky'veza", id: 2601, short: "Ky'veza" },
      { name: 'The Silken Court', id: 2608, short: 'Silken' },
      { name: 'Queen Ansurek', id: 2602, short: 'Ansurek' },
    ],
  },
];

async function fetchRaidProgress(realm, name) {
  const slug = realmSlug(realm);
  const encoded = encodeURIComponent(name.toLowerCase());
  try {
    const data = await bnet(`/profile/wow/character/${slug}/${encoded}/encounters/raids?namespace=profile-us`);
    const expansions = data.expansions || [];
    const result = { name, realm, tiers: [] };

    for (const exp of expansions) {
      for (const inst of (exp.instances || [])) {
        const tierDef = RAID_TIERS.find(t => t.id === inst.instance?.id);
        if (!tierDef) continue;
        const tierResult = {
          id: tierDef.id,
          name: tierDef.name,
          short: tierDef.short,
          season: tierDef.season,
          bosses: tierDef.bosses.map(b => ({ name: b.name, short: b.short, id: b.id, kills: {} })),
        };
        for (const mode of (inst.modes || [])) {
          const diff = mode.difficulty?.type?.toLowerCase();
          if (!['normal', 'heroic', 'mythic'].includes(diff)) continue;
          for (const enc of (mode.progress?.encounters || [])) {
            const boss = tierResult.bosses.find(b => b.id === enc.encounter?.id);
            if (boss) boss.kills[diff] = enc.completed_count || 0;
          }
        }
        result.tiers.push(tierResult);
      }
    }

    return result;
  } catch (err) {
    return { name, realm, tiers: [], error: err.message };
  }
}

async function batched(arr, concurrency, fn, spacingMs = 0) {
  const results = [];
  for (let i = 0; i < arr.length; i += concurrency) {
    const batch = arr.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (spacingMs && i + concurrency < arr.length) {
      await new Promise(r => setTimeout(r, spacingMs));
    }
  }
  return results;
}

module.exports = {
  bnet,
  getToken,
  calcAvgIlvl,
  realmSlug,
  fetchCharacter,
  fetchPets,
  fetchMounts,
  fetchRaidProgress,
  batched,
  RAID_TIERS,
};
