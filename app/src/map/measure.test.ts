import { describe, expect, it } from 'vitest';

import { KM_PER_DEGREE, testBundle } from '../testing/testBundle.ts';
import { buildTripModel } from '../trip/model.ts';
import { formatKm, measure } from './measure.ts';

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

  it('formats short and long distances', () => {
    expect(formatKm(0.4321)).toBe('432 m');
    expect(formatKm(4.321)).toBe('4.32 km');
    expect(formatKm(43.21)).toBe('43.2 km');
  });
});
