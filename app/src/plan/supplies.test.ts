import { describe, expect, it } from 'vitest';

import type { Poi } from '#shared/bundle.ts';

import { KM_PER_DEGREE, testBundle } from '../testing/testBundle.ts';
import { buildTripModel } from '../trip/model.ts';
import { computePlan } from './dayPlan.ts';
import {
  litresFor,
  longest,
  longestWithin,
  nextStop,
  resupplyStops,
  stretchesBetween,
  waterStops,
} from './supplies.ts';

function poi(km: number, category: Poi['category'], extra: Partial<Poi> = {}): Poi {
  return {
    name: `${category} ${km}`,
    category,
    lat: 30 + km / KM_PER_DEGREE,
    lng: -110,
    source: 'test',
    km,
    ...extra,
  };
}

describe('supplies', () => {
  const model = buildTripModel(
    testBundle([
      poi(20, 'water', { water: 'tap' }),
      poi(45, 'water', { water: 'natural' }),
      poi(60, 'resupply'),
      poi(80, 'water', { water: 'tap', osm: true }),
    ]),
  );
  const plan = computePlan(model, [], 4);

  it('counts shops as water and leaves out natural and OpenStreetMap sources unless asked', () => {
    expect(waterStops(model, { natural: false, osm: false }).map((s) => s.km)).toEqual([20, 60]);
    expect(waterStops(model, { natural: true, osm: true }).map((s) => s.km)).toEqual([20, 45, 60, 80]);
    expect(resupplyStops(model, { natural: true, osm: true }).map((s) => s.km)).toEqual([60]);
  });

  it('measures the stretches between sources from start to finish', () => {
    const stretches = stretchesBetween(model, plan, null, waterStops(model, { natural: false, osm: false }));
    expect(stretches.map((s) => [s.fromKm, s.toKm])).toEqual([
      [0, 20],
      [20, 60],
      [60, 100],
    ]);
    expect(stretches[1]).toMatchObject({ km: 40, nights: 2 });
    expect(stretches[1].hours).toBeCloseTo(4, 5);
    expect(longest(stretches, 1)[0].fromKm).toBe(20);
    expect(longestWithin(stretches, 50, 75)).toBe(15);
    expect(nextStop(waterStops(model, { natural: false, osm: false }), 30)?.km).toBe(60);
  });

  it('estimates water for the riding time and the nights', () => {
    const [, middle] = stretchesBetween(model, plan, null, waterStops(model, { natural: false, osm: false }));
    expect(litresFor(middle)).toBeCloseTo(4 * 0.5 + 2 * 1.5, 5);
    expect(litresFor({ ...middle, highC: 30 })).toBeCloseTo(4 * 1 + 2 * 1.5, 5);
  });
});
