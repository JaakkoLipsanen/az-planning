import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';

import type { LandCategory, Poi, TrackLine, TripBundle } from '#shared/bundle.ts';
import {
  boundsOf,
  haversineM,
  localProjection,
  projectOnSegment,
  type Bounds,
  type LngLat,
} from '#shared/geo.ts';
import { decodeIntegers, decodePolyline } from '#shared/polyline.ts';

import { ClimateField } from '../climate/field.ts';
import { gradeClasses } from './grade.ts';
import { RouteProfile } from './profile.ts';

export type LineKind = 'source' | 'alternative';

/** A source route or alternative with what hovering needs: chainage and elevations per vertex. */
export interface LineModel {
  track: TrackLine;
  kind: LineKind;
  coords: LngLat[];
  cumKm: number[];
  elevations: number[] | null;
  bounds: Bounds;
}

export interface LineSnap {
  km: number;
  position: LngLat;
  ele: number | null;
  distanceM: number;
}

interface LandPolygon {
  category: LandCategory;
  rings: LngLat[][];
  bounds: Bounds;
}

/** A point of interest at one of the places the route passes it. */
export interface RouteStop {
  km: number;
  /** Index into TripModel.pois. */
  index: number;
  poi: Poi;
}

/** Route kms of a point of interest: one per pass, none when it is off the route. */
export function poiKms(poi: Poi): number[] {
  return poi.kms ?? (poi.km === undefined ? [] : [poi.km]);
}

/** The final route as one ordered line, with km scaled to the profile's km. */
export interface RouteLine {
  coords: LngLat[];
  km: number[];
}

export interface TripModel {
  bundle: TripBundle;
  profile: RouteProfile;
  /** Steepness class of every profile sample (see GRADE_CLASSES). */
  grades: Uint8Array;
  /** Typical weather near the route; null for trips built without climate data. */
  climate: ClimateField | null;
  /** IANA time zone for dates and sun times. */
  timeZone: string;
  route: RouteLine;
  sectionBounds: Bounds[];
  lines: Map<string, LineModel>;
  pois: Poi[];
  /** Every pass of a point of interest, ordered by route km. */
  stops: RouteStop[];
  geojson: {
    sections: FeatureCollection<LineString>;
    sources: FeatureCollection<LineString>;
    alternatives: FeatureCollection<LineString>;
    pois: FeatureCollection<Point>;
    land: FeatureCollection<Polygon>;
    basemapLines: FeatureCollection<LineString>;
    basemapAreas: FeatureCollection<Polygon>;
    boundaries: FeatureCollection<LineString>;
    places: FeatureCollection<Point>;
    peaks: FeatureCollection<Point>;
  };
  landAt: (lng: number, lat: number) => LandCategory | null;
}

const collection = <G extends LineString | Point | Polygon>(
  features: Feature<G>[],
): FeatureCollection<G> => ({
  type: 'FeatureCollection',
  features,
});

function lineFeature(coordinates: LngLat[], properties: Record<string, unknown>): Feature<LineString> {
  return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates } };
}

function pointFeature(lng: number, lat: number, properties: Record<string, unknown>): Feature<Point> {
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: [lng, lat] } };
}

function closedRing(encoded: string): LngLat[] {
  const ring = decodePolyline(encoded);
  const first = ring[0];
  const last = ring.at(-1);
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push(first);
  return ring;
}

function decodeLines(list: readonly string[] | undefined, kind: string): Feature<LineString>[] {
  return (list ?? []).map((s) => lineFeature(decodePolyline(s), { kind }));
}

function decodeAreas(list: readonly string[] | undefined, kind: string): Feature<Polygon>[] {
  return (list ?? []).map((s) => ({
    type: 'Feature',
    properties: { kind },
    geometry: { type: 'Polygon', coordinates: [closedRing(s)] },
  }));
}

function cumulativeKm(coords: readonly LngLat[]): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) {
    out.push(out[i - 1] + haversineM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]) / 1000);
  }
  return out;
}

function lineModel(track: TrackLine, kind: LineKind): LineModel {
  const coords = decodePolyline(track.line);
  return {
    track,
    kind,
    coords,
    cumKm: cumulativeKm(coords),
    elevations: track.elevations ? decodeIntegers(track.elevations) : null,
    bounds: boundsOf(coords),
  };
}

export function snapToLine(model: LineModel, lng: number, lat: number): LineSnap {
  const project = localProjection(lat);
  const [x, y] = project(lng, lat);
  let best = 1;
  let bestD = Infinity;
  let bestT = 0;
  for (let i = 1; i < model.coords.length; i++) {
    const { t, distance } = projectOnSegment(
      x,
      y,
      ...project(...model.coords[i - 1]),
      ...project(...model.coords[i]),
    );
    if (distance < bestD) {
      bestD = distance;
      best = i;
      bestT = t;
    }
  }
  const a = model.coords[best - 1];
  const b = model.coords[best];
  const lerp = (p: number, q: number): number => p + (q - p) * bestT;
  const ele = model.elevations ? lerp(model.elevations[best - 1], model.elevations[best]) : null;
  return {
    km: lerp(model.cumKm[best - 1], model.cumKm[best]),
    position: [lerp(a[0], b[0]), lerp(a[1], b[1])],
    ele,
    distanceM: bestD,
  };
}

function routeLine(bundle: TripBundle, totalKm: number): RouteLine {
  const coords: LngLat[] = [];
  for (const section of bundle.sections) {
    for (const part of section.parts) {
      for (const c of decodePolyline(part.line)) {
        const last = coords.at(-1);
        if (!last || last[0] !== c[0] || last[1] !== c[1]) coords.push(c);
      }
    }
  }
  const km = cumulativeKm(coords);
  const scale = totalKm / (km.at(-1) || 1);
  return { coords, km: km.map((v) => v * scale) };
}

