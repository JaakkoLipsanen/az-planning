import type { Alternative, AlternativeGroup, TrackLine } from '#shared/bundle.ts';
import { elevationGain, simplifyIndices } from '#shared/geo.ts';
import { encodeIntegers, encodePolyline } from '#shared/polyline.ts';

import type { Trip, TrackPoint } from '../config/load.ts';
import type { ElevationModel } from '../geo/elevation.ts';
import { lengthM, lngLats, sliceTrack } from '../route/stitch.ts';

const SOURCE_TOLERANCE_M = 6;
const ALTERNATIVE_TOLERANCE_M = 8;
const CLIMB_THRESHOLD_M = 5;

function trackLine(
  id: string,
  name: string,
  color: string,
  points: TrackPoint[],
  dem: ElevationModel,
  toleranceM: number,
): TrackLine {
  const coords = lngLats(points);
  const kept = simplifyIndices(coords, toleranceM);
  const elevations = dem.fill(points);
  return {
    id,
    name,
    color,
    km: Math.round(lengthM(points) / 100) / 10,
    climbM: Math.round(elevationGain(elevations, CLIMB_THRESHOLD_M)),
    line: encodePolyline(kept.map((i) => coords[i])),
    elevations: encodeIntegers(kept.map((i) => elevations[i])),
  };
}

export function buildSourceLines(trip: Trip, dem: ElevationModel): TrackLine[] {
  return Object.entries(trip.config.tracks).flatMap(([key, track]) =>
    track.show
      ? [
          trackLine(
            key,
            track.show.name,
            track.show.color,
            sliceTrack(trip, { track: key, reverse: false }),
            dem,
            SOURCE_TOLERANCE_M,
          ),
        ]
      : [],
  );
}

export function alternativePoints(trip: Trip): TrackPoint[][] {
  return trip.config.alternatives.flatMap((group) => group.items.map((alt) => sliceTrack(trip, alt)));
}

export function buildAlternatives(trip: Trip, dem: ElevationModel): AlternativeGroup[] {
  return trip.config.alternatives.map((group) => ({
    name: group.group,
    items: group.items.map((alt): Alternative => ({
      ...trackLine(alt.id, alt.name, alt.color, sliceTrack(trip, alt), dem, ALTERNATIVE_TOLERANCE_M),
      note: alt.note,
      style: alt.style,
    })),
  }));
}
