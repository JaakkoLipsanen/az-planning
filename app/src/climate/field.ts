import type { ClimateLayer } from '#shared/bundle.ts';
import { CLIMATE_WEEKS } from '#shared/climate.ts';
import { decodeIntegers } from '#shared/polyline.ts';

import type { SunTimes } from './sun.ts';

/** Average drop in temperature with height; clear nights in valleys are often colder than this suggests. */
export const LAPSE_C_PER_KM = 6.5;

export interface Climate {
  /** Typical daily low and high in °C at the requested elevation. */
  tMin: number;
  tMax: number;
  /** Chance of a wet day, %. */
  wet: number;
  /** Mean precipitation, mm per day. */
  rain: number;
  /** Shares of clear, partly cloudy and cloudy days, %. */
  clear: number;
  partly: number;
  cloudy: number;
}

interface Cell {
  /** Temperatures reduced to sea level, so cells at different heights can be interpolated. */
  seaMin: number[];
  seaMax: number[];
  wet: number[];
  rain: number[];
  clear: number[];
  cloudy: number[];
}

const HOUR_MS = 3_600_000;

/** Typical weather anywhere near the route, by day of the year. */
export class ClimateField {
  readonly layer: ClimateLayer;
  private readonly cells = new Map<string, Cell>();

  constructor(layer: ClimateLayer) {
    this.layer = layer;
    for (const c of layer.cells) {
      const lift = (LAPSE_C_PER_KM * c.ele) / 1000;
      this.cells.set(
        this.key(Math.round(c.lng / layer.cellSize.lng), Math.round(c.lat / layer.cellSize.lat)),
        {
          seaMin: decodeIntegers(c.tMin).map((v) => v / 10 + lift),
          seaMax: decodeIntegers(c.tMax).map((v) => v / 10 + lift),
          wet: decodeIntegers(c.wet),
          rain: decodeIntegers(c.rain).map((v) => v / 10),
          clear: decodeIntegers(c.clear),
          cloudy: decodeIntegers(c.cloudy),
        },
      );
    }
  }

  private key(i: number, j: number): string {
    return `${i}/${j}`;
  }

  /** Typical weather at a place and elevation on a day of the year (0-364); null away from the data. */
  at(lng: number, lat: number, ele: number, day: number): Climate | null {
    const gx = lng / this.layer.cellSize.lng;
    const gy = lat / this.layer.cellSize.lat;
    const i = Math.floor(gx);
    const j = Math.floor(gy);
    const fx = gx - i;
    const fy = gy - j;
    const corners: [Cell | undefined, number][] = [
      [this.cells.get(this.key(i, j)), (1 - fx) * (1 - fy)],
      [this.cells.get(this.key(i + 1, j)), fx * (1 - fy)],
      [this.cells.get(this.key(i, j + 1)), (1 - fx) * fy],
      [this.cells.get(this.key(i + 1, j + 1)), fx * fy],
    ];
    const present = corners.filter((c): c is [Cell, number] => c[0] !== undefined);
    const total = present.reduce((sum, [, w]) => sum + w, 0);
    if (total <= 0) return null;

    const position = (day - 3) / 7;
    const k0 = ((Math.floor(position) % CLIMATE_WEEKS) + CLIMATE_WEEKS) % CLIMATE_WEEKS;
    const k1 = (k0 + 1) % CLIMATE_WEEKS;
    const t = position - Math.floor(position);
    const value = (series: (cell: Cell) => number[]): number =>
      present.reduce((sum, [cell, w]) => {
        const s = series(cell);
        return sum + w * (s[k0] * (1 - t) + s[k1] * t);
      }, 0) / total;

    const drop = (LAPSE_C_PER_KM * ele) / 1000;
    const clear = value((c) => c.clear);
    const cloudy = value((c) => c.cloudy);
    return {
      tMin: value((c) => c.seaMin) - drop,
      tMax: value((c) => c.seaMax) - drop,
      wet: value((c) => c.wet),
      rain: value((c) => c.rain),
      clear,
      partly: Math.max(0, 100 - clear - cloudy),
      cloudy,
    };
  }
}

/** Parton & Logan (1981) constants: hours from noon to the high, night cooling rate, hours from sunrise to the low. */
const PEAK_LAG_H = 1.86;
const NIGHT_DECAY = 2.2;
const LOW_LAG_H = -0.17;

/** Temperature at an instant from the day's low and high: a sine by day and exponential cooling after sunset. */
export function temperatureAt(tMin: number, tMax: number, sun: SunTimes, instant: number): number {
  if (sun.sunrise === null || sun.sunset === null) return (tMin + tMax) / 2;
  const dayLength = (sun.sunset - sun.sunrise) / HOUR_MS;
  const nightLength = 24 - dayLength;
  const daytime = (hours: number): number =>
    tMin + (tMax - tMin) * Math.sin((Math.PI * (hours - LOW_LAG_H)) / (dayLength + 2 * PEAK_LAG_H));
  const sinceSunrise = (instant - sun.sunrise) / HOUR_MS;
  if (sinceSunrise >= LOW_LAG_H && sinceSunrise <= dayLength) return daytime(sinceSunrise);
  const sinceSunset = sinceSunrise > dayLength ? sinceSunrise - dayLength : sinceSunrise + nightLength;
  return (
    tMin + (daytime(dayLength) - tMin) * Math.exp((-NIGHT_DECAY * sinceSunset) / (nightLength + LOW_LAG_H))
  );
}
