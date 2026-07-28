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
  hasCreds,
  realmSlug,
  GUILDS,
  NAMESPACE,
  RAID_TIERS,
} = require('./blizzard');

const app = express();
const cache = new NodeCache({ stdTTL: 300 }); // 5 min default
const guildCache = new NodeCache({ stdTTL: 900 }); // 15 min for guild roster
const raidCache = new NodeCache({ stdTTL: 1800 }); // 30 min — raid data changes slowly

app.disable('x-powered-by');

// This proxy holds Blizzard credentials, so it only answers browsers on the
// sites that are supposed to use it. ALLOWED_ORIGINS overrides the defaults
// (comma-separated) when the dashboard is hosted somewhere else.
const DEFAULT_ORIGINS = [
  'https://wow.nwpremier.net',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
];
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const ORIGINS = allowedOrigins.length ? allowedOrigins : DEFAULT_ORIGINS;

app.use(cors({
  origin(origin, cb) {
    // No Origin header means a same-origin or non-browser request (curl, the
    // static page served by this very process) — those are fine.
    if (!origin || ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('Origin not allowed'));
  },
}));
app.use(express.json({ limit: '16kb' }));

// Small fixed-window limiter, kept dependency-free on purpose: this is a
// single-process proxy, so an in-memory counter is enough and there is nothing
// extra to install on the box.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = Number(process.env.RATE_LIMIT_PER_MIN || 60);
const hits = new Map();

setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [ip, entry] of hits) if (entry.start < cutoff) hits.delete(ip);
}, RATE_WINDOW_MS).unref();

app.use('/api', (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    return next();
  }
  entry.count++;
  if (entry.count > RATE_MAX) {
    res.set('Retry-After', String(Math.ceil((entry.start + RATE_WINDOW_MS - now) / 1000)));
    return res.status(429).json({ error: 'Too many requests' });
  }
  next();
});

app.use(express.static(path.join(__dirname, '..', 'docs')));

