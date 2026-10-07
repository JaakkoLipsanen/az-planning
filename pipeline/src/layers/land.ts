import type { Geometry, Polygon, Position } from 'geojson';

import type { LandCategory, LandLayer } from '#shared/bundle.ts';
import { localProjection, simplify, type Bounds, type LngLat } from '#shared/geo.ts';
import { encodePolyline } from '#shared/polyline.ts';

import {
  buffer,
  fromGeoJson,
  intersection,
  makeValid,
  polygonsOf,
  simplifyShape,
  type Shape,
} from '../geo/topology.ts';
import { log } from '../log.ts';
import { cachedJson } from '../net/http.ts';

const SMA_QUERY =
  'https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/1/query';
const SOURCE = 'BLM National Surface Management Agency (limited scale)';
const MIN_AREA_M2 = 20_000;
const MIN_HOLE_LENGTH_M = 150;

const CATEGORIES: Omit<LandCategory, 'areaKm2'>[] = [
  { id: 'blm', label: 'BLM (Bureau of Land Management)', color: '#f2d35b' },
  { id: 'usfs', label: 'National Forest (USFS)', color: '#86c47f' },
  { id: 'nps', label: 'National Park / Monument (NPS)', color: '#b48fd0' },
  { id: 'fws', label: 'National Wildlife Refuge (FWS)', color: '#f0a04a' },
  { id: 'tribal', label: 'Tribal land (BIA trust)', color: '#e2b27a' },
  { id: 'dod', label: 'Military (DOD, USAF, Army)', color: '#e07070' },
  { id: 'fed_other', label: 'Other federal (Reclamation, FAA, ...)', color: '#9fb3c8' },
  { id: 'state', label: 'State Trust land', color: '#6fb0e6' },
  { id: 'local', label: 'County / city / local', color: '#bdbdbd' },
  { id: 'private', label: 'Private or undetermined', color: '#f4f1ea' },
];

const AGENCIES: Record<string, string> = {
  BLM: 'blm',
  USFS: 'usfs',
  NPS: 'nps',
  FWS: 'fws',
  BIA: 'tribal',
  USAF: 'dod',
  ARMY: 'dod',
  DOD: 'dod',
  NAVY: 'dod',
  USMC: 'dod',
  USBR: 'fed_other',
  USACE: 'fed_other',
  OTHFE: 'fed_other',
  FAA: 'fed_other',
  BOP: 'fed_other',
  DOE: 'fed_other',
  ST: 'state',
  LG: 'local',
  PVT: 'private',
  UND: 'private',
};

interface SmaFeature {
  properties: { ADMIN_AGENCY_CODE?: string | null };
  geometry: Geometry | null;
}

function projectGeometry(g: Geometry, f: (p: Position) => Position): Geometry {
  switch (g.type) {
    case 'Polygon':
      return { type: 'Polygon', coordinates: g.coordinates.map((ring) => ring.map(f)) };
    case 'MultiPolygon':
      return {
        type: 'MultiPolygon',
        coordinates: g.coordinates.map((poly) => poly.map((ring) => ring.map(f))),
      };
    case 'MultiLineString':
      return { type: 'MultiLineString', coordinates: g.coordinates.map((line) => line.map(f)) };
    default:
      throw new Error(`unsupported geometry ${g.type}`);
  }
}

function ringArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 1; i < ring.length; i++) sum += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  return Math.abs(sum) / 2;
}

function ringLength(ring: Position[]): number {
  let sum = 0;
  for (let i = 1; i < ring.length; i++)
    sum += Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]);
  return sum;
}

function polygonArea(p: Polygon): number {
  const [outer, ...holes] = p.coordinates;
  return ringArea(outer) - holes.reduce((sum, h) => sum + ringArea(h), 0);
}

interface SmaResponse {
  features: SmaFeature[];
  exceededTransferLimit?: boolean;
  properties?: { exceededTransferLimit?: boolean };
}

function rejectTruncated(data: Buffer): void {
  const result = JSON.parse(data.toString('utf8')) as SmaResponse;
  if (result.exceededTransferLimit || result.properties?.exceededTransferLimit)
    throw new Error('the BLM land query hit the server limit; use a smaller region');
}

async function fetchSma(region: Bounds): Promise<SmaFeature[]> {
  const params = new URLSearchParams({
    where: '1=1',
    geometry: region.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'ADMIN_AGENCY_CODE',
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '5',
    maxAllowableOffset: '0.0002',
    f: 'geojson',
  });
  const result = await cachedJson<SmaResponse>(`${SMA_QUERY}?${params.toString()}`, {
    validate: rejectTruncated,
  });
  return result.features;
}

function clipToCorridor(shape: Shape, corridor: Shape): Shape | null {
  try {
    return intersection(makeValid(shape), corridor);
  } catch {
    try {
      return intersection(buffer(shape, 0), corridor);
    } catch (error) {
      log.warn(`skipped a land polygon: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}

/** US land management (BLM SMA) clipped to a corridor around the given lines. */
export async function buildLandLayer(
  region: Bounds,
  lines: readonly LngLat[][],
  corridorKm: number,
  note?: string,
): Promise<LandLayer> {
  const project = localProjection((region[1] + region[3]) / 2);
  const forward = ([lng, lat]: Position): Position => project(lng, lat);
  const inverse = ([x, y]: Position): LngLat => project.inverse(x, y);
  const corridorLines = lines.filter((l) => l.length >= 2).map((l) => simplify(l, 50));
  const corridor = simplifyShape(
    buffer(
      fromGeoJson(projectGeometry({ type: 'MultiLineString', coordinates: corridorLines }, forward)),
      corridorKm * 1000,
    ),
    200,
  );

  const features: LandLayer['features'] = [];
  const areaM2 = new Map<string, number>();
  const unknown = new Set<string>();
  for (const f of await fetchSma(region)) {
    if (!f.geometry) continue;
    const code = f.properties.ADMIN_AGENCY_CODE ?? 'UND';
    const category = AGENCIES[code] ?? 'fed_other';
    if (!AGENCIES[code]) unknown.add(code);
    const clipped = clipToCorridor(fromGeoJson(projectGeometry(f.geometry, forward)), corridor);
    if (!clipped) continue;
    for (const polygon of polygonsOf(simplifyShape(clipped, 20))) {
      const area = polygonArea(polygon);
      if (area < MIN_AREA_M2) continue;
      const [outer, ...holes] = polygon.coordinates;
      const rings = [outer, ...holes.filter((h) => ringLength(h) >= MIN_HOLE_LENGTH_M)];
      features.push({ category, rings: rings.map((ring) => encodePolyline(ring.map(inverse))) });
      areaM2.set(category, (areaM2.get(category) ?? 0) + area);
    }
  }
  if (unknown.size > 0)
    log.warn(`unmapped land agencies (shown as other federal): ${[...unknown].join(', ')}`);
  return {
    source: `${SOURCE}, clipped to ${corridorKm} km around the routes`,
    note,
    categories: CATEGORIES.map((c) => ({ ...c, areaKm2: Math.round((areaM2.get(c.id) ?? 0) / 1e6) })),
    features,
  };
}
