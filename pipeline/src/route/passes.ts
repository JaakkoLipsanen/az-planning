import { haversineM, round } from '#shared/geo.ts';

import type { PointIndex } from '../geo/spatial.ts';
import type { Route } from './stitch.ts';

/** Passes closer together along the route than this count as one. */
const MIN_PASS_GAP_KM = 2;

/** Route km of every pass within radiusM: the nearest point of each stretch of the route that comes close. */
export function passKms(
  route: Route,
  index: PointIndex,
  lat: number,
  lng: number,
  radiusM: number,
): number[] {
  const passes: { km: number; distanceM: number; endKm: number; end: number }[] = [];
  for (const i of index.within(lat, lng, radiusM)) {
    const km = route.cumM[i] / 1000;
    const distanceM = haversineM(lat, lng, route.points[i].lat, route.points[i].lng);
    const last = passes.at(-1);
    if (last && (i === last.end + 1 || km - last.endKm < MIN_PASS_GAP_KM)) {
      if (distanceM < last.distanceM) Object.assign(last, { km, distanceM });
      Object.assign(last, { endKm: km, end: i });
    } else {
      passes.push({ km, distanceM, endKm: km, end: i });
    }
  }
  return passes.map((p) => round(p.km, 1));
}
