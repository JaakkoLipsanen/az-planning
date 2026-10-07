import { describe, expect, it } from 'vitest';

import { computePlan, overnightCandidates } from '../plan/dayPlan.ts';
import { testBundle } from '../testing/testBundle.ts';
import { testClimate } from '../testing/testClimate.ts';
import { buildTripModel } from '../trip/model.ts';
import { dayConditions } from './conditions.ts';
import { LAPSE_C_PER_KM } from './field.ts';

describe('dayConditions', () => {
  const bundle = { ...testBundle(), timezone: 'America/Phoenix' };
  bundle.climate = testClimate(
    [30, 30.5, 31].flatMap((lat) => [-110.625, -110, -109.375].map((lng) => ({ lat, lng, ele: 0 }))),
  );
  const model = buildTripModel(bundle);
  const plan = computePlan(model, overnightCandidates(model), 4);
  const conditions = dayConditions(model, plan, '2026-12-30');

  it('dates the days from the start date', () => {
    expect(conditions.map((c) => c.date)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });

  it('gives sun times in order', () => {
    const { morning, evening } = conditions[0];
    expect(morning.dawn).toBeLessThan(morning.sunrise ?? 0);
    expect(evening.sunset).toBeLessThan(evening.dusk ?? 0);
  });

  it('gives typical weather adjusted to the route elevation', () => {
    const weather = conditions[0].weather;
    const drop = (LAPSE_C_PER_KM * 500) / 1000;
    expect(weather?.highs[0]).toBeCloseTo(20 - drop, 5);
    expect(weather?.nightLow).toBeCloseTo(5 - drop, 5);
    expect(weather).toMatchObject({ wet: 10, clear: 50, partly: 30, cloudy: 20 });
  });
});