function inRing(ring: readonly LngLat[], lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Grid cell size of the land lookup, degrees. */
const LAND_CELL_DEG = 0.1;

const landCell = (lng: number, lat: number): string =>
  `${Math.floor(lng / LAND_CELL_DEG)},${Math.floor(lat / LAND_CELL_DEG)}`;

function landLookup(polygons: readonly LandPolygon[]): TripModel['landAt'] {
  const grid = new Map<string, LandPolygon[]>();
  for (const p of polygons) {
    const [w, s, e, n] = p.bounds;
    for (let x = Math.floor(w / LAND_CELL_DEG); x <= Math.floor(e / LAND_CELL_DEG); x++) {
      for (let y = Math.floor(s / LAND_CELL_DEG); y <= Math.floor(n / LAND_CELL_DEG); y++) {
        const key = `${x},${y}`;
        grid.set(key, [...(grid.get(key) ?? []), p]);
      }
    }
  }
  return (lng, lat) => {
    for (const p of grid.get(landCell(lng, lat)) ?? []) {
      const [w, s, e, n] = p.bounds;
      if (lng < w || lng > e || lat < s || lat > n) continue;
      if (!inRing(p.rings[0], lng, lat)) continue;
      if (p.rings.slice(1).some((hole) => inRing(hole, lng, lat))) continue;
      return p.category;
    }
    return null;
  };
}

export function buildTripModel(bundle: TripBundle): TripModel {
  const profile = new RouteProfile(bundle.profile);
  const sectionFeatures: Feature<LineString>[] = [];
  const sectionBounds = bundle.sections.map((section, index) => {
    let bounds: Bounds | undefined;
    for (const part of section.parts) {
      const coords = decodePolyline(part.line);
      bounds = boundsOf(coords, bounds);
      sectionFeatures.push(
        lineFeature(coords, {
          section: index,
          id: section.id,
          surface: part.surface,
          color: bundle.kinds[section.kind]?.color ?? '#888888',
        }),
      );
    }
    return bounds ?? bundle.bounds;
  });

  const lines = new Map<string, LineModel>();
  for (const line of bundle.sources ?? []) lines.set(line.id, lineModel(line, 'source'));
  for (const group of bundle.alternatives ?? [])
    for (const alt of group.items) lines.set(alt.id, lineModel(alt, 'alternative'));
  const lineFeatures = (kind: LineKind): Feature<LineString>[] =>
    [...lines.values()]
      .filter((l) => l.kind === kind)
      .map((l) =>
        lineFeature(l.coords, {
          id: l.track.id,
          color: l.track.color,
          style: 'style' in l.track ? l.track.style : 'option',
        }),
      );

  const pois = bundle.pois?.items ?? [];
  const land = bundle.land;
  const categories = new Map(land?.categories.map((c) => [c.id, c]) ?? []);
  const landPolygons: LandPolygon[] = [];
  for (const f of land?.features ?? []) {
    const category = categories.get(f.category);
    const rings = f.rings.map(closedRing).filter((r) => r.length >= 4);
    if (category && rings.length > 0) landPolygons.push({ category, rings, bounds: boundsOf(rings[0]) });
  }

  const base = bundle.basemap;

  return {
    bundle,
    profile,
    grades: gradeClasses(profile),
    climate: bundle.climate ? new ClimateField(bundle.climate) : null,
    timeZone: bundle.timezone ?? 'UTC',
    route: routeLine(bundle, profile.totalKm),
    sectionBounds,
    lines,
    pois,
    stops: pois
      .flatMap((poi, index) => poiKms(poi).map((km): RouteStop => ({ km, index, poi })))
      .toSorted((a, b) => a.km - b.km),
    geojson: {
      sections: collection(sectionFeatures),
      sources: collection(lineFeatures('source')),
      alternatives: collection(lineFeatures('alternative')),
      pois: collection(
        pois.map((p, index) =>
          pointFeature(p.lng, p.lat, {
            index,
            group: p.osm ? 'osm' : p.category,
            icon: `poi-${p.category}${p.osm ? '-small' : ''}`,
          }),
        ),
      ),
      land: collection(
        landPolygons.map((p) => ({
          type: 'Feature',
          properties: { category: p.category.id },
          geometry: { type: 'Polygon', coordinates: p.rings },
        })),
      ),
      basemapLines: collection([
        ...decodeLines(base?.roadsMajor, 'major'),
        ...decodeLines(base?.roadsMinor, 'minor'),
        ...decodeLines(base?.rail, 'rail'),
        ...decodeLines(base?.rivers, 'river'),
      ]),
      basemapAreas: collection([
        ...decodeAreas(base?.lakes, 'lake'),
        ...decodeAreas(base?.forests, 'forest'),
        ...decodeAreas(base?.wilderness, 'wilderness'),
        ...decodeAreas(base?.parks, 'park'),
      ]),
      boundaries: collection([
        ...decodeLines(base?.border, 'border'),
        ...decodeLines(base?.tribal, 'tribal'),
      ]),
      places: collection(
        (base?.places ?? []).map((p) =>
          pointFeature(p.lng, p.lat, { name: p.name, kind: p.kind, rank: p.rank, major: p.major ?? false }),
        ),
      ),
      peaks: collection(
        (base?.peaks ?? []).map((p) =>
          pointFeature(p.lng, p.lat, { name: p.name, ele: p.ele, rank: p.rank }),
        ),
      ),
    },
    landAt: landLookup(landPolygons),
  };
}
