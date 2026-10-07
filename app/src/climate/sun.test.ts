import { describe, expect, it } from 'vitest';

import { sunAltitude, sunTimes } from './sun.ts';
import { formatTime } from './time.ts';

const minutes = (ms: number | null): number => (ms === null ? NaN : ms / 60_000);

/** Minutes between an instant and a wall-clock time ("HH:MM") on the same day in a zone. */
function offBy(instant: number | null, expected: string, timeZone: string): number {
  const [h, m] = formatTime(instant ?? 0, timeZone)
    .split(':')
    .map(Number);
  const [eh, em] = expected.split(':').map(Number);
  return Math.abs(h * 60 + m - (eh * 60 + em));
}

describe('sunTimes', () => {
  it('matches published times to within a minute', () => {
    const london = sunTimes('2026-06-21', 51.5074, -0.1278);
    expect(offBy(london.sunrise, '04:43', 'Europe/London')).toBeLessThanOrEqual(1);
    expect(offBy(london.sunset, '21:21', 'Europe/London')).toBeLessThanOrEqual(1);
    const sydney = sunTimes('2026-12-21', -33.8688, 151.2093);
    expect(offBy(sydney.sunrise, '05:41', 'Australia/Sydney')).toBeLessThanOrEqual(1);
    expect(offBy(sydney.sunset, '20:05', 'Australia/Sydney')).toBeLessThanOrEqual(1);
  });

  it('puts the sun on the horizon at sunrise and 6 degrees below at dusk', () => {
    const [lat, lng] = [32.2226, -110.9747];
    const t = sunTimes('2026-12-09', lat, lng);
    expect(sunAltitude(t.sunrise ?? 0, lat, lng)).toBeCloseTo(-0.833, 0);
    expect(sunAltitude(t.dusk ?? 0, lat, lng)).toBeCloseTo(-6, 0);
    expect(minutes(t.sunrise) - minutes(t.dawn)).toBeGreaterThan(20);
    expect(minutes(t.sunrise) - minutes(t.dawn)).toBeLessThan(35);
  });

  it('gives the times of the requested local date far from Greenwich', () => {
    const t = sunTimes('2026-12-09', 32.2226, -110.9747);
    expect(new Date(t.noon).toISOString().slice(0, 10)).toBe('2026-12-09');
    expect(offBy(t.sunrise, '07:14', 'America/Phoenix')).toBeLessThanOrEqual(2);
    expect(offBy(t.sunset, '17:19', 'America/Phoenix')).toBeLessThanOrEqual(2);
  });

  it('reports no sunset during polar day', () => {
    const t = sunTimes('2026-06-21', 78.2, 15.6);
    expect(t.sunrise).toBeNull();
    expect(t.sunset).toBeNull();
  });
});
