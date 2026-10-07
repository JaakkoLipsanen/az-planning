# Trip maps

Planning maps for bikepacking trips: the route, a day plan, points of interest, land ownership and GPX export in an installable web app that also works offline.

Each trip lives in `trips/<slug>/` as plain data (a `trip.yaml` and GPX files). A TypeScript pipeline turns it into a bundle, and the app shows every trip under `/<slug>/`.

| Trip                                            |                                                                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [`az-grand-tour`](trips/az-grand-tour/NOTES.md) | Arizona Grand Tour, December 2026: Fool's Loop, Queen's Ransom, Arizona Trail, Mt Lemmon, Madrean Rugged Ramble |

## Quick start

Needs pnpm (any recent version). `package.json` pins the rest: pnpm switches itself to the version in `packageManager`, and installs the Node.js version in `devEngines.runtime` into the project and runs every script with it.

```bash
pnpm install
pnpm dev
```

`pnpm dev` opens the trip list in the browser. Other commands are listed in [`AGENTS.md`](AGENTS.md).

## How it fits together

```
trips/<slug>/trip.yaml + tracks/*.gpx
        │  pnpm trip build <slug>   (fetches and caches OpenStreetMap, elevation and land data)
        ▼
trips/<slug>/dist/   trip.json, GPX files, app icons   (committed)
        │  pnpm build
        ▼
app/dist/   static site: /<slug>/ per trip, service worker, trip data
```

Map tiles are not stored in the repository. The app loads them online from USGS, Terrarium (AWS) and others. "Download for offline" stores the trip files and the tiles around the route on the device, with a wide buffer at overview zooms and a narrow one at detail zooms. The service worker keeps the app itself available offline, and the map reads stored tiles before asking the network.

More in [`docs/architecture.md`](docs/architecture.md), [`docs/trips.md`](docs/trips.md) (creating and editing trips) and [`docs/data-sources.md`](docs/data-sources.md) (where the data comes from and how to query it).

## Deploying

The site is static: `pnpm build` writes it to `app/dist`.

It runs on Cloudflare Workers as static assets, configured in `wrangler.jsonc`. In the Worker's build settings use build command `pnpm build`, deploy command `pnpm exec wrangler deploy` and root directory `/`. The `name` in `wrangler.jsonc` must match the Worker's name. Use `pnpm exec`, not `npx`: npm also checks `devEngines` but cannot download the pinned Node.js, so `npx` fails wherever the system Node.js differs. Every push to the production branch then builds and deploys. `pnpm build && pnpm exec wrangler dev` serves the site locally the way Cloudflare does.

`app/public/_headers` sets the cache rules, and missing pages get `404.html` (the app, which says the trip was not found). Any other static host works the same way with `app/dist`.

Every trip is installable on its own: open `/<slug>/` on the phone and use "Add to Home Screen".

## Data and licences

- OpenStreetMap data © OpenStreetMap contributors (ODbL), via Overpass and OpenFreeMap tiles (OpenMapTiles schema).
- Topo and imagery tiles: USGS The National Map (public domain). Elevation: Terrarium tiles (AWS Open Data). Land status: BLM Surface Management Agency.
- MapLibre GL JS (BSD-3-Clause); Noto Sans map glyphs and Barlow UI fonts (SIL OFL).
- The source GPX files belong to their authors (bikepacking.com, Arizona Trail Race, Arizona Trail Association) and are here for personal trip planning. Keep the repository private.

test
