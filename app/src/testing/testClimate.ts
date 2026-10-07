import type { ClimateLayer } from '#shared/bundle.ts';
import { encodeIntegers } from '#shared/polyline.ts';

import { LAPSE_C_PER_KM, NIGHT_LAPSE_C_PER_KM } from '../climate/field.ts';

const weeks = (value: number): string => encodeIntegers(Array.from({ length: 52 }, () => value));

/**
 * Cells with the same sea-level climate all year: lows 5 °C (1 in 10 below 0), highs 20 °C (1 in 10 above 25),
 * 10 % wet days, half of them clear, and a 5 km/h wind from the north at a mean speed of 8 km/h.
 */
export function testClimate(cells: { lat: number; lng: number; ele: number }[]): ClimateLayer {
  return {
    source: 'test',
    years: [2005, 2024],
    cellSize: { lng: 0.625, lat: 0.5 },
    wetDayMm: 1,
    cloud: { clearBelow: 25, cloudyAbove: 75 },
    cells: cells.map(({ lat, lng, ele }) => {
      const lift = (LAPSE_C_PER_KM * ele) / 1000;
      const nightLift = (NIGHT_LAPSE_C_PER_KM * ele) / 1000;
      return {
        lat,
        lng,
        ele,
        tMin: weeks((5 - nightLift) * 10),
        tMax: weeks((20 - lift) * 10),
        wet: weeks(10),
        rain: weeks(8),
        clear: weeks(50),
        cloudy: weeks(20),
        tMinP10: weeks((0 - nightLift) * 10),
        tMaxP90: weeks((25 - lift) * 10),
        wind: weeks(80),
        windU: weeks(0),
        windV: weeks(-50),
        windy: weeks(10),
      };
    }),
  };
}
