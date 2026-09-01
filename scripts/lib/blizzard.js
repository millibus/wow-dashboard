'use strict';
// Shared Blizzard API client — native fetch, no axios.
// Used by scripts/build-snapshot.js (hourly GitHub Actions), scripts/capture-fixtures.js,
// and api/server.js (legacy VPS proxy, until retired). Keep framework-free.
//
// Transport policy:
// - 15s per-request timeout (AbortController) and a 60s overall deadline per call.
// - Global concurrency limiter — character fetches fan out several parallel
//   requests each, so batching alone cannot bound Blizzard-side pressure.
// - One shared in-flight token promise (no token-refresh stampedes).
// - Token endpoint 401/403 → fatal AUTH_BAD_CREDENTIALS, never retried.
// - Resource 401 → invalidate token, re-auth, retry once.
// - 404 / other 4xx → no retry. Timeout, network reset, 408, 429, 500/502/503/504
//   → bounded exponential backoff with jitter; Retry-After honored (seconds or
//   HTTP-date), capped.
// - Errors are wrapped into a safe axios-compatible shape ({response:{status},
//   config:{method,url}}) so scripts/lib/safe-error.js classifies them; nothing
//   here may log or throw raw fetch internals with headers attached.
//
// Env overrides exist for tests only — production sets none of them:
//   BLIZZARD_API_BASE, BLIZZARD_OAUTH_URL, BLIZZARD_TIMEOUT_MS,
//   BLIZZARD_RETRY_BASE_MS, BLIZZARD_DEADLINE_MS, BLIZZARD_MAX_CONCURRENT

function intEnv(name, dflt) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}
const apiBase = () => process.env.BLIZZARD_API_BASE || 'https://us.api.blizzard.com';
const oauthUrl = () => process.env.BLIZZARD_OAUTH_URL || 'https://oauth.battle.net/token';
const cfg = () => ({
  timeoutMs: intEnv('BLIZZARD_TIMEOUT_MS', 15000),
  retryBaseMs: intEnv('BLIZZARD_RETRY_BASE_MS', 1000),
  deadlineMs: intEnv('BLIZZARD_DEADLINE_MS', 60000),
  maxConcurrent: intEnv('BLIZZARD_MAX_CONCURRENT', 8),
  maxRetries: 3,
  retryAfterCapMs: 30000,
});

// --- Safe error shapes -------------------------------------------------------

// axios-compatible shape so safe-error.js extracts status/method/pathname.
class HttpError extends Error {
  constructor(status, method, url) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.response = { status };
    this.config = { method, url };
  }
}

class AuthBadCredentialsError extends Error {
  constructor(status) {
    super(`Blizzard rejected the OAuth client credentials (HTTP ${status})`);
    this.name = 'AuthBadCredentialsError';
    this.safeCode = 'AUTH_BAD_CREDENTIALS';
    this.response = { status };
    this.config = { method: 'POST', url: oauthUrl() };
  }
}

function wrapNetworkError(err, method, url) {
  // fetch failures nest the useful code in err.cause; surface a clean error
  // that never carries headers/bodies.
  // Only string codes are meaningful (DOMException carries a numeric legacy code).
  const cand = [err?.cause?.code, err?.code].find(c => typeof c === 'string');
  const code = cand || ((err?.name === 'AbortError' || err?.name === 'TimeoutError') ? 'ETIMEDOUT' : undefined);
  const out = new Error(code ? `request failed (${code})` : 'request failed');
  if (code) out.code = code;
  out.config = { method, url };
  return out;
}

// --- Metrics -----------------------------------------------------------------

const metrics = { requests: 0, retries: 0, rateLimited: 0, failures: 0, maxConcurrent: 0 };
function getMetrics() { return { ...metrics }; }
function formatMetrics() {
  return `requests=${metrics.requests} retries=${metrics.retries} 429s=${metrics.rateLimited} ` +
         `failures=${metrics.failures} maxConcurrency=${metrics.maxConcurrent}`;
}

// --- Global concurrency limiter ---------------------------------------------

let active = 0;
const waiters = [];
async function withSlot(fn) {
  if (active >= cfg().maxConcurrent) {
    await new Promise(resolve => waiters.push(resolve));
  }
  active += 1;
  metrics.maxConcurrent = Math.max(metrics.maxConcurrent, active);
  try {
    return await fn();
  } finally {
    active -= 1;
    const next = waiters.shift();
    if (next) next();
  }
}

// --- Retry helpers -----------------------------------------------------------

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function parseRetryAfter(header, capMs) {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, capMs);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), capMs);
  return null;
}

