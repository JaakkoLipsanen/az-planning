import type { TripStats } from '#shared/bundle.ts';
import { GPX_SYMBOLS, writeGpx, type GpxWaypoint } from '#shared/gpx.ts';

import type { Trip } from '../config/load.ts';
import type { PoiCandidate } from '../layers/pois.ts';
import type { Route } from '../route/stitch.ts';

export interface RouteGpx {
  full: { file: string; text: string };
  sections: { file: string; text: string };
}

function waypoints(pois: readonly PoiCandidate[], maxDistanceM: number): GpxWaypoint[] {
  return pois
    .filter((p) => !p.osm && p.km !== undefined && p.distanceM <= maxDistanceM)
    .toSorted((a, b) => (a.km ?? 0) - (b.km ?? 0))
    .map((p) => ({
      lat: p.lat,
      lng: p.lng,
      name: p.name,
      description: `${p.description ? `${p.description} ` : ''}[${p.source}; route km ${Math.round(p.km ?? 0)}]`,
      symbol: GPX_SYMBOLS[p.category],
      type: p.category,
    }));
}

/** The whole route as one track (best for GPS units) and as one track per section. */
export function buildRouteGpx(
  { slug, config }: Trip,
  route: Route,
  pois: readonly PoiCandidate[],
  stats: TripStats,
): RouteGpx {
  const { baseName = slug, name = config.title, creator } = config.gpx;
  const description = config.gpx.description
    ?.replace('{distanceKm}', String(Math.round(stats.distanceKm)))
    .replace('{climbM}', String(Math.round(stats.climbM)));
  const wpts = waypoints(pois, config.pois?.gpxMaxDistanceM ?? 400);
  return {
    full: {
      file: `${baseName}_full.gpx`,
      text: writeGpx({
        name,
        description,
        creator,
        waypoints: wpts,
        tracks: [{ name, points: route.points.map((p) => p.text) }],
      }),
    },
    sections: {
      file: `${baseName}_by_section.gpx`,
      text: writeGpx({
        name: `${name} (by section)`,
        description,
        creator,
        waypoints: wpts,
        tracks: route.sections.map((s) => ({
          name: `${s.config.id} ${s.config.name}`,
          points: s.points.map((p) => p.text),
        })),
      }),
    },
  };
}
