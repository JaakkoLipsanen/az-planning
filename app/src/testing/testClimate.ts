import type { ClimateLayer } from '#shared/bundle.ts';
import { encodeIntegers } from '#shared/polyline.ts';

import { LAPSE_C_PER_KM } from '../climate/field.ts';

const weeks = (value: number): string => encodeIntegers(Array.from({ length: 52 }, () => value));

/** Cells with the same sea-level climate all year: lows 5 °C, highs 20 °C, 10 % wet days, half of them clear. */
export function testClimate(cells: { lat: number; lng: number; ele: number }[]): ClimateLayer {
  return {
    source: 'test',
    years: [2005, 2024],
    cellSize: { lng: 0.625, lat: 0.5 },
    wetDayMm: 1,
    cloud: { clearBelow: 25, cloudyAbove: 75 },
    cells: cells.map(({ lat, lng, ele }) => {
      const lift = (LAPSE_C_PER_KM * ele) / 1000;
      return {
        lat,
        lng,
        ele,
        tMin: weeks((5 - lift) * 10),
        tMax: weeks((20 - lift) * 10),
        wet: weeks(10),
        rain: weeks(8),
        clear: weeks(50),
        cloudy: weeks(20),
      };
    }),
  };
}
