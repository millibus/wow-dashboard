# Operations

Running this thing, and fixing it when it breaks.

## Credentials

The pipeline needs a Blizzard OAuth client (`BLIZZARD_CLIENT_ID` / `BLIZZARD_CLIENT_SECRET`) from <https://develop.battle.net/access/clients>. It's a client-credentials app — no redirect URL or user login involved.

They're needed in three places:

| Where | How |
|---|---|
| GitHub Actions | `gh secret set BLIZZARD_CLIENT_ID -R millibus/wow-dashboard` (and `..._SECRET`) |
| Local dev | `api/.env`, copied from `api/.env.example` |
| VPS | `api/.env` on the box |

The public site needs none of these — it only reads committed JSON.

### Rotating

Create a second client in the Blizzard portal, set the new values everywhere above, run the workflow manually to confirm it works, then delete the old client. Nothing pins a key ID, so there's no cutover window to manage.

`.gitignore` covers `.env` and `*.env` anywhere in the tree. No credential has ever been committed to this repo — worth keeping that way.

## The hourly refresh

`.github/workflows/refresh-data.yml` runs at the top of every hour, plus on demand:

```bash
gh workflow run refresh-data.yml -R millibus/wow-dashboard
gh run watch -R millibus/wow-dashboard
```

It checks out, installs `api/` dependencies, runs `scripts/build-snapshot.js`, and commits any changed file under `docs/data/`. Pages redeploys on the commit.

Locally, the same thing without the commit:

```bash
cd api && npm ci
node ../scripts/build-snapshot.js
```

## Failure triage

The build is designed to fail rather than publish bad data, so **a red workflow usually means the guard worked.** The previous snapshot stays live and the header shows it getting older.

### "roster came back empty" / "below 70% of the previous snapshot"

```
[deaths-edge] only 8 of 20 characters fetched (below 70% of the previous
snapshot) — treating this as a partial failure rather than publishing it
```

Blizzard returned errors for most characters. Almost always rate limiting or an API incident.

1. Check <https://us.api.blizzard.com> is responding and look at the job log for the per-character errors above the failure.
2. Re-run the workflow. Transient cases clear on the next hourly run without help.
3. If it persists, drop concurrency in `batched()` calls in `scripts/build-snapshot.js` from 5 to 3, or raise the spacing from 200 ms.

Nothing was committed, so there's nothing to roll back.

### Rate limiting (429)

The client already retries with backoff and honours `Retry-After`, twice per request. Sustained 429s mean the hourly cadence is too aggressive for the key — the fix is fewer characters (lower the 35 cap) or a longer cron interval, not more retries.

### 401 from Blizzard

The cached token is cleared and the request retried once automatically. A persistent 401 means the client credentials are wrong or the app was deleted — check the secrets.

### The workflow is green but the site looks stale

Check `docs/data/generated-at.json` in the repo against what the header shows. If the file is current and the page isn't, it's Pages caching — the snapshots are fetched with `no-cache`, so a hard reload should settle it.

### The API server returns 502 for everything

`curl https://your-host/api/health`. It returns 503 with `"credentials": "missing"` if the environment variables aren't loaded — the usual cause after a redeploy that dropped `.env`.

## Known limits

**Collections cover about half the roster.** Only 35 characters per guild get pets and mounts fetched. The tabs list only the characters that have data. Raising the cap means a longer run and more rate-limit risk; the caps are in `scripts/build-snapshot.js`.

**Life stats are lifetime totals**, matched by their English names. A Blizzard rename silently zeroes a field rather than erroring. If a leaderboard column goes all-dashes overnight, that's the likely cause — check the statistic name in the achievements API against the map in `api/blizzard.js`.

**The repo grows by the hourly commits.** Sorting collection keys removed the bulk of the churn (an idle hour now produces no diff at all), but the commit count still dominates `git log`. If it becomes annoying, move `docs/data/` to an orphan `data` branch and have Pages read from there.

## Raid tiers go stale every patch

This is the one piece of genuinely manual maintenance, and the most likely reason someone opens this file.

`RAID_TIERS` in `api/blizzard.js` is a hardcoded list of raid instances and their bosses. The snapshot only records progress for tiers in that list. When a new raid opens, **the Raids tab keeps showing the previous expansion's raids with no kills** — it isn't broken, it just doesn't know the new raid exists.

You can tell this has happened when the roster is past the old level cap and every cell in the grid is empty.

To add a tier, you need the instance ID and each encounter ID:

```bash
# All raid instances, with their IDs
curl -H "Authorization: Bearer $TOKEN" \
  "https://us.api.blizzard.com/data/wow/journal-expansion/index?namespace=static-us&locale=en_US"

# One instance, including its encounters
curl -H "Authorization: Bearer $TOKEN" \
  "https://us.api.blizzard.com/data/wow/journal-instance/{id}?namespace=static-us&locale=en_US"
```

Get `$TOKEN` with:

```bash
curl -u "$BLIZZARD_CLIENT_ID:$BLIZZARD_CLIENT_SECRET" \
  -d grant_type=client_credentials https://oauth.battle.net/token
```

Then prepend an entry to `RAID_TIERS` (newest first — the first tier is what the tab opens on):

```js
{
  name: 'Full Raid Name',
  short: 'ABC',            // shown on the tier pill
  season: 'XYZ S1',        // shown on the tier pill
  id: 1234,                // journal-instance id
  bosses: [
    { name: 'First Boss', id: 2700, short: 'First' },  // encounter id
  ],
},
```

`short` is what appears in the grid's column headers, so keep it to a word. Run the snapshot build and check the Raids tab.

Old tiers can stay in the list — they become selectable history. The cost is one extra API field per character, not an extra request.

## Level cap

`docs/app.js` derives the cap as `max(BASE_LEVEL_CAP, highest level seen in the snapshot)`, so it raises itself the first time someone levels past it. `BASE_LEVEL_CAP` only needs bumping if you want correct scoring before anyone in the guild has hit the new cap.

## Deploying the API server

```bash
cd api
npm ci
cp .env.example .env      # credentials + ALLOWED_ORIGINS
pm2 start ecosystem.config.js
pm2 save
```

`ecosystem.config.js` resolves its working directory relative to itself, so the checkout can live anywhere.

`ALLOWED_ORIGINS` is a comma-separated origin allow-list; it defaults to the public site plus localhost. This server holds your Blizzard credentials — every route validates its inputs and is rate limited per IP (`RATE_LIMIT_PER_MIN`, default 60), but don't expose it more broadly than you need.

Updating:

```bash
git pull && cd api && npm ci && pm2 restart wow-dashboard-api
```

## Hardening the workflow further

Actions are pinned to major version tags (`@v7`), which are mutable — the tag can be repointed at new code, and this workflow has `contents: write`. Pinning to full commit SHAs closes that off:

```bash
gh api repos/actions/checkout/git/ref/tags/v7 --jq .object.sha
```

Then `uses: actions/checkout@<sha>  # v7`. Dependabot understands SHA pins with a version comment and will keep proposing updates.
