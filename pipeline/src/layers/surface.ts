import Flatbush from 'flatbush';
import type { Position } from 'geojson';

import { SURFACES, type Surface, type SurfaceIndex } from '#shared/bundle.ts';
import { degreesAround, localProjection, projectOnSegment } from '#shared/geo.ts';
import { tileAt, tileKey, type TileId } from '#shared/tiles.ts';

import type { TripConfig } from '../config/schema.ts';
import { loadVectorTiles } from '../net/openfreemap.ts';
import type { Route } from '../route/stitch.ts';

const ZOOM = 14;
const MATCH_DISTANCE_M = 30;
const SHORT_GAP_M = 150;
const BRIDGEABLE_GAP_M = 400;
const MIN_RUN_M = 150;
const ROADS = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'minor',
  'service',
  'raceway',
  'bridge',
  'minor_construction',
]);

/** Inclusive point-index range of the route with one surface. */
export interface SurfaceRun {
  start: number;
  end: number;
  surface: SurfaceIndex;
}

export interface SurfaceResult {
  surfaces: Uint8Array;
  runs: SurfaceRun[];
  totalsKm: Record<Surface, number>;
}

function surfaceIndex(surface: Surface): SurfaceIndex {
  return SURFACES.indexOf(surface) as SurfaceIndex;
}

/** OpenMapTiles transportation class -> surface: paths are singletrack, tracks are unpaved roads. */
function classify(properties: Record<string, unknown> | null): SurfaceIndex | null {
  const cls = properties?.class;
  const surface = properties?.surface;
  if (cls === 'path')
    return surfaceIndex(properties?.subclass === 'cycleway' || surface === 'paved' ? 'paved' : 'single');
  if (cls === 'track') return surfaceIndex('unpaved');
  if (typeof cls === 'string' && ROADS.has(cls))
    return surfaceIndex(surface === 'unpaved' ? 'unpaved' : 'paved');
  return null;
}

function tilesAlong(route: Route): TileId[] {
  const tiles = new Map<string, TileId>();
  for (const p of route.points) {
    const { dLat, dLng } = degreesAround(MATCH_DISTANCE_M, p.lat);
    for (const [lng, lat] of [
      [p.lng - dLng, p.lat - dLat],
      [p.lng + dLng, p.lat + dLat],
      [p.lng - dLng, p.lat + dLat],
      [p.lng + dLng, p.lat - dLat],
    ]) {
      const tile = tileAt(lng, lat, ZOOM);
      tiles.set(tileKey(tile), tile);
    }
  }
  return [...tiles.values()];
}

/** A way segment in degrees; distances are measured in a projection centred on each route point. */
interface Segment {
  a: Position;
  b: Position;
  surface: SurfaceIndex;
}

async function matchOsmSurfaces(route: Route): Promise<Int8Array> {
  const segments: Segment[] = [];
  for (const features of await loadVectorTiles(tilesAlong(route), ['transportation'])) {
    for (const feature of features) {
      const surface = classify(feature.properties);
      if (surface === null) continue;
      const g = feature.geometry;
      const lines: Position[][] =
        g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
      for (const line of lines) {
        for (let i = 1; i < line.length; i++) segments.push({ a: line[i - 1], b: line[i], surface });
      }
    }
  }
  const matched = new Int8Array(route.points.length).fill(-1);
  if (segments.length === 0) return matched;
  const index = new Flatbush(segments.length);
  for (const { a, b } of segments)
    index.add(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]));
  index.finish();
  route.points.forEach((p, i) => {
    const project = localProjection(p.lat);
    const [x, y] = project(p.lng, p.lat);
    const { dLat, dLng } = degreesAround(MATCH_DISTANCE_M, p.lat);
    let best = MATCH_DISTANCE_M;
    for (const id of index.search(p.lng - dLng, p.lat - dLat, p.lng + dLng, p.lat + dLat)) {
      const { a, b, surface } = segments[id];
      const { distance } = projectOnSegment(x, y, ...project(a[0], a[1]), ...project(b[0], b[1]));
      if (distance < best) {
        best = distance;
        matched[i] = surface;
      }
    }
  });
  return matched;
}

