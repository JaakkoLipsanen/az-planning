# Architecture

## Pipeline (`pipeline/src/`)

`pnpm trip build <slug>` runs `build.ts`, which goes through these steps in order:

1. **Load** (`config/`): parse `trip.yaml` with the zod schema in `config/schema.ts`, check cross-references (unique ids, known tracks and kinds, packs only for shown basemaps) and read every GPX file. Track points keep their original text, so output GPX files reproduce the source points exactly.
2. **Stitch** (`route/stitch.ts`): concatenate the section slices into one route, drop consecutive duplicates, record which section each point came from and warn about gaps over 30 m. `pnpm trip validate` stops here, without network access.
3. **Elevation** (`geo/elevation.ts`): points without elevation (usually connectors) are sampled from Terrarium DEM tiles at zoom 12.
4. **Surface** (`layers/surface.ts`): every route point is matched to the nearest OpenStreetMap way within 30 m (OpenFreeMap z14 vector tiles), measured in a projection centred on that point. Paths count as singletrack, tracks as unpaved, other roads as paved. Unmatched stretches use the section kind's default, and runs shorter than 150 m are merged into a neighbour.
5. **Profile** (`route/profile.ts`): a sample about every 100 m with elevation, surface, cumulative climb (5 m hysteresis) and moving time. Moving time is distance ÷ speed plus climb ÷ climbing rate, with speeds per surface and section kind from `trip.yaml`.
6. **Layers**: POIs (`layers/pois.ts`, with the keyword and OpenStreetMap tag rules in `layers/poiRules.ts`: GPX waypoints, the trip's own points, OSM via Overpass), source routes and alternatives (`layers/lines.ts`), the basemap overlay (`layers/basemap.ts`: OpenFreeMap z11, plus Overpass for tribal lands) and land ownership (`layers/land.ts`: BLM SMA polygons clipped with JTS to a corridor around the routes).
7. **Offline packs** (`offline/coverage.ts`): for every pack, every tile within the configured radius of the route and alternatives, per zoom level.
8. **Write** (`output/`): `dist/trip.json`, the full and by-section GPX files, app icons drawn from the route outline, and the generated summary block in `NOTES.md`.

Online responses are cached forever in `.cache/http/` (the OpenFreeMap TileJSON for 30 days; the build logs which planet build it used), so rebuilds are fast and repeatable. Files are written atomically, and responses that report an error with HTTP 200 (Overpass timeouts, truncated ArcGIS results) fail the build instead of being cached. Delete `.cache/` to pull fresh OSM data.

## Bundle (`shared/bundle.ts`)

`trip.json` is the only contract between the pipeline and the app. Most parts are optional: a trip without land data, alternatives or a day plan still works, and the app hides what is missing. Compatibility runs both ways. The current app must open older bundles, and an installed app (an older service-worker shell) must open newer ones. `trip/normalize.ts` drops tile sources and POI categories the app does not know. `version` is a content hash; stored GPX files are keyed by it, so a rebuilt trip asks for its files again.

## App (`app/src/`)

- `main.tsx` routes `/` to the trip list and `/<slug>/` to `TripView`.
- `trip/`: loading (network first with a short timeout when a copy is stored, then that copy), `normalizeBundle`, `buildTripModel` (decodes the bundle into GeoJSON and lookup structures once) and `RouteProfile` (interpolation, snapping to the route).
- `state/tripStore.ts`: one zustand store per trip. Settings (layers, colouring, days, basemap, offline packs) are stored in `localStorage` under `trip:<slug>:settings`, but only those that differ from the trip's defaults, so changed defaults reach returning users. They are written when a setting changes, never for transient UI state (hover, selected day, GPS, camera requests). On load every setting is checked against the current trip and code; invalid values fall back to the default, and saves from another `STORAGE_VERSION` are ignored.
- `plan/dayPlan.ts`: splits the route into days of equal moving time and moves each night to the best stop within ±15 % of a day.
- `map/`: `MapView` creates the MapLibre map once per trip from `buildStyle`. Later setting changes are applied by `useMapSync`. Hover, tooltips and popups are in `MapInteractions`.
- `profile/`: the elevation profile canvas, linked to the map through the store's `hover`.
- `sidebar/`, `ui/`: panels and header.

## Map tiles and offline

All raster and elevation tiles go through the custom `tiles://<source>/{z}/{x}/{y}` protocol (`offline/tileProtocol.ts`). For each tile it tries, in order:

1. a stored copy in Cache Storage (`tiles:<slug>:<pack>` caches, filled only by "Download for offline");
2. the provider over the network (sources in `shared/basemaps.ts`);
3. the nearest stored lower-zoom tile, cropped and scaled up, so offline views zoomed past the downloaded detail stay usable;
4. a transparent tile.

`offline/download.ts` stores the trip files (`trip-files:<slug>`; `trip.json` is also refreshed there on every online load) and the missing tiles of the chosen packs. Tiles the provider does not have are kept as empty markers, so a pack can be complete. Tiles and files from older builds and the caches of removed packs are deleted, and completeness is checked against the bundle's tile list rather than separate bookkeeping. Requests time out after 30 s and are retried; a full storage quota stops the download with a message. Only sources whose terms allow it (`offline: true` in the catalog) can be packed.

The service worker (vite-plugin-pwa / Workbox) precaches the app shell, fonts and map glyphs, so the app starts offline. It does not cache trip data or tiles; that is done explicitly by the app as described above. The map reads stored tiles itself, so tiles work offline even before the service worker is active, but starting the app without a network needs it.

## Trip pages

`app/vite/trips-plugin.ts` serves `trips/<slug>/dist/` under `/trips/<slug>/` during development. In the build, it copies each trip's files and writes `/<slug>/index.html` (title, manifest link and icons of that trip) and `/<slug>/manifest.webmanifest`, so every trip can be installed as its own home-screen app with its own start page and icon. On iOS each installed app also gets its own storage, so offline data must be downloaded inside the installed app; elsewhere storage is shared by the whole site.

Code shared by the pipeline and the app is imported as `#shared/...` (the `imports` field of `package.json`), which Node, Vite, TypeScript and Vitest all resolve.
