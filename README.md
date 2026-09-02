# ⚔️ Deaths Edge — WoW Guild Dashboard

Dashboard for the Deaths Edge (Horde) and Riot Act (Alliance) guilds on Onyxia-US.

- **Live site:** <https://wow.nwpremier.net/> (GitHub Pages; also at <https://millibus.github.io/wow-dashboard/>)
- **New dashboard (V2):** <https://wow.nwpremier.net/v2/> — becomes the default in the cutover PR

## How it works

```
GitHub Actions, hourly (.github/workflows/refresh-data.yml)
  build   ─ contents:read ─► scripts/build-snapshot.js ──► Blizzard API (OAuth)
                                │  one fetch pass, two output layers
                                ├─► docs/data/v2/**      transactional V2 snapshot
                                └─► docs/data/*.json     legacy files (until V2 is default)
                                validate both → upload as artifact
  commit  ─ contents:write ─► commits the validated artifact
  deploy  ─ pages:write   ──► deploys the exact artifact (once Pages source = GitHub Actions)
  alert   ─ issues:write  ──► one deduplicated incident issue on failure, auto-closed on recovery

Browser: docs/v2/ (ES modules) reads docs/data/v2/ — no API calls at runtime.
```

**Design rules the whole pipeline follows:**

- **Unknown is never zero.** A failed fetch produces `carried_forward` (last good data, labeled) or `unavailable` (`null`), never an empty array or a fabricated 0. The UI renders unknowns as `—`.
- **Stable identity.** Characters are keyed by `region-realmSlug-characterId`; names change, ids don't. Connected-realm members are fetched on their own realm.
- **Config, not constants.** Everything expansion- or guild-shaped lives in `config/dashboard-config.json`.
- **Logs are safe.** Errors reduce to a code/status/path line (`scripts/lib/safe-error.js`); credentials cannot reach logs, issues, or data files.
- **Failures are loud.** A stale snapshot is announced on the site itself; a failing pipeline opens an issue and emails you.

## Repository layout

| Path | What it is |
| --- | --- |
| `scripts/build-snapshot.js` | The hourly pipeline: fetch → merge with previous snapshot → stage → validate → publish |
| `scripts/lib/blizzard.js` | Blizzard client: native fetch, timeouts, retries, rate-limit handling, token lock |
| `scripts/lib/snapshot-v2.js` | Transactional V2 snapshot: component-level carry-forward, sanity guards, atomic publish |
| `scripts/lib/config.js`, `config/` | Central config + owner/tracked-character mapping |
| `scripts/validate-snapshot*.js` | Schema and sanity gates; a failed validation commits nothing |
| `scripts/test/` | `node:test` suite, runs the real pipeline against `scripts/fixtures/` |
| `tests/e2e/` | Playwright + axe browser tests for the V2 dashboard |
| `docs/v2/` | The V2 dashboard (no framework, no `innerHTML`) |
| `docs/index.html`, `docs/app.js` | Legacy V1 dashboard, still the default until the cutover |
| `api/` | Legacy VPS Express proxy, retired after the cutover soak |

## Configuration

**`config/dashboard-config.json`** — region, guilds, `activeExpansionId`, `levelCap`, `minMemberLevel`, `raidMinLevel`, `archiveThresholdDays`, `readiness` thresholds, sanity `limits`, per-component fetch `cadencesHours`, raid `tierOverrides`, and `lifeStatDefs`.

- **New expansion:** update `activeExpansionId` and `levelCap`. The `LEVEL_CAP_DRIFT` warning fires if the roster outgrows the cap. Raid tiers are discovered from the journal API; nothing else to edit.
- **Adding a guild:** add it to `guilds`. (The legacy `docs/app.js` and `api/server.js` still carry their own lists until retired.)
- **Life stats:** matched by statistic `id` when set, by display name otherwise. Every run logs `LIFE_STAT_ID_SUGGESTIONS` with the ids it observed — paste them into `lifeStatDefs` to make matching rename-proof. `LIFE_STAT_UNMATCHED` means a display name no longer exists on Blizzard's side; the stat publishes as unknown until the config is fixed.

**`config/tracked-characters.json`** — which characters belong to which owner. Expensive fetches (raids, collections) run only for tracked characters. Entries match by `id` when set, by name otherwise; the V2 roster records resolved ids so this file can be backfilled.

## Setup

### Repo secrets (one-time)

Create a client at <https://develop.battle.net/access/clients>, then:

```bash
gh secret set BLIZZARD_CLIENT_ID -R millibus/wow-dashboard
gh secret set BLIZZARD_CLIENT_SECRET -R millibus/wow-dashboard
gh workflow run refresh-data.yml -R millibus/wow-dashboard
```

### Repo settings (one-time, cannot be automated)

- **Settings → Pages → Source → GitHub Actions.** Until then the `deploy` job prints a notice and skips; the site keeps serving from the branch.

### Local development

```bash
npm test                 # pipeline + unit tests against fixtures; no credentials, no installs
npm run validate         # schema-check docs/data

# Run the pipeline for real (writes docs/data)
BLIZZARD_CLIENT_ID=… BLIZZARD_CLIENT_SECRET=… npm run snapshot

# Serve the site locally
cd docs && python3 -m http.server 8000     # http://localhost:8000 and /v2/

# Browser tests (installs Playwright + Chromium)
npm ci && npx playwright install chromium && npm run test:e2e
```

### Replacing the synthetic fixtures with real captures

The committed fixtures are hand-written. Once credentials work, run **Actions → Capture API fixtures → Run workflow**: it records real responses, scans them for credential-shaped strings, runs the test suite against them, and uploads the file as an artifact. Download it, review the diff against `scripts/fixtures/blizzard-fixtures.json`, and commit.

## When something breaks

**The site says the data is old.** Both dashboards show a banner past 24 hours. Check the open issue labeled `pipeline-failure` — it names the failure code and links the run.

| Code | Meaning | What to do |
| --- | --- | --- |
| `AUTH_BAD_CREDENTIALS` | Blizzard rejected the OAuth client | Rotate the secrets (above). Verify first: `curl -u "$ID:$SECRET" -d grant_type=client_credentials https://oauth.battle.net/token` |
| `HTTP_429`, `NETWORK_*` | Transient | Wait for the next hourly run |
| `HTTP_5xx` | Blizzard incident | Check the API forums; wait |
| `SNAPSHOT_VALIDATION_FAILED` | Built data failed the schema gate | Open the (sanitized) run log |
| `SANITY_*` in the manifest | Roster shrank past the guard | If the change is real, re-run with the `sanity_override` input |
| `COMMIT_FAILED` / `DEPLOY_FAILED` | Data was fine; push or Pages deploy failed | Next run retries; check Pages settings |

The issue closes itself on the next successful run.

**The hourly schedule stopped entirely.** GitHub disables scheduled workflows after 60 days without repository activity. `keepalive.yml` commits a marker if the branch is quiet for 30 days, which prevents this while it can run — but it is a same-repo keepalive and cannot recover schedules that are already disabled. If runs have stopped, re-enable the workflow under Actions.

## Cutover plan

V1 remains the default until V2 is verified on a real snapshot. The cutover PR makes `/v2/` the root, then the custom domain moves to Pages (repo setting + DNS verification), with the VPS kept as rollback for a 7-day soak. `api/`, `docs/app.js`, and the legacy data files are deleted after the soak.
