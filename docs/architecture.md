# Architecture

## Pipeline (`pipeline/src/`)

`pnpm trip build <slug>` runs `build.ts`, which goes through these steps in order:

1. **Load** (`config/`): parse `trip.yaml` with the zod schema in `config/schema.ts`, check cross-references (unique ids, known tracks and kinds, packs only for shown basemaps) and read every GPX file. Track points keep their original text, so output GPX files reproduce the source points exactly.
2. **Stitch** (`route/stitch.ts`): concatenate the section slices into one route, drop consecutive duplicates, record which section each point came from and warn about gaps over 30 m. `pnpm trip validate` stops here, without network access.
3. **Elevation** (`geo/elevation.ts`): points without elevation (usually connectors) are sampled from Terrarium DEM tiles at zoom 12.
4. **Surface** (`layers/surface.ts`): every route point is matched to the nearest OpenStreetMap way within 30 m (OpenFreeMap z14 vector tiles), measured in a projection centred on that point. Paths count as singletrack (unless a section sets `pathSurface`), tracks and unpaved cycleways as unpaved, other roads as paved. Unmatched stretches use the section kind's default, and runs shorter than 150 m are merged into a neighbour.
5. **Profile** (`route/profile.ts`): a sample about every 100 m with elevation, surface, cumulative climb (5 m hysteresis) and moving time. Moving time is distance ÷ speed plus climb ÷ climbing rate, with speeds per surface and section kind from `trip.yaml`.
6. **Layers**: POIs (`layers/pois.ts`, with the keyword and OpenStreetMap tag rules in `layers/poiRules.ts`: GPX waypoints, the trip's own points, OSM via Overpass; each gets the route km of every pass, `route/passes.ts`, and water points a kind), source routes and alternatives (`layers/lines.ts`), the basemap overlay (`layers/basemap.ts`: OpenFreeMap z11, plus Overpass for tribal lands) and land ownership (`layers/land.ts`: BLM SMA polygons clipped with JTS to a corridor around the routes).
7. **Climate** (`layers/climate.ts`, `net/power.ts`): NASA POWER daily data for the grid cells near the route, reduced to weekly values per cell (averages, cold and hot percentiles, wind).
8. **Offline packs** (`offline/coverage.ts`): for every pack, every tile within the configured radius of the route and alternatives, per zoom level.
9. **Write** (`output/`): `dist/trip.json`, the full and by-section GPX files, app icons drawn from the route outline, and the generated summary block in `NOTES.md`.

Notices are placed on the route from their sections or point (`build.ts`). `--offline` builds only from `.cache/` and `--strict` turns warnings into errors (as CI does for `validate`).

Online responses are cached forever in `.cache/http/` (the OpenFreeMap TileJSON for 30 days; the build logs which planet build it used), so rebuilds are fast and repeatable. Files are written atomically, and responses that report an error with HTTP 200 (Overpass timeouts, NASA POWER errors) fail the build instead of being cached. Delete `.cache/` to pull fresh OSM data.

## Bundle (`shared/bundle.ts`)

`trip.json` is the only contract between the pipeline and the app. Most parts are optional: a trip without land data, alternatives or a day plan still works, and the app hides what is missing. Compatibility runs both ways. The current app must open older bundles, and an installed app (an older service-worker shell) must open newer ones. `trip/normalize.ts` drops tile sources and POI categories the app does not know. `version` is a content hash; stored GPX files are keyed by it, so a rebuilt trip asks for its files again.

## App (`app/src/`)

- `main.tsx` routes `/` to the trip list and `/<slug>/` to `TripView`.
- `trip/`: loading (network first with a short timeout when a copy is stored, then that copy), `normalizeBundle`, `buildTripModel` (decodes the bundle into GeoJSON and lookup structures once, including every pass of each POI as `stops` and the gradient classes) and `RouteProfile` (interpolation, snapping to the route). Where the route passes the same place more than once, `snap` takes the pass nearest to a hint km, and `RouteFollower` follows a GPS position by the direction it moves along each pass; the first fix uses the last remembered position or where the plan expects the rider today.
- `state/tripStore.ts`: one zustand store per trip. Settings (layers, colouring, days, fixed nights, rest days, riding hours, basemap, offline packs) are stored in `localStorage` under `trip:<slug>:settings`, but only those that differ from the trip's defaults, so changed defaults reach returning users. They are written when a setting changes, never for transient UI state (hover, selected day, GPS, camera requests). On load every setting is checked against the current trip and code; invalid values fall back to the default, and saves from another `STORAGE_VERSION` are ignored. "Share plan" puts the settings that differ from the defaults in the address (`#plan=`, `state/shareLink.ts`); opening such a link shows them without saving until the user keeps them.
- `plan/`: `dayPlan.ts` splits the route into days of equal moving time and moves each night to the best stop within ±15 % of a day; nights the user fixed stay put and the days between them are split the same way. `calendar.ts` dates the days around rest days, `supplies.ts` measures the stretches without water or resupply (shops count as water) with a rough litre estimate, `notes.ts` matches the trip's notices and shops' opening hours to the planned dates, and `progress.ts` holds what the GPS card needs.
- `map/`: `MapView` creates the MapLibre map once per trip from `buildStyle`. Later setting changes are applied by `useMapSync`. Hover, tooltips and popups are in `MapInteractions`.
- `profile/`: the elevation profile canvas (elevation or typical temperature), linked to the map through the store's `hover`.
- `climate/`: sun and moon times (`sun.ts`, `moon.ts`), dates in the trip's time zone (`time.ts`), the climate grid with elevation adjustment and the daily temperature curve (`field.ts`), per-day conditions (riding hours against civil dusk, typical weather, wind along the day's direction, the moon), the National Weather Service forecast for the coming week (`forecast.ts`), and the temperature overlay. The overlay is a computed tile source: `temperatureTiles.ts` renders each tile from the elevation tile at the same position, so it follows valleys and ridges and works offline wherever terrain tiles are stored. While it is on, hovering the map (tapping on phones) shows the value at that point, computed from the same cached terrain tile (`elevation.ts`). The overlay's card also summarises the whole route at that date and hour: minimum, 10th percentile, average, 90th percentile and maximum (`routeStats.ts`).
- `map/measure.ts` and `MeasurePanel.tsx`: the distance tool (with climb and time along the route); while it is on, map clicks add points instead of opening popups.
- `sidebar/`, `ui/`: panels (day plan, water and resupply, checklist, layers), the header and search. Search results open their popup through the store's `focusOn`.

