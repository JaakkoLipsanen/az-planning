import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { TILE_SOURCES } from '#shared/basemaps.ts';
import {
  BUNDLE_SCHEMA_VERSION,
  type OfflinePack,
  type PlanSettings,
  type Poi,
  type Section,
  type TripBundle,
} from '#shared/bundle.ts';
import { boundsOf, round, simplify, type Bounds, type LngLat } from '#shared/geo.ts';
import { encodePolyline } from '#shared/polyline.ts';
import { countTiles } from '#shared/tiles.ts';

import { loadTrip, type Trip } from './config/load.ts';
import { ElevationModel } from './geo/elevation.ts';
import { PointIndex } from './geo/spatial.ts';
import { buildBasemapOverlay } from './layers/basemap.ts';
import { buildLandLayer } from './layers/land.ts';
import { alternativePoints, buildAlternatives, buildSourceLines } from './layers/lines.ts';
import { collectPois, type PoiCandidate } from './layers/pois.ts';
import { classifySurfaces, type SurfaceRun } from './layers/surface.ts';
import { log } from './log.ts';
import { coverageTiles } from './offline/coverage.ts';
import { buildRouteGpx } from './output/gpx.ts';
import { writeIcons } from './output/icons.ts';
import { updateNotes } from './output/notes.ts';
import { tripDistDir } from './paths.ts';
import { buildProfile, type SectionTotals } from './route/profile.ts';
import { lengthM, lngLats, stitchRoute, type Route } from './route/stitch.ts';

const SECTION_TOLERANCE_M = 6;
const OVERNIGHT_HINT_WINDOW_KM = 25;
const REGION_MARGIN_DEG = 0.5;

/** Each section drawn as one line per surface run; it starts at the previous section's last point so the route has no gaps. */
function sectionParts(route: Route, runs: readonly SurfaceRun[], index: number): Section['parts'] {
  const first = route.sectionOf.indexOf(index);
  const last = route.sectionOf.lastIndexOf(index);
  if (first < 0) return [];
  const from = Math.max(0, first - 1);
  const parts: Section['parts'] = [];
  for (const run of runs) {
    const a = Math.max(run.start, from);
    const b = Math.min(run.end, last);
    if (a > b) continue;
    const coords = lngLats(route.points.slice(a, Math.min(b + 1, last) + 1));
    if (coords.length >= 2)
      parts.push({ surface: run.surface, line: encodePolyline(simplify(coords, SECTION_TOLERANCE_M)) });
  }
  return parts;
}

function buildSections(
  route: Route,
  runs: readonly SurfaceRun[],
  totals: readonly SectionTotals[],
): Section[] {
  return route.sections.map((s, i) => ({
    id: s.config.id,
    name: s.config.name,
    kind: s.config.kind,
    km: round(lengthM(s.points) / 1000, 1),
    climbM: Math.round(totals[i].climbM),
    movingHours: round(totals[i].movingHours, 1),
    parts: sectionParts(route, runs, i),
  }));
}

function kmIndexRange(route: Route, km: number): [number, number] {
  const lo = (km - OVERNIGHT_HINT_WINDOW_KM) * 1000;
  const hi = (km + OVERNIGHT_HINT_WINDOW_KM) * 1000;
  const first = route.cumM.findIndex((m) => m >= lo);
  const after = route.cumM.findIndex((m) => m > hi);
  return [Math.max(0, first), after < 0 ? route.cumM.length - 1 : after - 1];
}

function buildPlan(trip: Trip, route: Route, index: PointIndex): PlanSettings | undefined {
  const plan = trip.config.plan;
  if (!plan) return undefined;
  return {
    minDays: plan.days.min,
    maxDays: plan.days.max,
    defaultDays: plan.days.default,
    longDayHours: plan.longDayHours,
    start: plan.start,
    finish: plan.finish,
    note: plan.note,
    overnights: plan.overnights.map((o) => {
      const near =
        o.km === undefined
          ? index.nearest(o.lat, o.lon)
          : index.nearest(o.lat, o.lon, ...kmIndexRange(route, o.km));
      return { name: o.name, lat: o.lat, lng: o.lon, km: round(route.cumM[near.index] / 1000, 1) };
    }),
  };
}

function buildOfflinePacks(trip: Trip, lines: LngLat[][]): OfflinePack[] {
  return (trip.config.offline?.packs ?? []).map((pack) => {
    const tiles = coverageTiles(lines, pack.radiusKm);
    const tileCount = countTiles(tiles);
    const estimatedBytes = tileCount * TILE_SOURCES[pack.source].averageTileBytes;
    log.info(`offline pack ${pack.id}: ${tileCount} tiles, ~${Math.round(estimatedBytes / 1e6)} MB`);
    return {
      id: pack.id,
      label: pack.label,
      source: pack.source,
      tiles,
      tileCount,
      estimatedBytes,
      ...(pack.selected ? {} : { selected: false }),
    };
  });
}

