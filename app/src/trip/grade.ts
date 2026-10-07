import type { Feature, FeatureCollection, LineString } from 'geojson';

import type { LngLat } from '#shared/geo.ts';

import type { TripModel } from './model.ts';
import type { RouteProfile } from './profile.ts';

/** Samples on each side of the grade used for colouring; shorter windows make a striped route. */
const GRADE_HALF_WINDOW = 4;

/** Steepness classes for colouring the route, climbs and descents alike. */
export const GRADE_CLASSES = [
  { below: 3, label: 'under 3 %', color: '#6aa84f' },
  { below: 6, label: '3–6 %', color: '#e6b822' },
  { below: 9, label: '6–9 %', color: '#f08a24' },
  { below: 12, label: '9–12 %', color: '#d93a2b' },
  { below: Infinity, label: '12 % and steeper', color: '#7b2a8c' },
] as const;

/** The grade class of every profile sample. */
export function gradeClasses(profile: RouteProfile): Uint8Array {
  const out = new Uint8Array(profile.length);
  for (let i = 0; i < profile.length; i++) {
    const grade = Math.abs(profile.gradeAt(i, GRADE_HALF_WINDOW));
    out[i] = GRADE_CLASSES.findIndex((c) => grade < c.below);
  }
  return out;
}

/** The final route as lines of one grade class and section each, for the map. */
export function gradeFeatures(model: TripModel, classes: Uint8Array): FeatureCollection<LineString> {
  const { profile, bundle } = model;
  const { lng, lat, section } = profile.data;
  const features: Feature<LineString>[] = [];
  let start = 0;
  for (let i = 1; i <= profile.length; i++) {
    if (i < profile.length && classes[i] === classes[start] && section[i] === section[start]) continue;
    const coordinates: LngLat[] = [];
    for (let k = start; k <= Math.min(i, profile.length - 1); k++) coordinates.push([lng[k], lat[k]]);
    if (coordinates.length > 1) {
      features.push({
        type: 'Feature',
        properties: {
          id: bundle.sections[section[start]]?.id ?? '',
          color: GRADE_CLASSES[classes[start]].color,
        },
        geometry: { type: 'LineString', coordinates },
      });
    }
    start = i;
  }
  return { type: 'FeatureCollection', features };
}
