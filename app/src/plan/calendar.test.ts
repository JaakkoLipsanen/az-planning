import { describe, expect, it } from 'vitest';

import { dayOnDate, tripCalendar } from './calendar.ts';

describe('tripCalendar', () => {
  it('dates the riding days around rest days', () => {
    const calendar = tripCalendar('2026-12-30', 4, [1, 3, 9]);
    expect(calendar.dates).toEqual(['2026-12-30', '2027-01-01', '2027-01-02', '2027-01-04']);
    expect(calendar.rests).toEqual([
      { night: 1, date: '2026-12-31' },
      { night: 3, date: '2027-01-03' },
    ]);
    expect(calendar.end).toBe('2027-01-04');
  });

  it('finds the riding day of a date', () => {
    const calendar = tripCalendar('2026-12-01', 3, [1]);
    expect(dayOnDate(calendar, '2026-11-30')).toBeNull();
    expect(dayOnDate(calendar, '2026-12-01')).toBe(1);
    expect(dayOnDate(calendar, '2026-12-02')).toBe(2);
    expect(dayOnDate(calendar, '2026-12-04')).toBe(3);
    expect(dayOnDate(calendar, '2026-12-05')).toBeNull();
  });
});
