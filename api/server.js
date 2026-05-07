require('dotenv').config();
const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const path = require('path');
const {
  fetchCharacter,
  fetchPets,
  fetchMounts,
  fetchRaidProgress,
  batched,
  bnet,
  RAID_TIERS,
} = require('./blizzard');

const app = express();
const cache = new NodeCache({ stdTTL: 300 }); // 5 min default
const guildCache = new NodeCache({ stdTTL: 900 }); // 15 min for guild roster
const raidCache = new NodeCache({ stdTTL: 1800 }); // 30 min — raid data changes slowly

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'docs')));

// Cached character fetch (5 min)
async function getCharacter(realm, name) {
  const key = `char:${realm}:${name}`;
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const result = await fetchCharacter(realm, name);
    if (result) cache.set(key, result);
    return result;
  } catch (err) {
    console.error(`Error fetching ${name}: ${err.message}`);
    return null;
  }
}

const GUILDS = {
  'deaths-edge': { slug: 'deaths-edge', realm: 'onyxia', faction: 'horde' },
  'riot-act':    { slug: 'riot-act',    realm: 'onyxia', faction: 'alliance' },
};

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

    const chars = await batched(members, 5, async (m) => {
      const full = await getCharacter(guildConfig.realm, m.character.name);
      if (!full) return null;
      return { ...full, rank: m.rank };
    });

    const result = {
      guild: rosterData.guild?.name || slug,
      realm: 'Onyxia',
      faction: guildConfig.faction,
      members: chars.filter(Boolean),
      lastUpdated: new Date().toISOString(),
    };

    guildCache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Guild error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/character/:realm/:name', async (req, res) => {
  try {
    const { realm, name } = req.params;
    const char = await getCharacter(realm, name);
    if (!char) return res.status(404).json({ error: 'Character not found' });
    res.json(char);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/character/:realm/:name/pets', async (req, res) => {
  try {
    const { realm, name } = req.params;
    const key = `pets:${realm}:${name}`;
    const cached = cache.get(key);
    if (cached) return res.json(cached);
    const result = await fetchPets(realm, name);
    cache.set(key, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/character/:realm/:name/mounts', async (req, res) => {
  try {
    const { realm, name } = req.params;
    const key = `mounts:${realm}:${name}`;
    const cached = cache.get(key);
    if (cached) return res.json(cached);
    const result = await fetchMounts(realm, name);
    cache.set(key, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/compare/:realm1/:name1/:realm2/:name2', async (req, res) => {
  try {
    const { realm1, name1, realm2, name2 } = req.params;
    const [char1, char2] = await Promise.all([
      getCharacter(realm1, name1),
      getCharacter(realm2, name2),
    ]);
    res.json({ char1, char2 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/guild/raid-progress', async (req, res) => {
  try {
    const slug = req.query.slug || 'deaths-edge';
    const guildKey = `raid-progress-guild:${slug}`;
    const cached = raidCache.get(guildKey);
    if (cached) return res.json(cached);

    const guildData = await (async () => {
      const gCached = guildCache.get(`guild:${slug}`);
      if (gCached) return gCached;
      return bnet(`/data/wow/guild/onyxia/${slug}/roster?namespace=profile-us`);
    })();

    const members = (guildData.members || [])
      .filter(m => m.character?.level >= 80)
      .slice(0, 35);

    const results = await batched(
      members,
      5,
      m => fetchRaidProgress(m.character.realm?.slug || 'onyxia', m.character.name),
      200,
    );

    const payload = { tiers: RAID_TIERS, members: results };
    raidCache.set(guildKey, payload);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/character/:realm/:name/raids', async (req, res) => {
  try {
    const { realm, name } = req.params;
    const data = await fetchRaidProgress(realm, name);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`WoW Dashboard API running on port ${PORT}`));
