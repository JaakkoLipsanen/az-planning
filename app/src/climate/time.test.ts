import { describe, expect, it } from 'vitest';

import { addDays, formatDate, formatTime, isIsoDate, zonedInstant } from './time.ts';

describe('dates', () => {
  it('adds days across months, years and leap days', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('accepts only real calendar dates', () => {
    expect(isIsoDate('2026-12-03')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('3.12.2026')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it('formats a date without shifting it by time zone', () => {
    expect(formatDate('2026-12-03')).toBe('Thu 3 Dec');
  });
});

describe('zonedInstant', () => {
  it('turns a wall-clock hour into an instant in zones with and without daylight saving', () => {
    expect(new Date(zonedInstant('2026-12-03', 6, 'America/Phoenix')).toISOString()).toBe(
      '2026-12-03T13:00:00.000Z',
    );
    expect(new Date(zonedInstant('2026-07-01', 6, 'America/Phoenix')).toISOString()).toBe(
      '2026-07-01T13:00:00.000Z',
    );
    expect(new Date(zonedInstant('2026-07-01', 6, 'Europe/Helsinki')).toISOString()).toBe(
      '2026-07-01T03:00:00.000Z',
    );
    expect(new Date(zonedInstant('2026-01-15', 6, 'Europe/Helsinki')).toISOString()).toBe(
      '2026-01-15T04:00:00.000Z',
    );
  });

  it('round-trips through formatTime', () => {
    expect(formatTime(zonedInstant('2026-10-25', 23, 'Europe/Helsinki'), 'Europe/Helsinki')).toBe('23:00');
  });
});