function regionAround(bounds: Bounds): Bounds {
  const [w, s, e, n] = bounds;
  return [w - REGION_MARGIN_DEG, s - REGION_MARGIN_DEG, e + REGION_MARGIN_DEG, n + REGION_MARGIN_DEG];
}

function publicPoi({ distanceM: _distanceM, ...poi }: PoiCandidate): Poi {
  return poi;
}

function contentVersion(...parts: string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest('hex').slice(0, 12);
}

export async function buildTrip(slug: string): Promise<TripBundle> {
  log.step(`Loading trips/${slug}`);
  const trip = await loadTrip(slug);
  const { config } = trip;
  const route = stitchRoute(trip);
  const routeIndex = new PointIndex(route.points);
  const distanceKm = round((route.cumM.at(-1) ?? 0) / 1000, 1);
  log.info(`${route.sections.length} sections, ${route.points.length} points, ${distanceKm} km`);

  log.step('Elevation');
  const alternatives = alternativePoints(trip);
  const dem = new ElevationModel();
  const shown = Object.entries(config.tracks)
    .filter(([, t]) => t.show)
    .flatMap(([key]) => trip.tracks.get(key) ?? []);
  await dem.load([...route.points, ...alternatives.flat(), ...shown].filter((p) => p.ele === null));
  const elevations = dem.fill(route.points);

  log.step('Surface (OpenStreetMap via OpenFreeMap)');
  const surface = await classifySurfaces(route, config);
  log.info(
    `singletrack ${surface.totalsKm.single} km, unpaved ${surface.totalsKm.unpaved} km, paved ${surface.totalsKm.paved} km`,
  );
  const { profile, sections: totals } = buildProfile(route, elevations, surface.surfaces, config);
  const stats = {
    distanceKm,
    climbM: profile.climbM.at(-1) ?? 0,
    movingHours: round(profile.hours.at(-1) ?? 0, 1),
  };
  log.info(`${stats.distanceKm} km, +${stats.climbM} m, ${stats.movingHours} h moving`);

  log.step('Points of interest');
  const pois = await collectPois(trip, route, routeIndex);

  const bounds = boundsOf(lngLats(route.points));
  const region = config.region ?? regionAround(bounds);
  log.step('Basemap overlay (OpenFreeMap, Overpass)');
  const basemap = config.basemap ? await buildBasemapOverlay(region, config.basemap.majorPlaces) : undefined;

  const corridorLines: LngLat[][] = [lngLats(route.points), ...alternatives.map(lngLats)];
  let land: TripBundle['land'];
  if (config.land) {
    log.step('Land ownership (BLM Surface Management Agency)');
    land = await buildLandLayer(region, corridorLines, config.land.corridorKm, config.land.note);
  }

  log.step('Offline packs');
  const offline = config.offline ? { packs: buildOfflinePacks(trip, corridorLines) } : undefined;

  const gpx = buildRouteGpx(trip, route, pois, stats);
  const bundle: Omit<TripBundle, 'version'> = {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    slug,
    title: config.title,
    shortName: config.shortName,
    subtitle: config.subtitle,
    description: config.description,
    attribution: config.attribution,
    bounds,
    region,
    stats,
    kinds: Object.fromEntries(
      Object.entries(config.kinds).map(([key, k]) => [key, { label: k.label, color: k.color }]),
    ),
    sections: buildSections(route, surface.runs, totals),
    profile,
    surfaceTotalsKm: surface.totalsKm,
    sources: buildSourceLines(trip, dem),
    alternatives: buildAlternatives(trip, dem),
    pois: config.pois
      ? { items: pois.map(publicPoi), note: config.pois.note, link: config.pois.link }
      : undefined,
    plan: buildPlan(trip, route, routeIndex),
    land,
    basemap,
    imagery: config.imagery && {
      basemaps: config.imagery.basemaps,
      default: config.imagery.default,
      thumbnail: config.imagery.thumbnail && {
        lat: config.imagery.thumbnail.lat,
        lng: config.imagery.thumbnail.lon,
      },
    },
    offline,
    files: { gpxFull: gpx.full.file, gpxSections: gpx.sections.file },
  };
  const json = JSON.stringify(bundle);
  const result: TripBundle = { ...bundle, version: contentVersion(json, gpx.full.text, gpx.sections.text) };

  log.step('Writing');
  const dist = tripDistDir(slug);
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await Promise.all([
    writeFile(path.join(dist, 'trip.json'), JSON.stringify(result)),
    writeFile(path.join(dist, gpx.full.file), gpx.full.text),
    writeFile(path.join(dist, gpx.sections.file), gpx.sections.text),
    writeIcons(
      dist,
      profile.lng.map((lng, i): LngLat => [lng, profile.lat[i]]),
    ),
    updateNotes(path.join(trip.dir, 'NOTES.md'), result),
  ]);
  log.info(`trips/${slug}/dist written, version ${result.version}`);
  return result;
}
