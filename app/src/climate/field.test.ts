import { describe, expect, it } from 'vitest';

import { testClimate } from '../testing/testClimate.ts';
import { ClimateField, LAPSE_C_PER_KM, NIGHT_LAPSE_C_PER_KM, temperatureAt } from './field.ts';
import { sunTimes } from './sun.ts';
import { zonedInstant } from './time.ts';

describe('ClimateField', () => {
  const field = new ClimateField(
    testClimate([
      { lat: 32, lng: -110.625, ele: 0 },
      { lat: 32, lng: -110, ele: 2000 },
    ]),
  );

  it('adjusts temperatures to the requested elevation, lows less than highs', () => {
    const low = field.at(-110.3, 32, 0, 100);
    const high = field.at(-110.3, 32, 2000, 100);
    expect(low?.tMin).toBeCloseTo(5, 5);
    expect(low?.tMax).toBeCloseTo(20, 5);
    expect(high?.tMin).toBeCloseTo(5 - 2 * NIGHT_LAPSE_C_PER_KM, 5);
    expect(high?.tMax).toBeCloseTo(20 - 2 * LAPSE_C_PER_KM, 5);
  });

  it('interpolates the other values and derives partly cloudy days', () => {
    expect(field.at(-110.3, 32, 500, 0)).toMatchObject({
      wet: 10,
      rain: 0.8,
      clear: 50,
      cloudy: 20,
      partly: 30,
    });
  });

  it('has no values away from the cells', () => {
    expect(field.at(-100, 40, 0, 0)).toBeNull();
  });
});

describe('temperatureAt', () => {
  const date = '2026-12-03';
  const sun = sunTimes(date, 32, -110.9);
  const at = (hour: number): number => temperatureAt(0, 20, sun, zonedInstant(date, hour, 'America/Phoenix'));

  it('is coldest around sunrise and warmest in the afternoon', () => {
    const hours = Array.from({ length: 24 }, (_, h) => at(h));
    const coldest = hours.indexOf(Math.min(...hours));
    const warmest = hours.indexOf(Math.max(...hours));
    expect(coldest).toBeGreaterThanOrEqual(6);
    expect(coldest).toBeLessThanOrEqual(7);
    expect(warmest).toBeGreaterThanOrEqual(13);
    expect(warmest).toBeLessThanOrEqual(15);
    expect(Math.max(...hours)).toBeLessThanOrEqual(20);
    expect(Math.min(...hours)).toBeGreaterThanOrEqual(0);
  });

  it('changes smoothly, no faster than a desert morning warms', () => {
    for (let h = 1; h < 24; h++) expect(Math.abs(at(h) - at(h - 1))).toBeLessThan(5);
  });

  it('has no step where night turns into day or day into night', () => {
    const minute = 60_000;
    for (const instant of [(sun.sunrise ?? 0) - 0.17 * 3_600_000, sun.sunset ?? 0]) {
      const before = temperatureAt(0, 20, sun, instant - minute);
      const after = temperatureAt(0, 20, sun, instant + minute);
      expect(Math.abs(after - before)).toBeLessThan(0.1);
    }
    expect(temperatureAt(0, 20, sun, (sun.sunrise ?? 0) - 0.17 * 3_600_000)).toBeCloseTo(0, 1);
  });
});
