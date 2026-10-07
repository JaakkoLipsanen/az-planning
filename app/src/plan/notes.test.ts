import { describe, expect, it } from 'vitest';

import type { Notice, Poi } from '#shared/bundle.ts';

import { KM_PER_DEGREE, testBundle } from '../testing/testBundle.ts';
import { buildTripModel } from '../trip/model.ts';
import { computePlan } from './dayPlan.ts';
import { closedText, dayNotes, noticeWhen } from './notes.ts';

const winter: Notice = { text: 'Road not maintained', kms: [[30, 40]], months: [11, 12, 1, 2, 3] };
const weekdays: Notice = { text: 'Trail closed', kms: [[60, 60]], weekdays: [1, 2, 3, 4], to: '2026-12-31' };

function shop(km: number, hours: string): Poi {
  return {
    name: `Shop ${km}`,
    category: 'resupply',
    lat: 30 + km / KM_PER_DEGREE,
    lng: -110,
    source: 'test',
    km,
    hours,
  };
}

describe('dayNotes', () => {
  const model = buildTripModel({
    ...testBundle([shop(10, 'Mo-Sa 08:00-18:00'), shop(12, '24/7')]),
    notices: [winter, weekdays],
  });
  const plan = computePlan(model, [], 4);

  it('shows notices for the parts of the route a day covers on matching dates', () => {
    expect(dayNotes(model, plan.days[1], '2026-12-07').notices).toEqual(['Road not maintained']);
    expect(dayNotes(model, plan.days[1], '2026-07-07').notices).toEqual([]);
    expect(dayNotes(model, plan.days[2], '2026-12-07').notices).toEqual(['Trail closed']);
    expect(dayNotes(model, plan.days[2], '2026-12-06').notices).toEqual([]);
    expect(dayNotes(model, plan.days[2], '2027-01-04').notices).toEqual([]);
  });

  it('says when notices apply when there is no date', () => {
    expect(dayNotes(model, plan.days[1], null).notices).toEqual(['Nov–Mar: Road not maintained']);
    expect(noticeWhen(weekdays)).toBe('Mon–Thu until Thu 31 Dec');
    expect(noticeWhen({ ...weekdays, weekdays: [0, 6] })).toBe('Sat, Sun until Thu 31 Dec');
  });

  it('lists the opening hours of shops on the planned weekday', () => {
    const sunday = dayNotes(model, plan.days[0], '2026-12-06');
    expect(sunday.opening.map((o) => o.hours)).toEqual([null, '24 h']);
    expect(closedText(sunday.opening, '2026-12-06')).toBe('Closed on Sundays: Shop 10');
  });
});
