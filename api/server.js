require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const NodeCache = require('node-cache');
const path = require('path');

const app = express();
const cache = new NodeCache({ stdTTL: 300 }); // 5 min default
const guildCache = new NodeCache({ stdTTL: 900 }); // 15 min for guild roster

app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'docs')));

const CLIENT_ID = process.env.BLIZZARD_CLIENT_ID;
const CLIENT_SECRET = process.env.BLIZZARD_CLIENT_SECRET;
const BASE = 'https://us.api.blizzard.com';

// --- Auth ---
let tokenData = null;
async function getToken() {
  if (tokenData && tokenData.expires > Date.now()) return tokenData.token;
  const res = await axios.post(
    'https://oauth.battle.net/token',
    new URLSearchParams({ grant_type: 'client_credentials' }),
    { auth: { username: CLIENT_ID, password: CLIENT_SECRET } }
  );
  tokenData = {
    token: res.data.access_token,
    expires: Date.now() + (res.data.expires_in - 60) * 1000
  };
  return tokenData.token;
}

async function bnet(path) {
  const token = await getToken();
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}locale=en_US`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data;
}

// --- Character helpers ---
function calcAvgIlvl(items) {
  const ilvls = items
    .map(i => i.level?.value || 0)
    .filter(v => v > 0);
  if (!ilvls.length) return 0;
  return Math.round(ilvls.reduce((a, b) => a + b, 0) / ilvls.length);
}

async function fetchCharacter(realm, name) {
  const key = `char:${realm}:${name}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const encoded = encodeURIComponent(name.toLowerCase());
  const realmSlug = realm.toLowerCase().replace(/\s+/g, '-').replace(/'/g, '');

  try {
    const [profile, equipment, stats, media, achStats] = await Promise.allSettled([
      bnet(`/profile/wow/character/${realmSlug}/${encoded}?namespace=profile-us`),
      bnet(`/profile/wow/character/${realmSlug}/${encoded}/equipment?namespace=profile-us`),
      bnet(`/profile/wow/character/${realmSlug}/${encoded}/statistics?namespace=profile-us`),
      bnet(`/profile/wow/character/${realmSlug}/${encoded}/character-media?namespace=profile-us`),
      bnet(`/profile/wow/character/${realmSlug}/${encoded}/achievements/statistics?namespace=profile-us`)
    ]);

    if (profile.status === 'rejected') {
      return null;
    }

    const p = profile.value;
    const eq = equipment.status === 'fulfilled' ? equipment.value : {};
    const st = stats.status === 'fulfilled' ? stats.value : {};
    const mediaAssets = media.status === 'fulfilled' ? (media.value.assets || []) : [];
    const avatarUrl = mediaAssets.find(a => a.key === 'avatar')?.value || null;
    const mainRawUrl = mediaAssets.find(a => a.key === 'main-raw')?.value || null;

    // Parse achievement statistics
    const achData = achStats.status === 'fulfilled' ? achStats.value : {};
    const achMap = {};
    function extractAchStats(categories) {
      for (const cat of (categories || [])) {
        for (const stat of (cat.statistics || [])) {
          if (stat.quantity > 0) achMap[stat.name] = stat.quantity;
        }
        extractAchStats(cat.sub_categories || []);
      }
    }
    extractAchStats(achData.categories || []);

    const items = (eq.equipped_items || []).map(item => ({
      slot: item.slot?.name || '?',
      name: item.name || '?',
      ilvl: item.level?.value || 0,
      quality: item.quality?.name || 'Common',
      hasEmptySocket: (item.sockets || []).some(s => !s.item),
      enchantCount: (item.enchantments || []).length,
      stats: (item.stats || []).slice(0, 4).map(s => ({
        name: s.type?.name || '?',
        value: s.value || 0
      }))
    }));

    const result = {
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
        armor: st.armor?.effective || 0
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
        // Content cleared
        dungeonsEntered: achMap['Total 5-player dungeons entered'] || 0,
        delvesCompleted: achMap['Total delves completed'] || 0,
        raidsEntered: (achMap['Total 10-player raids entered'] || 0) + (achMap['Total 25-player raids entered'] || 0),
        bossesDefeated: Object.entries(achMap)
          .filter(([k]) => /bosses defeated/i.test(k) && /player/i.test(k))
          .reduce((sum, [,v]) => sum + v, 0),
      }
    };

    cache.set(key, result);
    return result;
  } catch (err) {
    console.error(`Error fetching ${name}: ${err.message}`);
    return null;
  }
}