/** Unmatched stretches: short ones continue the surrounding surface, long ones take the section kind's default. */
export function fillGaps(matched: Int8Array, defaults: Uint8Array, cumM: Float64Array): Uint8Array {
  const out = Uint8Array.from(matched, (v, i) => (v < 0 ? defaults[i] : v));
  const n = matched.length;
  for (let i = 0; i < n;) {
    if (matched[i] >= 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && matched[j] < 0) j++;
    const gap = cumM[Math.min(j, n - 1)] - cumM[i];
    const prev = i > 0 ? out[i - 1] : j < n ? matched[j] : defaults[i];
    const next = j < n ? matched[j] : prev;
    if ((gap < BRIDGEABLE_GAP_M && prev === next) || gap < SHORT_GAP_M) out.fill(prev, i, j);
    i = j;
  }
  return out;
}

/** A run covers the route from its first point to the next run's first point. */
function runLengthM(runs: readonly SurfaceRun[], k: number, cumM: Float64Array): number {
  return cumM[runs[k + 1]?.start ?? runs[k].end] - cumM[runs[k].start];
}

/** Merges runs shorter than MIN_RUN_M into a neighbour, preferring one with the same surface, then the longer one. */
export function mergeShortRuns(surfaces: Uint8Array, cumM: Float64Array): SurfaceRun[] {
  let runs: SurfaceRun[] = [];
  surfaces.forEach((surface, i) => {
    const last = runs.at(-1);
    if (last && last.surface === surface) last.end = i;
    else runs.push({ start: i, end: i, surface: surface as SurfaceIndex });
  });
  while (runs.length > 1) {
    const k = runs.findIndex((_, q) => runLengthM(runs, q, cumM) < MIN_RUN_M);
    if (k < 0) break;
    const run = runs[k];
    const neighbours = [k - 1, k + 1].filter((q) => q >= 0 && q < runs.length);
    const score = (q: number): [number, number] => [
      runs[q].surface === run.surface ? 1 : 0,
      runLengthM(runs, q, cumM),
    ];
    const target = neighbours.reduce((a, b) => {
      const [sa, la] = score(a);
      const [sb, lb] = score(b);
      return sb > sa || (sb === sa && lb > la) ? b : a;
    });
    runs[target] = {
      ...runs[target],
      start: Math.min(runs[target].start, run.start),
      end: Math.max(runs[target].end, run.end),
    };
    runs.splice(k, 1);
  }
  runs = runs.reduce<SurfaceRun[]>((merged, run) => {
    const last = merged.at(-1);
    if (last && last.surface === run.surface) last.end = run.end;
    else merged.push({ ...run });
    return merged;
  }, []);
  return runs;
}

export async function classifySurfaces(route: Route, config: TripConfig): Promise<SurfaceResult> {
  const defaults = Uint8Array.from(route.sectionOf, (s) =>
    surfaceIndex(config.kinds[route.sections[s].config.kind].surface),
  );
  const filled = fillGaps(await matchOsmSurfaces(route), defaults, route.cumM);
  const runs = mergeShortRuns(filled, route.cumM);
  const surfaces = new Uint8Array(route.points.length);
  const totalsKm: Record<Surface, number> = { single: 0, unpaved: 0, paved: 0 };
  runs.forEach((run, k) => {
    surfaces.fill(run.surface, run.start, run.end + 1);
    const nextStart = runs[k + 1]?.start ?? run.end;
    totalsKm[SURFACES[run.surface]] += (route.cumM[nextStart] - route.cumM[run.start]) / 1000;
  });
  for (const key of SURFACES) totalsKm[key] = Math.round(totalsKm[key] * 10) / 10;
  return { surfaces, runs, totalsKm };
}
