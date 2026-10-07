import type { FeatureCollection, LineString, Point } from 'geojson';

import { formatHours, formatInt } from '../lib/format.ts';
import type { DayPlan } from '../plan/dayPlan.ts';

export interface DayFeatures {
  lines: FeatureCollection<LineString>;
  labels: FeatureCollection<Point>;
  nights: FeatureCollection<Point>;
}

export function dayFeatures(plan: DayPlan, longDayHours: number): DayFeatures {
  return {
    lines: {
      type: 'FeatureCollection',
      features: plan.days.map((d) => ({
        type: 'Feature',
        properties: { day: d.number },
        geometry: { type: 'LineString', coordinates: d.coords.length > 1 ? d.coords : [d.mid, d.mid] },
      })),
    },
    labels: {
      type: 'FeatureCollection',
      features: plan.days.map((d) => ({
        type: 'Feature',
        properties: {
          day: d.number,
          title: `Day ${d.number}  `,
          stats: `${Math.round(d.km)} km · +${formatInt(d.climbM)} m · `,
          time: formatHours(d.hours),
          long: d.hours > longDayHours,
          trail: `trail ${d.surfacePct[0]}%`,
          dirt: `dirt ${d.surfacePct[1]}%`,
          paved: `paved ${d.surfacePct[2]}%`,
        },
        geometry: { type: 'Point', coordinates: d.mid },
      })),
    },
    nights: {
      type: 'FeatureCollection',
      features: plan.nights.map((n, index) => ({
        type: 'Feature',
        properties: { index, label: String(n.number) },
        geometry: { type: 'Point', coordinates: [n.lng, n.lat] },
      })),
    },
  };
}