// Concurrency limiter
async function limit(arr, concurrency, fn) {
  const results = [];
  for (let i = 0; i < arr.length; i += concurrency) {
    const batch = arr.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// --- Routes ---

// Supported guilds config
const GUILDS = {
  'deaths-edge': { slug: 'deaths-edge', realm: 'onyxia', faction: 'horde' },
  'riot-act':    { slug: 'riot-act',    realm: 'onyxia', faction: 'alliance' },
};

// GET /api/guild?slug=deaths-edge  (defaults to deaths-edge)
app.get('/api/guild', async (req, res) => {
  try {
    const slug = req.query.slug || 'deaths-edge';
    const guildConfig = GUILDS[slug];
    if (!guildConfig) return res.status(404).json({ error: 'Unknown guild' });

    const cacheKey = `guild:${slug}`;
    const cached = guildCache.get(cacheKey);
    if (cached) return res.json(cached);

    const rosterData = await bnet(`/data/wow/guild/${guildConfig.realm}/${slug}/roster?namespace=profile-us`);
    const members = (rosterData.members || []).filter(m => (m.character?.level || 0) >= 10);

    const chars = await limit(members, 5, async (m) => {
      const char = m.character;
      const name = char.name;
      const realm = guildConfig.realm;
      const full = await fetchCharacter(realm, name);
      if (!full) return null;
      return { ...full, rank: m.rank };
    });

    const result = {
      guild: rosterData.guild?.name || slug,
      realm: 'Onyxia',
      faction: guildConfig.faction,
      members: chars.filter(Boolean),
      lastUpdated: new Date().toISOString()
    };

    guildCache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Guild error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/character/:realm/:name
app.get('/api/character/:realm/:name', async (req, res) => {
  try {
    const { realm, name } = req.params;
    const char = await fetchCharacter(realm, name);
    if (!char) return res.status(404).json({ error: 'Character not found' });
    res.json(char);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/character/:realm/:name/pets
app.get('/api/character/:realm/:name/pets', async (req, res) => {
  try {
    const { realm, name } = req.params;
    const key = `pets:${realm}:${name}`;
    const cached = cache.get(key);
    if (cached) return res.json(cached);

    const encoded = encodeURIComponent(name.toLowerCase());
    const realmSlug = realm.toLowerCase().replace(/\s+/g, '-').replace(/'/g, '');
    const data = await bnet(`/profile/wow/character/${realmSlug}/${encoded}/collections/pets?namespace=profile-us`);

    const pets = (data.pets || []).map(p => ({
      name: p.species?.name || '?',
      quality: p.quality?.name || 'Common',
      level: p.level || 1,
      isFavorite: p.is_favorite || false,
      speciesId: p.species?.id || 0,
    }));

    // Deduplicate by name+quality — keep highest level per unique pet
    const seen = {};
    const unique = [];
    for (const p of pets) {
      const key = `${p.name}|${p.quality}`;
      if (!seen[key] || seen[key].level < p.level) {
        seen[key] = p;
      }
    }
    for (const p of Object.values(seen)) unique.push(p);
    unique.sort((a, b) => {
      const rOrder = { Epic: 0, Rare: 1, Uncommon: 2, Common: 3, Poor: 4 };
      const ra = rOrder[a.quality] ?? 5, rb = rOrder[b.quality] ?? 5;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });

    const result = { total: pets.length, unique: unique.length, pets: unique };
    cache.set(key, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/character/:realm/:name/mounts
app.get('/api/character/:realm/:name/mounts', async (req, res) => {
  try {
    const { realm, name } = req.params;
    const key = `mounts:${realm}:${name}`;
    const cached = cache.get(key);
    if (cached) return res.json(cached);

    const encoded = encodeURIComponent(name.toLowerCase());
    const realmSlug = realm.toLowerCase().replace(/\s+/g, '-').replace(/'/g, '');
    const data = await bnet(`/profile/wow/character/${realmSlug}/${encoded}/collections/mounts?namespace=profile-us`);

    const mounts = (data.mounts || []).map(m => ({
      name: m.mount?.name || '?',
      mountId: m.mount?.id || 0,
      isUsable: m.is_usable !== false,
      isFavorite: m.is_favorite || false,
    })).sort((a, b) => a.name.localeCompare(b.name));

    const result = { total: mounts.length, mounts };
    cache.set(key, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/compare/:realm1/:name1/:realm2/:name2
app.get('/api/compare/:realm1/:name1/:realm2/:name2', async (req, res) => {
  try {
    const { realm1, name1, realm2, name2 } = req.params;
    const [char1, char2] = await Promise.all([
      fetchCharacter(realm1, name1),
      fetchCharacter(realm2, name2)
    ]);
    res.json({ char1, char2 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`WoW Dashboard API running on port ${PORT}`));
