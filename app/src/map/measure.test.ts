import { describe, expect, it } from 'vitest';

import { KM_PER_DEGREE, testBundle } from '../testing/testBundle.ts';
import { buildTripModel } from '../trip/model.ts';
import { formatKm, measure, routeClimb } from './measure.ts';

describe('measure', () => {
  const model = buildTripModel(testBundle());

  it('gives straight distances, and the distance along the route between points on it', () => {
    const m = measure(model, [
      [-110, 30 + 10 / KM_PER_DEGREE],
      [-110, 30 + 25 / KM_PER_DEGREE],
      [-109.9, 30 + 25 / KM_PER_DEGREE],
    ]);
    expect(m.segments[0].km).toBeCloseTo(15, 0);
    expect(m.segments[0].routeKm).toBeCloseTo(15, 0);
    expect(m.segments[1].routeKm).toBeNull();
    expect(m.totalKm).toBeCloseTo(m.segments[0].km + m.segments[1].km, 9);
  });

  it('gives the climb along the route in either direction', () => {
    const climbing = testBundle();
    climbing.profile.ele = climbing.profile.km.map((k) => 500 + k * 10);
    climbing.profile.climbM = climbing.profile.km.map((k) => k * 10);
    const hill = buildTripModel(climbing);
    expect(routeClimb(hill, 10, 30)).toBeCloseTo(200, 5);
    expect(routeClimb(hill, 30, 10)).toBeCloseTo(0, 5);
    const m = measure(hill, [
      [-110, 30 + 10 / KM_PER_DEGREE],
      [-110, 30 + 25 / KM_PER_DEGREE],
    ]);
    expect(m.segments[0].climbM).toBeCloseTo(150, 0);
    expect(m.segments[0].hours).toBeCloseTo(1.5, 1);
  });

  it('formats short and long distances', () => {
    expect(formatKm(0.4321)).toBe('432 m');
    expect(formatKm(4.321)).toBe('4.32 km');
    expect(formatKm(43.21)).toBe('43.2 km');
  });
});
