# Data reference

Everything the frontend reads lives in `docs/data/`, written by `scripts/build-snapshot.js`. Four kinds of file, two of them per guild.

| File | Size (typical) | Contents |
|---|---|---|
| `guild-{slug}.json` | 200–370 KB | Full character records for the whole roster |
| `raid-{slug}.json` | 2–4 KB | Per-boss kill counts, capped at 35 characters |
| `collections-{slug}.json` | 220 KB–1.1 MB | Pets and mounts, capped at 35 characters |
| `generated-at.json` | <1 KB | One timestamp for the whole run |

`{slug}` is a key of `GUILDS` in `api/blizzard.js` — currently `deaths-edge` and `riot-act`.

## generated-at.json

```json
{ "ts": "2026-07-28T00:30:27.070Z" }
```

Written last, after every guild succeeds. This is what the header's "Snapshot 2h ago" reads. Each guild file also carries its own `lastUpdated`, set when that guild's data was assembled — these differ by a minute or two because guilds are fetched in sequence.

## guild-{slug}.json

```json
{
  "guild": "Death's Edge",
  "realm": "Onyxia",
  "faction": "horde",
  "lastUpdated": "2026-07-28T00:30:21.831Z",
  "members": [ ... ]
}
```

Includes every character at level 10 or above. Below that they're mostly bank alts with no useful data.

### members[]

| Field | Type | Source |
|---|---|---|
| `name` | string | `/profile/wow/character/{realm}/{name}` |
| `realm` | string | profile — display name, e.g. `Onyxia` |
| `lastLogin` | number \| null | profile `last_login_timestamp`, epoch ms |
| `level` | number | profile |
| `race`, `className`, `spec`, `faction` | string | profile |
| `guild` | string | profile — the character's own guild, which can differ from the file's |
| `title` | string | profile, with `{name}` already substituted |
| `achievementPoints` | number | profile |
| `avatarUrl`, `mainRawUrl` | string \| null | `/character-media` |
| `averageIlvl` | number | profile `equipped_item_level` |
| `rank` | number | guild roster — 0 is Guild Master |
| `equipment[]` | array | `/equipment` |
| `stats` | object | `/statistics` |
| `lifeStats` | object | `/achievements/statistics` |

`averageIlvl` is Blizzard's own equipped item level, not an average of `equipment[]`. Averaging the list would include shirts and tabards and undercount everyone.

### equipment[]

| Field | Type | Notes |
|---|---|---|
| `slot` | string | `Head`, `Ring 1`, `Main Hand`, … |
| `name` | string | Item name |
| `ilvl` | number | Item level |
| `quality` | string | `Poor` … `Artifact`, plus `Heirloom` |
| `hasEmptySocket` | boolean | True if any socket has no gem |
| `enchantCount` | number | Number of enchantments present |
| `stats[]` | array | Up to 4 `{ name, value }` — drives the stat-source breakdown in the modal |

`Shirt` and `Tabard` appear here but are excluded from readiness scoring and the gear audit. Only slots that accept an enchant in the current expansion count towards the enchant score — see `ENCHANTABLE_SLOTS` in `docs/app.js`.

### stats

`health`, `strength`, `agility`, `intellect`, `stamina`, `armor` are raw numbers. `crit`, `haste`, `mastery`, `vers` are percentages to one decimal.

Crit and haste are the **maximum** of the melee, ranged and spell variants Blizzard reports. Reading only `melee_crit` — as this did originally — shows 0% for every caster.

### lifeStats

Lifetime totals scraped by name out of the achievement-statistics tree: `totalDeaths`, `deathsFromFalling`, `deathsFromPlayers`, `deathsInDungeons`, `deathsInRaids`, `killingBlows`, `creaturesKilled`, `crittersKilled`, `questsCompleted`, `questsAbandoned`, `flightPaths`, `timesHearthed`, `honorableKills`, `dungeonsEntered`, `delvesCompleted`, `raidsEntered`, `bossesDefeated`.

Two caveats:

- These are **lifetime** figures, not current-tier. `bossesDefeated` in the hundreds does not mean the character has cleared the current raid — it's every boss they've ever killed. Current-tier progress lives in `raid-{slug}.json`.
- They're matched on the English statistic name (`'Total deaths'`, `'Number of times hearthed'`). If Blizzard renames one, that field silently becomes 0. `raidsEntered` is the sum of the 10- and 25-player counters, and `bossesDefeated` sums every statistic matching `/bosses defeated/i` and `/player/i`.

## raid-{slug}.json

```json
{
  "tiers": [ { "id": 1296, "name": "Liberation of Undermine", "short": "LoU",
               "season": "TWW S2", "bosses": [ { "id": 2639, "name": "...", "short": "Vexie" } ] } ],
  "members": [ { "name": "Viral", "realm": "onyxia", "tiers": [] } ]
}
```

`tiers` at the top level is the definition list — a **hardcoded constant** (`RAID_TIERS` in `api/blizzard.js`), not something Blizzard returns. It has to be updated by hand each patch; see [OPERATIONS.md](OPERATIONS.md#raid-tiers-go-stale-every-patch).

Each member's `tiers[]` holds only the tiers they've actually entered, with `bosses[].kills` keyed by difficulty:

```json
{ "id": 2639, "name": "Vexie and the Geargrinders", "short": "Vexie",
  "kills": { "normal": 3, "heroic": 1 } }
```

A missing difficulty key means zero kills. An **empty `tiers` array** means the character has entered none of the tiers we track — which is different from a fetch failure, and the two must not be conflated. A failed fetch adds an `error` string to the member instead, and the UI renders those cells as `?` rather than `—`.

Capped at the first 35 level-80+ characters, to stay inside Blizzard's rate limits.

## collections-{slug}.json

Keyed by character name, **sorted** — the ordering is deliberate, so an hour with no new pets produces no diff.

```json
{
  "Alduen": {
    "pets":   { "total": 47, "unique": 47,
                "pets": [ { "name": "Anima Wyrmling", "quality": "Rare", "level": 1,
                            "isFavorite": false, "speciesId": 2779 } ] },
    "mounts": { "total": 123,
                "mounts": [ { "name": "Acherus Deathcharger", "mountId": 221,
                              "isUsable": true, "isFavorite": false } ] }
  }
}
```

`speciesId` and `mountId` are what the Wowhead links are built from (`battle-pet=` and `mount=`).

Pets are de-duplicated by name and quality, keeping the highest level, so `total` counts what you own and `unique` counts distinct species.

**Coverage is partial.** Only the same 35-character cap gets collections fetched, so roughly 19 of 36 characters have data for Death's Edge and 3 of 21 for Riot Act. The Pets and Mounts tabs only list characters that are actually present in the file and say so, rather than offering the whole roster and failing on most of it.

## Caps and why they exist

| Cap | Where | Reason |
|---|---|---|
| level ≥ 10 | roster filter | Below this there's no gear or stats worth showing |
| 35 characters | raid + collections | Each character costs 1–3 more API calls; this keeps a run inside rate limits and under the 15-minute workflow timeout |
| concurrency 5, 200 ms spacing | `batched()` | Same reason |
| level ≥ 80 | raid eligibility | Raid tiers only apply at cap |

## Adding a guild

1. Add the slug to `GUILDS` in `api/blizzard.js`.
2. Add a display title and subtitle to `GUILDS` in `docs/app.js`.
3. Add a toggle button in `docs/index.html` with the matching `data-slug`.
4. Run `node scripts/build-snapshot.js` to generate the files.

Characters still won't appear until they're added to `OWNER_MAP` in `docs/app.js` — the dashboard is scoped to a known set of players, not the whole guild roster.
