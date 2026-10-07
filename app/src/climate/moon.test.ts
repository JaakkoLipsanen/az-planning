import { describe, expect, it } from 'vitest';

import { moonIllumination, moonNight } from './moon.ts';
import { sunTimes } from './sun.ts';

function night(date: string, next: string): ReturnType<typeof moonNight> {
  return moonNight(sunTimes(date, 32.2, -111).dusk ?? 0, sunTimes(next, 32.2, -111).dawn ?? 0, 32.2, -111);
}

describe('moon', () => {
  it('is new, full and half lit on the known dates', () => {
    expect(moonIllumination(Date.parse('2024-12-01T06:21Z')).fraction).toBeLessThan(0.01);
    expect(moonIllumination(Date.parse('2024-12-15T09:02Z')).fraction).toBeGreaterThan(0.99);
    const quarter = moonIllumination(Date.parse('2024-12-08T15:27Z'));
    expect(quarter.fraction).toBeCloseTo(0.5, 1);
    expect(quarter.waxing).toBe(true);
  });

  it('is up all night when full and rises around midnight at last quarter', () => {
    const full = night('2024-12-15', '2024-12-16');
    expect(full.upAtStart && full.upAtEnd && full.sets === null).toBe(true);
    const lastQuarter = night('2024-12-22', '2024-12-23');
    expect(lastQuarter.upAtStart).toBe(false);
    const rise = new Date(lastQuarter.rises ?? 0).getUTCHours();
    expect([6, 7, 8]).toContain(rise);
  });
});
