import { describe, expect, it } from 'vitest';

import { tripCalendar } from '../plan/calendar.ts';
import { computePlan, overnightCandidates } from '../plan/dayPlan.ts';
import { testBundle } from '../testing/testBundle.ts';
import { testClimate } from '../testing/testClimate.ts';
import { buildTripModel } from '../trip/model.ts';
import { dayConditions } from './conditions.ts';
import { LAPSE_C_PER_KM, NIGHT_LAPSE_C_PER_KM } from './field.ts';

describe('dayConditions', () => {
  const bundle = { ...testBundle(), timezone: 'America/Phoenix' };
  bundle.climate = testClimate(
    [30, 30.5, 31].flatMap((lat) => [-110.625, -110, -109.375].map((lng) => ({ lat, lng, ele: 0 }))),
  );
  const model = buildTripModel(bundle);
  const plan = computePlan(model, overnightCandidates(model), 4);
  const conditions = dayConditions(model, plan, tripCalendar('2026-12-30', 4, []), {
    startTime: null,
    breakPercent: 25,
  });

  it('dates the days from the start date', () => {
    expect(conditions.map((c) => c.date)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });

  it('skips rest days', () => {
    const dates = dayConditions(model, plan, tripCalendar('2026-12-30', 4, [2]), {
      startTime: null,
      breakPercent: 25,
    }).map((c) => c.date);
    expect(dates).toEqual(['2026-12-30', '2026-12-31', '2027-01-02', '2027-01-03']);
  });

  it('starts at sunrise and adds the breaks to the moving time', () => {
    const { ride, morning } = conditions[0];
    expect(ride?.start).toBe(morning.sunrise);
    expect(((ride?.end ?? 0) - (ride?.start ?? 0)) / 3_600_000).toBeCloseTo(2.5 * 1.25, 5);
    expect(ride?.darkKm).toBeNull();
  });

  it('finds where a long day runs into the dark', () => {
    const late = dayConditions(model, plan, tripCalendar('2026-12-30', 4, []), {
      startTime: '14:00',
      breakPercent: 100,
    })[0].ride;
    expect(late?.darkKm).toBeGreaterThan(0);
    expect(late?.darkKm).toBeLessThan(25);
  });

  it('describes the moon for every night but the last', () => {
    expect(conditions.slice(0, 3).every((c) => c.moon !== null)).toBe(true);
    expect(conditions[3].moon).toBeNull();
  });

  it('gives sun times in order', () => {
    const { morning, evening } = conditions[0];
    expect(morning.dawn).toBeLessThan(morning.sunrise ?? 0);
    expect(evening.sunset).toBeLessThan(evening.dusk ?? 0);
  });

  it('gives typical weather adjusted to the route elevation', () => {
    const weather = conditions[0].weather;
    const drop = (LAPSE_C_PER_KM * 500) / 1000;
    const nightDrop = (NIGHT_LAPSE_C_PER_KM * 500) / 1000;
    expect(weather?.highs[0]).toBeCloseTo(20 - drop, 5);
    expect(weather?.nightLow).toBeCloseTo(5 - nightDrop, 5);
    expect(weather).toMatchObject({ wet: 10, clear: 50, partly: 30, cloudy: 20 });
    expect(weather?.coldNight).toBeCloseTo(0 - nightDrop, 5);
    expect(weather?.hotDay).toBeCloseTo(25 - drop, 5);
  });

  it('turns a north wind into a headwind on a route north', () => {
    const wind = conditions[0].weather?.wind;
    expect(wind?.kmh).toBeCloseTo(8, 5);
    expect(wind?.tailKmh).toBeCloseTo(-5, 1);
    expect(wind?.from).toBeCloseTo(0, 5);
  });
});
