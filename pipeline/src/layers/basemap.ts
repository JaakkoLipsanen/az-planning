import type { Geometry, Position } from 'geojson';

import type { BasemapOverlay, Place, PlaceKind } from '#shared/bundle.ts';
import { round, simplify, type Bounds, type LngLat } from '#shared/geo.ts';
import { encodePolyline } from '#shared/polyline.ts';
import { tilesInBounds } from '#shared/tiles.ts';

import { loadVectorTiles } from '../net/openfreemap.ts';
import { overpass } from '../net/overpass.ts';

const ZOOM = 11;
const LAYERS = ['transportation', 'waterway', 'water', 'boundary', 'park', 'place', 'mountain_peak'];
const PLACE_KINDS: Record<string, PlaceKind> = {
  city: 'city',
  town: 'town',
  village: 'village',
  hamlet: 'hamlet',
  aboriginal_lands: 'area',
};
const WATER_CLASSES = new Set([undefined, 'lake', 'river', 'pond', 'reservoir', 'dock']);

type LineBucket = Exclude<keyof BasemapOverlay, 'places' | 'peaks'>;

/** The app ships map glyphs for U+0000-01FF only, so typographic punctuation is replaced by ASCII. */
function labelText(name: string): string {
  return name
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');
}

function lines(g: Geometry): Position[][] {
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  return [];
}

function outerRings(g: Geometry): Position[][] {
  if (g.type === 'Polygon') return g.coordinates.slice(0, 1);
  if (g.type === 'MultiPolygon') return g.coordinates.map((p) => p[0]);
  return [];
}

function points(g: Geometry): Position[] {
  if (g.type === 'Point') return [g.coordinates];
  if (g.type === 'MultiPoint') return g.coordinates;
  return [];
}

function centroid(coords: readonly { lat: number; lon: number }[]): [lat: number, lng: number] {
  const lat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
  const lng = coords.reduce((s, c) => s + c.lon, 0) / coords.length;
  return [lat, lng];
}

async function addTribalLands(overlay: BasemapOverlay, region: Bounds): Promise<void> {
  const [w, s, e, n] = region;
  const relations = await overpass(
    `[out:json][timeout:240];relation["boundary"="aboriginal_lands"](${s},${w},${n},${e});out geom;`,
  );
  const names = new Set(overlay.places.map((p) => p.name));
  for (const rel of relations) {
    const outer = (rel.members ?? []).filter((m) => m.geometry && (m.role === 'outer' || m.role === ''));
    for (const m of outer) {
      const coords = (m.geometry ?? []).map((g): LngLat => [g.lon, g.lat]);
      if (coords.length >= 2) overlay.tribal.push(encodePolyline(simplify(coords, 60)));
    }
    const name = rel.tags?.name && labelText(rel.tags.name);
    const all = outer.flatMap((m) => m.geometry ?? []);
    if (name && !names.has(name) && all.length > 0) {
      const [lat, lng] = centroid(all);
      overlay.places.push({ name, kind: 'area', lat: round(lat, 4), lng: round(lng, 4), rank: 0 });
      names.add(name);
    }
  }
}

/** Roads, water, protected areas, places and peaks for the trip region from OpenFreeMap z11 tiles. */
export async function buildBasemapOverlay(
  region: Bounds,
  majorPlaces: readonly string[],
): Promise<BasemapOverlay> {
  const overlay: BasemapOverlay = {
    roadsMajor: [],
    roadsMinor: [],
    rail: [],
    rivers: [],
    lakes: [],
    forests: [],
    wilderness: [],
    parks: [],
    border: [],
    tribal: [],
    places: [],
    peaks: [],
  };
  const add = (bucket: LineBucket, coords: Position[], toleranceM: number): void => {
    if (coords.length < 2) return;
    overlay[bucket].push(encodePolyline(simplify(coords as LngLat[], toleranceM)));
  };
  const seenPlaces = new Set<string>();
  const seenPeaks = new Set<string>();
  const major = new Set(majorPlaces);

  for (const features of await loadVectorTiles(tilesInBounds(region, ZOOM), LAYERS)) {
    for (const { layer, properties, geometry: g } of features) {
      const p = properties ?? {};
      const cls = p.class as string | undefined;
      if (layer === 'transportation') {
        const bucket: LineBucket | null =
          cls === 'motorway' || cls === 'trunk' || cls === 'primary'
            ? 'roadsMajor'
            : cls === 'secondary' || cls === 'tertiary'
              ? 'roadsMinor'
              : cls === 'rail' && p.service === undefined
                ? 'rail'
                : null;
        if (bucket) for (const line of lines(g)) add(bucket, line, 12);
      } else if (layer === 'waterway' && (cls === 'river' || cls === 'canal')) {
        for (const line of lines(g)) add('rivers', line, 12);
      } else if (layer === 'water' && WATER_CLASSES.has(cls)) {
        for (const ring of outerRings(g)) add('lakes', ring, 15);
      } else if (layer === 'boundary' && p.admin_level === 2) {
        for (const line of lines(g)) add('border', line, 30);
      } else if (layer === 'park') {
        const bucket: LineBucket | null =
          cls === 'wilderness_preserve'
            ? 'wilderness'
            : cls === 'national_park'
              ? 'parks'
              : cls === 'forest_reserve'
                ? 'forests'
                : null;
        if (bucket) for (const ring of outerRings(g)) add(bucket, ring, bucket === 'forests' ? 40 : 30);
      } else if (layer === 'place') {
        const raw = (p['name:en'] ?? p.name) as string | undefined;
        const name = raw && labelText(raw);
        const kind = cls ? PLACE_KINDS[cls] : undefined;
        if (!name || !kind || seenPlaces.has(`${name}|${kind}`)) continue;
        seenPlaces.add(`${name}|${kind}`);
        for (const [lng, lat] of points(g)) {
          const place: Place = {
            name,
            kind,
            lat: round(lat, 4),
            lng: round(lng, 4),
            rank: Number(p.rank ?? 0),
          };
          if (major.has(name)) place.major = true;
          overlay.places.push(place);
        }
      } else if (layer === 'mountain_peak') {
        const raw = (p['name:en'] ?? p.name) as string | undefined;
        const name = raw && labelText(raw);
        const ele = Number(p.ele);
        if (!name || !ele || seenPeaks.has(name)) continue;
        seenPeaks.add(name);
        for (const [lng, lat] of points(g)) {
          overlay.peaks.push({
            name,
            lat: round(lat, 4),
            lng: round(lng, 4),
            ele: Math.round(ele),
            rank: Number(p.rank ?? 3),
          });
        }
      }
    }
  }
  await addTribalLands(overlay, region);
  return overlay;
}
