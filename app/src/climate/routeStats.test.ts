import { describe, expect, it } from 'vitest';

import { testBundle } from '../testing/testBundle.ts';
import { testClimate } from '../testing/testClimate.ts';
import { buildTripModel } from '../trip/model.ts';
import { percentile, routeTemperatureStats } from './routeStats.ts';

describe('percentile', () => {
  it('interpolates between sorted values', () => {
    const values = [0, 10, 20, 30, 40];
    expect(percentile(values, 0)).toBe(0);
    expect(percentile(values, 0.5)).toBe(20);
    expect(percentile(values, 0.1)).toBe(4);
    expect(percentile(values, 1)).toBe(40);
  });
});

describe('routeTemperatureStats', () => {
  const climate = testClimate(
    [30, 30.5, 31].flatMap((lat) => [-110.625, -110, -109.375].map((lng) => ({ lat, lng, ele: 0 }))),
  );

  it('summarises the route, colder where it is higher', () => {
    const bundle = { ...testBundle(), timezone: 'America/Phoenix', climate };
    bundle.profile.ele = bundle.profile.km.map((km) => (km < 50 ? 0 : 2000));
    const stats = routeTemperatureStats(buildTripModel(bundle), '2026-12-03', 15);
    if (!stats) throw new Error('no stats');
    expect(stats.max - stats.min).toBeGreaterThan(12);
    expect(stats.maxKm).toBeLessThan(50);
    expect(stats.minKm).toBeGreaterThanOrEqual(50);
    expect(stats.p10).toBeLessThanOrEqual(stats.mean);
    expect(stats.p90).toBeGreaterThanOrEqual(stats.mean);
    expect(stats.min).toBeLessThanOrEqual(stats.p10);
    expect(stats.max).toBeGreaterThanOrEqual(stats.p90);
  });

  it('counts the share of the route below freezing', () => {
    const bundle = { ...testBundle(), timezone: 'America/Phoenix', climate };
    bundle.profile.ele = bundle.profile.km.map((km) => (km < 25 ? 3000 : 0));
    const stats = routeTemperatureStats(buildTripModel(bundle), '2026-12-03', 6);
    expect(stats?.freezing).toBeCloseTo(0.25, 1);
  });

  it('is null for trips without climate data', () => {
    expect(routeTemperatureStats(buildTripModel(testBundle()), '2026-12-03', 6)).toBeNull();
  });
});