// Realm and character names go straight into an upstream URL path, so they are
// validated rather than escaped — anything outside this shape is a bad request.
const SAFE_SLUG = /^[a-z0-9-]{1,50}$/;
const SAFE_NAME = /^[\p{L}\p{M}0-9'’-]{2,24}$/u;

function readTarget(req, res, realmKey = 'realm', nameKey = 'name') {
  const realm = realmSlug(req.params[realmKey] || '');
  const name = String(req.params[nameKey] || '');
  if (!SAFE_SLUG.test(realm) || !SAFE_NAME.test(name)) {
    res.status(400).json({ error: 'Invalid realm or character name' });
    return null;
  }
  return { realm, name };
}

function readGuild(req, res) {
  const slug = String(req.query.slug || 'deaths-edge');
  const config = GUILDS[slug];
  if (!config) {
    res.status(404).json({ error: 'Unknown guild' });
    return null;
  }
  return { slug, config };
}

// Browsers and any CDN in front of this should reuse responses for as long as
// the server itself considers them fresh.
const cacheFor = (res, seconds) =>
  res.set('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=60`);

// Upstream messages can carry internal detail; log them, return a generic body.
function fail(res, err, context) {
  console.error(`${context}:`, err.message);
  res.status(502).json({ error: 'Upstream request failed' });
}

// Cached character fetch (5 min)
async function getCharacter(realm, name) {
  const key = `char:${realm}:${name}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const result = await fetchCharacter(realm, name);
  if (result) cache.set(key, result);
  return result;
}

async function fetchRoster(config) {
  return bnet(`/data/wow/guild/${config.realm}/${config.slug}/roster?namespace=${NAMESPACE}`);
}

app.get('/api/guild', async (req, res) => {
  const guild = readGuild(req, res);
  if (!guild) return;
  try {
    const cacheKey = `guild:${guild.slug}`;
    const cached = guildCache.get(cacheKey);
    if (cached) { cacheFor(res, 900); return res.json(cached); }

    const rosterData = await fetchRoster(guild.config);
    const members = (rosterData.members || []).filter(m => (m.character?.level || 0) >= 10);

    const chars = await batched(members, 5, async (m) => {
      try {
        const full = await getCharacter(guild.config.realm, m.character.name);
        return full ? { ...full, rank: m.rank } : null;
      } catch (err) {
        console.error(`Character ${m.character?.name} failed: ${err.message}`);
        return null;
      }
    });

    const result = {
      guild: rosterData.guild?.name || guild.slug,
      realm: guild.config.realm,
      faction: guild.config.faction,
      members: chars.filter(Boolean),
      lastUpdated: new Date().toISOString(),
    };

    guildCache.set(cacheKey, result);
    cacheFor(res, 900);
    res.json(result);
  } catch (err) {
    fail(res, err, 'Guild error');
  }
});

app.get('/api/character/:realm/:name', async (req, res) => {
  const target = readTarget(req, res);
  if (!target) return;
  try {
    const char = await getCharacter(target.realm, target.name);
    if (!char) return res.status(404).json({ error: 'Character not found' });
    cacheFor(res, 300);
    res.json(char);
  } catch (err) {
    fail(res, err, 'Character error');
  }
});

app.get('/api/character/:realm/:name/pets', async (req, res) => {
  const target = readTarget(req, res);
  if (!target) return;
  try {
    const key = `pets:${target.realm}:${target.name}`;
    const cached = cache.get(key);
    if (cached) { cacheFor(res, 300); return res.json(cached); }
    const result = await fetchPets(target.realm, target.name);
    cache.set(key, result);
    cacheFor(res, 300);
    res.json(result);
  } catch (err) {
    fail(res, err, 'Pets error');
  }
});

app.get('/api/character/:realm/:name/mounts', async (req, res) => {
  const target = readTarget(req, res);
  if (!target) return;
  try {
    const key = `mounts:${target.realm}:${target.name}`;
    const cached = cache.get(key);
    if (cached) { cacheFor(res, 300); return res.json(cached); }
    const result = await fetchMounts(target.realm, target.name);
    cache.set(key, result);
    cacheFor(res, 300);
    res.json(result);
  } catch (err) {
    fail(res, err, 'Mounts error');
  }
});

app.get('/api/compare/:realm1/:name1/:realm2/:name2', async (req, res) => {
  const a = readTarget(req, res, 'realm1', 'name1');
  if (!a) return;
  const b = readTarget(req, res, 'realm2', 'name2');
  if (!b) return;
  try {
    const [char1, char2] = await Promise.all([
      getCharacter(a.realm, a.name),
      getCharacter(b.realm, b.name),
    ]);
    cacheFor(res, 300);
    res.json({ char1, char2 });
  } catch (err) {
    fail(res, err, 'Compare error');
  }
});

app.get('/api/guild/raid-progress', async (req, res) => {
  const guild = readGuild(req, res);
  if (!guild) return;
  try {
    const guildKey = `raid-progress-guild:${guild.slug}`;
    const cached = raidCache.get(guildKey);
    if (cached) { cacheFor(res, 1800); return res.json(cached); }

    // Always read the raw roster. The /api/guild cache holds transformed
    // characters with a different shape, and reusing it produced empty raid
    // payloads that then sat in the cache for half an hour.
    const rosterData = await fetchRoster(guild.config);
    const members = (rosterData.members || [])
      .filter(m => (m.character?.level || 0) >= 80)
      .slice(0, 35);

    const results = await batched(
      members,
      5,
      m => fetchRaidProgress(m.character.realm?.slug || guild.config.realm, m.character.name),
      200,
    );

    const payload = { tiers: RAID_TIERS, members: results };
    raidCache.set(guildKey, payload);
    cacheFor(res, 1800);
    res.json(payload);
  } catch (err) {
    fail(res, err, 'Raid progress error');
  }
});

app.get('/api/character/:realm/:name/raids', async (req, res) => {
  const target = readTarget(req, res);
  if (!target) return;
  try {
    const data = await fetchRaidProgress(target.realm, target.name);
    cacheFor(res, 1800);
    res.json(data);
  } catch (err) {
    fail(res, err, 'Raids error');
  }
});

// Reports unhealthy without credentials — the process would otherwise start
// happily and fail every single upstream call.
app.get('/api/health', (req, res) => {
  const credentials = hasCreds();
  res.status(credentials ? 200 : 503).json({
    ok: credentials,
    credentials: credentials ? 'present' : 'missing',
    guilds: Object.keys(GUILDS),
    time: new Date().toISOString(),
  });
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`WoW Dashboard API running on port ${PORT}`);
  if (!hasCreds()) {
    console.warn('WARNING: BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET are not set — every API route will fail.');
  }
});
