// Shared Blizzard API client.
// Used by both api/server.js (live VPS proxy) and scripts/build-snapshot.js
// (hourly GitHub Actions snapshot builder). Keep this file framework-free —
// no Express, no NodeCache — so it imports cleanly from anywhere.

const axios = require('axios');

const REGION = process.env.BLIZZARD_REGION || 'us';
const LOCALE = process.env.BLIZZARD_LOCALE || 'en_US';
const BASE = `https://${REGION}.api.blizzard.com`;
const OAUTH_URL = 'https://oauth.battle.net/token';
const NAMESPACE = `profile-${REGION}`;
const TIMEOUT_MS = Number(process.env.BLIZZARD_TIMEOUT_MS || 10000);
const MAX_RETRIES = 2;

// The guild list lives here so the API server and the snapshot builder can't
// drift apart on which guilds exist or which realm they're on.
const GUILDS = {
  'deaths-edge': { slug: 'deaths-edge', realm: 'onyxia', faction: 'horde' },
  'riot-act': { slug: 'riot-act', realm: 'onyxia', faction: 'alliance' },
};

let tokenData = null;
let tokenPromise = null;

function clientCreds() {
  const id = process.env.BLIZZARD_CLIENT_ID;
  const secret = process.env.BLIZZARD_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET must be set');
  }
  return { id, secret };
}

function hasCreds() {
  return !!(process.env.BLIZZARD_CLIENT_ID && process.env.BLIZZARD_CLIENT_SECRET);
}

async function getToken() {
  if (tokenData && tokenData.expires > Date.now()) return tokenData.token;
  // A snapshot run fires dozens of requests at once on a cold start; without
  // this they would each mint their own token.
  if (tokenPromise) return tokenPromise;

  const { id, secret } = clientCreds();
  tokenPromise = axios.post(
    OAUTH_URL,
    new URLSearchParams({ grant_type: 'client_credentials' }),
    { auth: { username: id, password: secret }, timeout: TIMEOUT_MS },
  ).then(res => {
    tokenData = {
      token: res.data.access_token,
      expires: Date.now() + (res.data.expires_in - 60) * 1000,
    };
    return tokenData.token;
  }).finally(() => {
    tokenPromise = null;
  });

  return tokenPromise;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Retries the failures that are actually worth retrying: rate limits (honouring
// Retry-After), 5xx, and network timeouts. A 401 means the cached token went
// bad, so it's cleared once and the call is retried with a fresh one.
async function bnet(path, attempt = 0) {
  const token = await getToken();
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}locale=${LOCALE}`;
  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: TIMEOUT_MS,
    });
    return res.data;
  } catch (err) {
    const status = err.response?.status;

    if (status === 401 && attempt === 0) {
      tokenData = null;
      return bnet(path, attempt + 1);
    }

    const retryable = status === 429 || (status >= 500 && status < 600) ||
      err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET';

    if (retryable && attempt < MAX_RETRIES) {
      const retryAfter = Number(err.response?.headers?.['retry-after']);
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 500 * Math.pow(2, attempt);
      await sleep(backoff);
      return bnet(path, attempt + 1);
    }

    // 404 is a normal answer here (deleted or renamed character), so keep the
    // message short and let callers decide.
    throw new Error(status ? `Blizzard ${status} on ${path.split('?')[0]}` : err.message);
  }
}

function realmSlug(realm) {
  return String(realm).toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');
}

// Blizzard reports crit/haste under melee_, ranged_ and spell_ keys; a caster
// has 0 in melee_crit. Taking the max gives the character's actual rating
// regardless of class.
function bestOf(st, ...keys) {
  const values = keys.map(k => st[k]?.value ?? 0).filter(v => typeof v === 'number');
  return parseFloat((Math.max(0, ...values)).toFixed(1));
}

async function fetchCharacter(realm, name) {
  const encoded = encodeURIComponent(name.toLowerCase());
  const slug = realmSlug(realm);

  const [profile, equipment, stats, media, achStats] = await Promise.allSettled([
    bnet(`/profile/wow/character/${slug}/${encoded}?namespace=${NAMESPACE}`),
    bnet(`/profile/wow/character/${slug}/${encoded}/equipment?namespace=${NAMESPACE}`),
    bnet(`/profile/wow/character/${slug}/${encoded}/statistics?namespace=${NAMESPACE}`),
    bnet(`/profile/wow/character/${slug}/${encoded}/character-media?namespace=${NAMESPACE}`),
    bnet(`/profile/wow/character/${slug}/${encoded}/achievements/statistics?namespace=${NAMESPACE}`),
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
    // Blizzard's own equipped item level, not an average of the equipment list —
    // that average would count shirts and tabards and undercount everyone.
    averageIlvl: p.equipped_item_level ?? p.average_item_level ?? 0,
    equipment: items,
    stats: {
      health: st.health || 0,
      strength: st.strength?.effective || 0,
      agility: st.agility?.effective || 0,
      intellect: st.intellect?.effective || 0,
      stamina: st.stamina?.effective || 0,
      crit: bestOf(st, 'melee_crit', 'ranged_crit', 'spell_crit'),
      haste: bestOf(st, 'melee_haste', 'ranged_haste', 'spell_haste'),
      mastery: bestOf(st, 'mastery'),
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
  const data = await bnet(`/profile/wow/character/${slug}/${encoded}/collections/pets?namespace=${NAMESPACE}`);

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
  const data = await bnet(`/profile/wow/character/${slug}/${encoded}/collections/mounts?namespace=${NAMESPACE}`);

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
    const data = await bnet(`/profile/wow/character/${slug}/${encoded}/encounters/raids?namespace=${NAMESPACE}`);
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
  hasCreds,
  realmSlug,
  GUILDS,
  REGION,
  NAMESPACE,
  fetchCharacter,
  fetchPets,
  fetchMounts,
  fetchRaidProgress,
  batched,
  RAID_TIERS,
};
