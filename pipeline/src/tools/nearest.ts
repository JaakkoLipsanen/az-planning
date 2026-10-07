import { haversineM } from '#shared/geo.ts';

import { loadTrip } from '../config/load.ts';
import { log } from '../log.ts';
import { lengthM } from '../route/stitch.ts';

const MIN_INDEX_GAP = 200;

/** Prints the track points closest to a location, one per pass of the track (loops and out-and-backs pass twice). */
export async function printNearest(
  slug: string,
  track: string,
  lat: number,
  lon: number,
  count: number,
): Promise<void> {
  const trip = await loadTrip(slug);
  const points = trip.tracks.get(track);
  if (!points) throw new Error(`unknown track "${track}"; tracks: ${[...trip.tracks.keys()].join(', ')}`);
  const ranked = points
    .map((p, index) => ({ index, distanceM: haversineM(lat, lon, p.lat, p.lng) }))
    .toSorted((a, b) => a.distanceM - b.distanceM);
  const picked: typeof ranked = [];
  for (const candidate of ranked) {
    if (picked.length >= count) break;
    if (picked.every((p) => Math.abs(p.index - candidate.index) > MIN_INDEX_GAP)) picked.push(candidate);
  }
  log.info(`track "${track}": ${points.length} points`);
  for (const { index, distanceM } of picked) {
    const p = points[index];
    const km = lengthM(points.slice(0, index + 1)) / 1000;
    log.info(
      `index ${index}  ${distanceM.toFixed(0)} m away  track km ${km.toFixed(2)}  (${p.text.lat}, ${p.text.lon}, ele ${p.text.ele || '-'})`,
    );
  }
}
