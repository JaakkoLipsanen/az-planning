import { describe, expect, it } from 'vitest';

import { parseOpeningHours } from './openingHours.ts';

describe('parseOpeningHours', () => {
  it('reads weekday rules', () => {
    const week = parseOpeningHours('Mo-Sa 08:30-20:00; Su 10:00-16:00');
    expect(week?.[0]).toBe('10:00-16:00');
    expect(week?.[1]).toBe('08:30-20:00');
    expect(week?.[6]).toBe('08:30-20:00');
  });

  it('marks days without hours as closed, also across the weekend', () => {
    const week = parseOpeningHours('Fr-Mo 11:00-20:00,21:00-23:00');
    expect(week).toEqual([
      '11:00-20:00, 21:00-23:00',
      '11:00-20:00, 21:00-23:00',
      null,
      null,
      null,
      '11:00-20:00, 21:00-23:00',
      '11:00-20:00, 21:00-23:00',
    ]);
    expect(parseOpeningHours('07:00-21:00; Tu off')?.[2]).toBeNull();
  });

  it('knows round-the-clock places', () => {
    expect(parseOpeningHours('24/7')?.every((h) => h === '24 h')).toBe(true);
  });

  it('gives up on rules it does not understand', () => {
    expect(parseOpeningHours('Mo-Fr 08:00-17:00; PH off')).toBeNull();
    expect(parseOpeningHours('sunrise-sunset')).toBeNull();
    expect(parseOpeningHours('')).toBeNull();
  });
});
