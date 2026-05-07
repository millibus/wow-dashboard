# ⚔️ Deaths Edge — WoW Guild Dashboard

Live dashboard for the Deaths Edge (Horde) and Riot Act (Alliance) guilds on Onyxia-US.

## Live Site
[https://millibus.github.io/wow-dashboard](https://millibus.github.io/wow-dashboard)

## Features
- 📊 All guild members with ilvl, class, spec, stat bars
- 🔍 Filter by owner, class, race, or name
- ↕️ Sort by ilvl, level, name, or class
- 🔬 Click any character for full gear + stats detail
- ⚔️ Compare any two characters side-by-side
- 🐎 Mount and 🐾 pet collections per character
- ⚔️ Raid progress (Liberation of Undermine, Nerub-ar Palace)
- 🎨 WoW class color coding

## Architecture

```
GitHub Actions (hourly cron)
        │
        ▼
scripts/build-snapshot.js  ──► Blizzard API (OAuth)
        │
        ▼
docs/data/*.json   ──►  GitHub Pages auto-deploy
        │
        ▼
docs/app.js  (reads JSON, no API at runtime)
```

- **Frontend** — Static HTML/CSS/JS in `docs/`, served via GitHub Pages.
- **Data** — JSON snapshots in `docs/data/` (`guild-{slug}.json`, `raid-{slug}.json`, `collections-{slug}.json`, `generated-at.json`), regenerated hourly by `.github/workflows/refresh-data.yml`. The frontend reads these files directly — no runtime API calls.
- **Live API (optional)** — `api/server.js` is a Node/Express proxy over the Blizzard API. Used for local development and as the runtime path when serving the dashboard from the VPS. Not required by the public Pages site.
- **Shared client** — `api/blizzard.js` exports OAuth + fetch helpers. Imported by both `api/server.js` and `scripts/build-snapshot.js` so there's one source of truth for the data shape.

## Setup

### Repo secrets (one-time, for the workflow)

The hourly workflow needs Blizzard OAuth credentials as repo secrets. Create an app at <https://develop.battle.net/access/clients> for the values, then:

```bash
gh secret set BLIZZARD_CLIENT_ID -R millibus/wow-dashboard
gh secret set BLIZZARD_CLIENT_SECRET -R millibus/wow-dashboard
```

### Local development

```bash
cd api
cp .env.example .env       # fill in BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET
npm install

# Option A — regenerate static snapshots and serve them locally
node ../scripts/build-snapshot.js
cd ../docs && python3 -m http.server 8000   # open http://localhost:8000

# Option B — run the live Express server (proxies Blizzard at request time)
npm start                  # serves /api/* AND the /docs frontend on port 3002
```

When running via Option B, set `API_BASE = ''` in `docs/app.js` (the default) — `fetchData` falls back to the live `/api/*` endpoints if a snapshot file is missing.

### VPS deployment (live API)

The Express server runs on the Hostinger VPS under PM2 from `/root/clawd/projects/wow-dashboard/api`:

```bash
cd api
npm install
pm2 start ecosystem.config.js
```

The VPS path is independent of the public GitHub Pages site — both can run simultaneously, and the frontend prefers snapshots when present.

### Manually trigger a refresh

```bash
gh workflow run refresh-data.yml -R millibus/wow-dashboard
gh run watch -R millibus/wow-dashboard
```

## Adding a guild
Edit `GUILDS` in `api/server.js` and `scripts/build-snapshot.js`, plus `currentGuildSlug` defaults / titles in `docs/app.js`.

## Adding an owner mapping
Edit `OWNER_MAP` in `docs/app.js`.
