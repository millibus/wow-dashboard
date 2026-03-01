# ⚔️ Deaths Edge — WoW Guild Dashboard

Live dashboard for the Deaths Edge guild on Onyxia-US.

## Features
- 📊 All guild members with ilvl, class, spec, stat bars
- 🔍 Filter by name, class, or spec
- ↕️ Sort by ilvl, level, name, or class
- 🔬 Click any character for full gear + stats detail
- ⚔️ Compare any two characters side-by-side
- 🎨 WoW class color coding

## Architecture
- **Frontend**: Static HTML/CSS/JS hosted on GitHub Pages (`/docs`)
- **Backend**: Node.js/Express proxy on VPS at port 3002 (`/api`)

## Running the Backend
```bash
cd api
npm install
pm2 start ecosystem.config.js
```

## Live Site
[https://millibus.github.io/wow-dashboard](https://millibus.github.io/wow-dashboard)
