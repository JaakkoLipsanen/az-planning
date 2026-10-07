# AGENTS.md

Bikepacking trip maps: a data pipeline turns each trip in `trips/<slug>/` into a bundle, and an offline-capable React web app shows any number of trips. Read `README.md` for the overview and `docs/` for details before larger changes.

## Layout

| Path            | What                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `trips/<slug>/` | One trip: `trip.yaml` (all trip data and settings), `tracks/` (GPX inputs), `NOTES.md`, `dist/` (generated bundle, committed) |
| `pipeline/src/` | Node CLI that builds `trips/<slug>/dist/` from `trip.yaml` and online data (OSM, DEM, BLM)                                    |
| `app/`          | React + MapLibre PWA (Vite). `app/src/` is browser code, `app/vite/` the build plugin that serves trips                       |
| `shared/`       | Code used by both: the bundle schema (`bundle.ts`), tile source catalog, GPX, polyline and geo helpers                        |
| `e2e/`          | Playwright tests against the production build                                                                                 |
| `scripts/`      | Developer tools (`screenshot.ts`)                                                                                             |
| `docs/`         | Architecture, trip editing and data source guides                                                                             |

## Commands

```bash
pnpm install
pnpm dev                               # app with hot reload, opens the browser
pnpm trip validate az-grand-tour       # check trip.yaml and the GPX files, no network (or --all)
pnpm trip build az-grand-tour          # rebuild a trip bundle (or --all)
pnpm trip nearest <slug> <track> <lat,lon>   # point indices for section ranges
pnpm check                             # typecheck + lint + format check + unit tests
pnpm test:e2e                          # Playwright end-to-end tests (builds the app)
pnpm screenshot <url> --out shot.png   # headless screenshot after the map has drawn
pnpm fmt                               # format with oxfmt
```

## Working rules

- Code and data stay separate. Anything specific to one trip belongs in `trips/<slug>/trip.yaml`, never in `pipeline/` or `app/`.
- After changing `trip.yaml`, tracks or the pipeline, run `pnpm trip build <slug>` and commit the regenerated `trips/<slug>/dist/` (and `NOTES.md`, whose summary block is generated).
- The bundle format is `shared/bundle.ts`. Keep fields optional where a trip may not have them, and keep the app working with older bundles (older trips do not need new features). Installed apps run an older app shell against newer bundles, so new values must not crash old code; `app/src/trip/normalize.ts` drops what the app does not know. Bump `BUNDLE_SCHEMA_VERSION` only for breaking changes.
- Verify every change that affects the app in a browser: run `pnpm screenshot` (or a Playwright script) on the dev server and look at the result, and run `pnpm test:e2e` before finishing. Embedded or hidden browser previews may pause map rendering; headless Playwright does not.
- Saved trip settings outlive app versions. A new setting needs a default and a check in `app/src/state/tripStore.ts` (TypeScript requires the check); renaming a setting or changing its meaning needs a `STORAGE_VERSION` bump, which drops older saves.
- Run `pnpm check` before committing; it must pass without warnings.
- Node.js and pnpm versions are pinned in `package.json` (`devEngines.runtime`, `packageManager`); run tools through pnpm (`pnpm exec`, not `npx`). pnpm settings live in `pnpm-workspace.yaml`. pnpm refuses package versions published less than a day ago (`minimumReleaseAge`); use the previous version or wait.
- Do not add AI tool attribution (co-author lines, "generated with" notes or similar) to commit messages or commit descriptions.

## Code style

- TypeScript everywhere, strict. Pipeline and shared code run directly on Node (type stripping): only erasable syntax (no enums, namespaces or constructor parameter properties) and import paths with `.ts` / `.tsx` extensions. Import shared code as `#shared/<file>.ts`.
- Comments only when the code cannot say it; at most two short sentences. Prefer clear names and small functions over explanations.
- React: function components, state in the per-trip zustand store (`app/src/state/tripStore.ts`), MapLibre changes applied from effects in `app/src/map/useMapSync.ts`. Effects synchronise with external systems only; derive everything else during render.
- Styles: CSS modules next to components; theme tokens in `app/src/styles/global.css`, colours that the map or canvas also need in `app/src/theme.ts`.
- Unit tests (`*.test.ts`, Vitest) sit next to the code they test; cover pure logic (`app/src/testing/testBundle.ts` is a small bundle for app tests). User-facing behaviour gets a Playwright test in `e2e/`; read expected values from the trip bundle (`BUNDLE` in `e2e/fixtures.ts`) instead of hard-coding them.
- Lint and format with oxlint and oxfmt (`.oxlintrc.json`, `.oxfmtrc.json`).
