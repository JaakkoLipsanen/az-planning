import { describe, expect, it } from 'vitest';

import { decodeIntegers } from '#shared/polyline.ts';

import type { PowerDay } from '../net/power.ts';
import { cellsNear, weeklyClimate } from './climate.ts';

function year(y: number, day: (doy: number) => Omit<PowerDay, 'date'>): PowerDay[] {
  const out: PowerDay[] = [];
  for (let t = Date.UTC(y, 0, 1); t < Date.UTC(y + 1, 0, 1); t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10).replaceAll('-', '');
    out.push({ date, ...day(out.length) });
  }
  return out;
}

describe('weeklyClimate', () => {
  it('averages temperatures and counts wet, clear and cloudy days per week', () => {
    const days = [2023, 2024].flatMap((y) =>
      year(y, (doy) => ({
        tMin: doy < 182 ? 0 : 10,
        tMax: doy < 182 ? 10 : 30,
        rain: doy % 4 === 0 ? 5 : 0,
        cloud: doy % 2 === 0 ? 10 : 90,
      })),
    );
    const c = weeklyClimate(days);
    expect(decodeIntegers(c.tMin)[2]).toBe(0);
    expect(decodeIntegers(c.tMax)[40]).toBe(300);
    expect(decodeIntegers(c.wet)[10]).toBeGreaterThan(20);
    expect(decodeIntegers(c.wet)[10]).toBeLessThan(30);
    expect(decodeIntegers(c.clear)[10] + decodeIntegers(c.cloudy)[10]).toBe(100);
  });
});

describe('cellsNear', () => {
  it('includes the cells a line passes and their neighbours', () => {
    const cells = cellsNear([
      [
        [-110.6, 32.1],
        [-110.5, 32.2],
      ],
    ]);
    expect(cells).toHaveLength(9);
    expect(cells).toContainEqual([-110.625, 32]);
  });
});
