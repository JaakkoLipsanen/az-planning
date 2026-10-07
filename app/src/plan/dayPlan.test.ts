import { describe, expect, it } from 'vitest';

import type { Poi } from '#shared/bundle.ts';

import { KM_PER_DEGREE, testBundle as bundle } from '../testing/testBundle.ts';
import { buildTripModel } from '../trip/model.ts';
import { computePlan, dayAtKm, overnightCandidates } from './dayPlan.ts';

function camp(km: number, osm = false): Poi {
  return {
    name: `Camp ${km}`,
    category: 'camp',
    lat: 30 + km / KM_PER_DEGREE,
    lng: -110,
    source: 'test',
    km,
    osm,
  };
}

describe('computePlan', () => {
  it('splits the route into days of equal moving time', () => {
    const model = buildTripModel(bundle());
    const plan = computePlan(model, overnightCandidates(model), 4);
    expect(plan.days.map((d) => Math.round(d.km))).toEqual([25, 25, 25, 25]);
    expect(plan.nights.every((n) => !n.snapped)).toBe(true);
    expect(plan.days[0].from).toBe('Start');
    expect(plan.days[3].to).toBe('Finish');
  });

  it('moves a night to a campground within the snapping window', () => {
    const model = buildTripModel(bundle([camp(27), camp(60)]));
    const plan = computePlan(model, overnightCandidates(model), 4);
    expect(plan.nights[0]).toMatchObject({ km: 27, snapped: true, name: 'Camp 27' });
    expect(plan.nights[1].snapped).toBe(false);
  });

  it('prefers route-file stops over OpenStreetMap ones', () => {
    const model = buildTripModel(bundle([camp(24, true), camp(27.5)]));
    const plan = computePlan(model, overnightCandidates(model), 4);
    expect(plan.nights[0].km).toBe(27.5);
  });

  it('finds the day of a km', () => {
    const model = buildTripModel(bundle());
    const plan = computePlan(model, [], 4);
    expect(dayAtKm(plan, 10).number).toBe(1);
    expect(dayAtKm(plan, 60).number).toBe(3);
    expect(dayAtKm(plan, 100).number).toBe(4);
  });
});
