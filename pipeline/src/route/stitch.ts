import { haversineM, type LngLat } from '#shared/geo.ts';

import type { Trip, TrackPoint } from '../config/load.ts';
import type { SectionConfig } from '../config/schema.ts';
import { log } from '../log.ts';

const MAX_GAP_M = 30;

interface Slice {
  track: string;
  range?: [number] | [number, number];
  reverse: boolean;
}

export interface RouteSection {
  config: SectionConfig;
  /** The section's points as listed in the trip, before de-duplication. */
  points: TrackPoint[];
}

/** The final route: sections joined into one point list without consecutive duplicates. */
export interface Route {
  sections: RouteSection[];
  points: TrackPoint[];
  /** Section index of each point. */
  sectionOf: Uint16Array;
  /** Cumulative great-circle distance in metres. */
  cumM: Float64Array;
}

export function sliceTrack(trip: Trip, slice: Slice): TrackPoint[] {
  const points = trip.tracks.get(slice.track);
  if (!points) throw new Error(`unknown track "${slice.track}"`);
  const [first = 0, last = points.length - 1] = slice.range ?? [];
  if (first > last || last >= points.length) {
    throw new Error(`range [${first}, ${last}] is outside track "${slice.track}" (${points.length} points)`);
  }
  const out = points.slice(first, last + 1);
  return slice.reverse ? out.toReversed() : out;
}

function samePosition(a: TrackPoint, b: TrackPoint): boolean {
  return a.text.lat === b.text.lat && a.text.lon === b.text.lon;
}

export function lngLats(points: readonly TrackPoint[]): LngLat[] {
  return points.map((p) => [p.lng, p.lat]);
}

export function distanceM(a: TrackPoint, b: TrackPoint): number {
  return haversineM(a.lat, a.lng, b.lat, b.lng);
}

export function lengthM(points: readonly TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceM(points[i - 1], points[i]);
  return total;
}

export function stitchRoute(trip: Trip): Route {
  const sections = trip.config.sections.map((config) => {
    const points = config.parts.flatMap((part) => sliceTrack(trip, part));
    if (points.length < 2) throw new Error(`section ${config.id} has fewer than 2 points`);
    return { config, points };
  });

  for (let i = 1; i < sections.length; i++) {
    const prev = sections[i - 1].points.at(-1);
    const next = sections[i].points[0];
    if (prev && next && distanceM(prev, next) > MAX_GAP_M) {
      log.warn(
        `${Math.round(distanceM(prev, next))} m gap between sections ${sections[i - 1].config.id} and ${sections[i].config.id}`,
      );
    }
  }

  const points: TrackPoint[] = [];
  const sectionOf: number[] = [];
  sections.forEach((section, index) => {
    for (const p of section.points) {
      const last = points.at(-1);
      if (last && samePosition(last, p)) continue;
      points.push(p);
      sectionOf.push(index);
    }
  });

  const cumM = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) cumM[i] = cumM[i - 1] + distanceM(points[i - 1], points[i]);
  return { sections, points, sectionOf: Uint16Array.from(sectionOf), cumM };
}