## Map tiles and offline

All raster and elevation tiles go through the custom `tiles://<source>/{z}/{x}/{y}` protocol (`offline/tileProtocol.ts`). For each tile it tries, in order:

1. a stored copy in Cache Storage (`tiles:<slug>:<pack>` caches, filled only by "Download for offline");
2. the provider over the network (sources in `shared/basemaps.ts`);
3. the nearest stored lower-zoom tile, cropped and scaled up, so offline views zoomed past the downloaded detail stay usable;
4. a transparent tile.

Computed tiles register a renderer with `setTileRenderer(name, …)` and are requested as `tiles://<name>/{z}/{x}/{y}?…`; the temperature overlay is one.

`offline/download.ts` stores the trip files (`trip-files:<slug>`; `trip.json` is also refreshed there on every online load) and the missing tiles of the chosen packs. Tiles the provider does not have are kept as empty markers, so a pack can be complete. Tiles and files from older builds and the caches of removed packs are deleted, and completeness is checked against the bundle's tile list rather than separate bookkeeping. Requests time out after 30 s and are retried; a full storage quota stops the download with a message. Only sources whose terms allow it (`offline: true` in the catalog) can be packed.

The service worker (vite-plugin-pwa / Workbox) precaches the app shell, fonts and map glyphs, so the app starts offline. It does not cache trip data or tiles; that is done explicitly by the app as described above. The map reads stored tiles itself, so tiles work offline even before the service worker is active, but starting the app without a network needs it.

## Trip pages

`app/vite/trips-plugin.ts` serves `trips/<slug>/dist/` under `/trips/<slug>/` during development. In the build, it copies each trip's files and writes `/<slug>/index.html` (title, manifest link and icons of that trip) and `/<slug>/manifest.webmanifest`, so every trip can be installed as its own home-screen app with its own start page and icon. On iOS each installed app also gets its own storage, so offline data must be downloaded inside the installed app; elsewhere storage is shared by the whole site.

Code shared by the pipeline and the app is imported as `#shared/...` (the `imports` field of `package.json`), which Node, Vite, TypeScript and Vitest all resolve.
