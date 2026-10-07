import type { Poi } from '#shared/bundle.ts';
import { haversineM, round, simplify, type Bounds } from '#shared/geo.ts';

import type { Trip } from '../config/load.ts';
import type { PoiConfig } from '../config/schema.ts';
import type { PointIndex } from '../geo/spatial.ts';
import { log } from '../log.ts';
import { overpass } from '../net/overpass.ts';
import { lngLats, type Route } from '../route/stitch.ts';
import { classifyOsm, osmQuery, waypointClassifier } from './poiRules.ts';

const MERGE_DISTANCE_M = 300;
const QUERY_LINE_TOLERANCE_M = 200;

/** A POI with its distance to the route, which the GPX export filters on. */
export interface PoiCandidate extends Poi {
  distanceM: number;
}

type Placement = Pick<PoiCandidate, 'km' | 'offRouteM' | 'distanceM'>;

function normalizedName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the /, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replaceAll(' company', ' co')
    .replace(/s+$/, '')
    .trim();
}

function positionKey(poi: Poi, digits: number, nameLength: number): string {
  return `${poi.lat.toFixed(digits)},${poi.lng.toFixed(digits)},${poi.name.toLowerCase().slice(0, nameLength)}`;
}

const exactKey = (poi: Poi): string => positionKey(poi, 4, 20);
const looseKey = (poi: Poi): string => positionKey(poi, 3, 12);

class PoiList {
  readonly items: PoiCandidate[] = [];
  private readonly exact = new Set<string>();
  private readonly loose = new Set<string>();

  /** Skips exact repeats and merges a same-named point within MERGE_DISTANCE_M (several routes share waypoints). */
  merge(poi: PoiCandidate): void {
    if (this.exact.has(exactKey(poi))) return;
    this.exact.add(exactKey(poi));
    const name = normalizedName(poi.name);
    const twin = this.items.find(
      (q) => normalizedName(q.name) === name && haversineM(q.lat, q.lng, poi.lat, poi.lng) < MERGE_DISTANCE_M,
    );
    if (!twin) {
      this.push(poi);
      return;
    }
    if (poi.description && !twin.description?.includes(poi.description)) {
      twin.description = twin.description ? `${twin.description} | ${poi.description}` : poi.description;
    }
    if (!twin.source.includes(poi.source))
      twin.source = `${twin.source} + ${poi.source.replace(' waypoint', '')}`;
  }

  /** Adds a point unless one with about the same position and name exists; returns whether it was added. */
  addDistinct(poi: PoiCandidate): boolean {
    if (this.loose.has(looseKey(poi))) return false;
    this.push(poi);
    return true;
  }

  private push(poi: PoiCandidate): void {
    this.items.push(poi);
    this.loose.add(looseKey(poi));
  }
}

function inBounds([w, s, e, n]: Bounds, lat: number, lng: number): boolean {
  return lat >= s && lat <= n && lng >= w && lng <= e;
}

async function addOsmPois(
  list: PoiList,
  route: Route,
  place: (lat: number, lng: number, onRouteM: number) => Placement,
  config: NonNullable<PoiConfig['osm']>,
): Promise<number> {
  const line = simplify(lngLats(route.points), QUERY_LINE_TOLERANCE_M).map(([lng, lat]): [number, number] => [
    lat,
    lng,
  ]);
  let added = 0;
  for (const el of await overpass(osmQuery(line, config.radiusM))) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat === undefined || lng === undefined) continue;
    const dense = config.denseAreas.some((box) => inBounds(box, lat, lng));
    const poi = classifyOsm(el.tags ?? {}, dense);
    if (!poi) continue;
    const where = place(lat, lng, config.onRouteDistanceM);
    const isNew = list.addDistinct({
      name: poi.name,
      category: poi.category,
      lat: round(lat, 5),
      lng: round(lng, 5),
      description: poi.description.trim(),
      source: 'OpenStreetMap',
      osm: true,
      km: where.km,
      offRouteM: Math.round(where.distanceM),
      distanceM: where.distanceM,
    });
    if (isNew) added++;
  }
  return added;
}

function applyCorrections(items: PoiCandidate[], config: PoiConfig): void {
  const names = new Set(items.map((p) => p.name));
  for (const [what, record] of [
    ['categoryOverrides', config.categoryOverrides],
    ['descriptionAppend', config.descriptionAppend],
  ] as const) {
    const unknown = Object.keys(record).filter((name) => !names.has(name));
    if (unknown.length > 0) log.warn(`pois.${what} names no point: ${unknown.join(', ')}`);
  }
  for (const poi of items) {
    poi.category = config.categoryOverrides[poi.name] ?? poi.category;
    const extra = config.descriptionAppend[poi.name];
    if (extra) poi.description = (poi.description ?? '') + extra;
  }
}

export async function collectPois(trip: Trip, route: Route, routeIndex: PointIndex): Promise<PoiCandidate[]> {
  const config = trip.config.pois;
  if (!config) return [];
  const list = new PoiList();
  const place = (lat: number, lng: number, onRouteM = config.onRouteDistanceM): Placement => {
    const near = routeIndex.nearest(lat, lng);
    const onRoute = near.distanceM < onRouteM;
    return {
      km: onRoute ? round(route.cumM[near.index] / 1000, 1) : undefined,
      offRouteM: onRoute ? undefined : Math.round(near.distanceM),
      distanceM: near.distanceM,
    };
  };

  const classify = waypointClassifier(config.keywords);
  for (const [key, track] of Object.entries(trip.config.tracks)) {
    if (!track.waypoints) continue;
    for (const w of trip.waypoints.get(key) ?? []) {
      const where = place(w.lat, w.lng);
      if (!track.waypoints.keepAll && where.distanceM > config.waypointMaxDistanceM) continue;
      list.merge({
        name: w.name,
        category: classify(w.name, w.description ?? ''),
        lat: round(w.lat, 5),
        lng: round(w.lng, 5),
        description: w.description || undefined,
        source: `${track.waypoints.label} waypoint`,
        ...where,
      });
    }
  }
  for (const c of config.custom) {
    list.merge({
      name: c.name,
      category: c.category,
      lat: c.lat,
      lng: c.lon,
      description: c.description || undefined,
      source: 'route notes',
      ...place(c.lat, c.lon),
      offRouteM: undefined,
    });
  }
  applyCorrections(list.items, config);
  log.info(`${list.items.length} points from route files and notes`);
  if (config.osm) log.info(`${await addOsmPois(list, route, place, config.osm)} points from OpenStreetMap`);
  return list.items;
}
