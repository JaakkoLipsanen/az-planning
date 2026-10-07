import type { FeatureCollection, LineString, Point } from 'geojson';

import { haversineM, type LngLat } from '#shared/geo.ts';

import type { TripModel } from '../trip/model.ts';

/** Points closer than this to the final route also get the distance along it. */
const ROUTE_SNAP_M = 300;

export interface MeasureSegment {
  km: number;
  /** Distance along the final route when both ends are on it. */
  routeKm: number | null;
}

export interface Measurement {
  segments: MeasureSegment[];
  totalKm: number;
  /** Route km of each point that lies on the route. */
  routeKmAt: (number | null)[];
}

export function measure(model: TripModel, points: readonly LngLat[]): Measurement {
  const routeKmAt: (number | null)[] = [];
  for (const [lng, lat] of points) {
    const hint = routeKmAt.findLast((km) => km !== null) ?? null;
    const snap = model.profile.snap(lng, lat, hint);
    routeKmAt.push(snap.offRouteM <= ROUTE_SNAP_M ? snap.km : null);
  }
  const segments = points.slice(1).map((b, i): MeasureSegment => {
    const a = points[i];
    const [ka, kb] = [routeKmAt[i], routeKmAt[i + 1]];
    return {
      km: haversineM(a[1], a[0], b[1], b[0]) / 1000,
      routeKm: ka !== null && kb !== null ? Math.abs(kb - ka) : null,
    };
  });
  return { segments, totalKm: segments.reduce((sum, s) => sum + s.km, 0), routeKmAt };
}

export function formatKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 2 : 1)} km`;
}

/** The measured line, its numbered points and a distance label at the middle of every segment. */
export function measureFeatures(
  points: readonly LngLat[],
  m: Measurement,
): { line: FeatureCollection<LineString>; points: FeatureCollection<Point> } {
  return {
    line: {
      type: 'FeatureCollection',
      features:
        points.length > 1
          ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [...points] } }]
          : [],
    },
    points: {
      type: 'FeatureCollection',
      features: [
        ...points.map((p, i) => ({
          type: 'Feature' as const,
          properties: { kind: 'point', label: String(i + 1) },
          geometry: { type: 'Point' as const, coordinates: p },
        })),
        ...m.segments.map((s, i) => ({
          type: 'Feature' as const,
          properties: { kind: 'distance', label: formatKm(s.km) },
          geometry: {
            type: 'Point' as const,
            coordinates: [(points[i][0] + points[i + 1][0]) / 2, (points[i][1] + points[i + 1][1]) / 2],
          },
        })),
      ],
    },
  };
}