function backoffDelay(attempt, baseMs) {
  const exp = baseMs * Math.pow(3, attempt);
  return Math.round(exp * (0.5 + Math.random()));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Core request loop. `onUnauthorized` (optional) is called once on a 401 to
// refresh credentials; returning true retries the request once.
async function request(method, url, buildOptions, { onUnauthorized } = {}) {
  const c = cfg();
  const deadline = Date.now() + c.deadlineMs;
  let attempt = 0;
  let reauthed = false;
  let lastErr;

  while (true) {
    metrics.requests += 1;
    let res;
    try {
      // Never let a single attempt run past the overall deadline.
      const attemptTimeout = Math.min(c.timeoutMs, Math.max(deadline - Date.now(), 1));
      res = await fetchWithTimeout(url, await buildOptions(), attemptTimeout);
    } catch (err) {
      lastErr = wrapNetworkError(err, method, url);
      res = null;
    }

    if (res) {
      if (res.ok) {
        try { return await res.json(); }
        catch (err) { lastErr = wrapNetworkError(err, method, url); }
      } else if (res.status === 401 && onUnauthorized && !reauthed) {
        reauthed = true;
        if (await onUnauthorized()) continue; // one immediate retry with a fresh token
        metrics.failures += 1;
        throw new HttpError(res.status, method, url);
      } else if (RETRYABLE_STATUS.has(res.status)) {
        if (res.status === 429) metrics.rateLimited += 1;
        lastErr = new HttpError(res.status, method, url);
        const retryAfter = parseRetryAfter(res.headers.get('retry-after'), c.retryAfterCapMs);
        const wait = Math.max(retryAfter ?? 0, backoffDelay(attempt, c.retryBaseMs));
        // Retry only if the wait AND another attempt still fit inside the deadline.
        if (attempt < c.maxRetries && Date.now() + wait < deadline) {
          metrics.retries += 1;
          await sleep(wait);
          attempt += 1;
          continue;
        }
        metrics.failures += 1;
        throw lastErr;
      } else {
        // Non-retryable HTTP error (404 and other 4xx).
        metrics.failures += 1;
        throw new HttpError(res.status, method, url);
      }
    }

    // Network failure / timeout / body-parse failure path.
    const netWait = backoffDelay(attempt, c.retryBaseMs);
    if (lastErr && attempt < c.maxRetries && Date.now() + netWait < deadline) {
      metrics.retries += 1;
      await sleep(netWait);
      attempt += 1;
      continue;
    }
    metrics.failures += 1;
    throw lastErr;
  }
}

// --- OAuth -------------------------------------------------------------------

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

function invalidateToken() { tokenData = null; }

async function fetchToken() {
  const { id, secret } = clientCreds();
  const url = oauthUrl();
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const data = await request('POST', url, () => ({
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  }), {
    // A 401 on the token endpoint means the credentials are bad — fatal,
    // never retried (request() only calls this once, and we do not retry).
    onUnauthorized: async () => false,
  }).catch(err => {
    const status = err?.response?.status;
    if (status === 401 || status === 403) throw new AuthBadCredentialsError(status);
    throw err;
  });
  tokenData = {
    token: data.access_token,
    expires: Date.now() + (data.expires_in - 60) * 1000,
  };
  return tokenData.token;
}

async function getToken() {
  if (tokenData && tokenData.expires > Date.now()) return tokenData.token;
  if (!tokenPromise) {
    tokenPromise = fetchToken().finally(() => { tokenPromise = null; });
  }
  return tokenPromise;
}

// --- Public API --------------------------------------------------------------

async function bnet(path) {
  const url = `${apiBase()}${path}${path.includes('?') ? '&' : '?'}locale=en_US`;
  return withSlot(() => request('GET', url, async () => ({
    method: 'GET',
    headers: { Authorization: `Bearer ${await getToken()}` },
  }), {
    onUnauthorized: async () => {
      // Token revoked server-side before its stated expiry: refresh once.
      invalidateToken();
      await getToken();
      return true;
    },
  }));
}

// Fallback only — Blizzard's equipped_item_level is authoritative. Cosmetic
// slots must never drag the average down (a level-1 shirt is not gear).
const COSMETIC_SLOTS = new Set(['Shirt', 'Tabard']);
function calcAvgIlvl(items) {
  const ilvls = items
    .filter(i => !COSMETIC_SLOTS.has(i.slot))
    .map(i => i.ilvl ?? i.level?.value ?? 0)
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
    // Stable identity: Blizzard character id + realm slug (names change on
    // renames/transfers; files and owner mapping key off these).
    id: p.id || null,
    realmSlug: p.realm?.slug || realmSlug(realm),
    // Which endpoint responses this record was built from — the V2 snapshot
    // layer carries components forward individually when one fetch fails.
    sources: {
      profile: 'fresh',
      equipment: equipment.status === 'fulfilled' ? 'fresh' : 'unavailable',
      statistics: stats.status === 'fulfilled' ? 'fresh' : 'unavailable',
      media: media.status === 'fulfilled' ? 'fresh' : 'unavailable',
      achievements: achStats.status === 'fulfilled' ? 'fresh' : 'unavailable',
    },
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
    averageIlvl: p.equipped_item_level || calcAvgIlvl(items) || p.average_item_level || 0,
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
  const { safeCode } = require('./safe-error');
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
    return { name, realm, tiers: [], error: safeCode(err) };
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
  invalidateToken,
  getMetrics,
  formatMetrics,
  calcAvgIlvl,
  realmSlug,
  fetchCharacter,
  fetchPets,
  fetchMounts,
  fetchRaidProgress,
  batched,
  RAID_TIERS,
  AuthBadCredentialsError,
  HttpError,
};
