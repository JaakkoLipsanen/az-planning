import type { ClimateLayer } from '#shared/bundle.ts';
import { CLIMATE_WEEKS } from '#shared/climate.ts';
import { decodeIntegers } from '#shared/polyline.ts';

import type { SunTimes } from './sun.ts';

/** Drop of the daily high with height, the standard atmosphere's. */
export const LAPSE_C_PER_KM = 6.5;
/**
 * Drop of the daily low with height. Clear winter nights pool cold air in basins, so lows fall much less with
 * height: against 61 Arizona stations (1991-2020 December normals) 0-3 °C/km fits, 6.5 does worst.
 */
export const NIGHT_LAPSE_C_PER_KM = 3;

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
  /** One night in ten is colder and one day in ten warmer than these, °C; null in older bundles. */
  coldNight: number | null;
  hotDay: number | null;
  wind: Wind | null;
}

export interface Wind {
  /** Mean speed at 2 m and the mean eastward and northward wind, km/h. */
  kmh: number;
  u: number;
  v: number;
  /** Share of days when it reaches 25 km/h, %. */
  windy: number;
}

interface Cell {
  /** Temperatures reduced to sea level, so cells at different heights can be interpolated. */
  seaMin: number[];
  seaMax: number[];
  wet: number[];
  rain: number[];
  clear: number[];
  cloudy: number[];
  seaColdNight: number[] | null;
  seaHotDay: number[] | null;
  wind: number[] | null;
  windU: number[] | null;
  windV: number[] | null;
  windy: number[] | null;
}

const tenths = (encoded: string | undefined, add = 0): number[] | null =>
  encoded === undefined ? null : decodeIntegers(encoded).map((v) => v / 10 + add);

const HOUR_MS = 3_600_000;

/** Typical weather anywhere near the route, by day of the year. */
export class ClimateField {
  readonly layer: ClimateLayer;
  private readonly cells = new Map<string, Cell>();

  constructor(layer: ClimateLayer) {
    this.layer = layer;
    for (const c of layer.cells) {
      const lift = (LAPSE_C_PER_KM * c.ele) / 1000;
      const nightLift = (NIGHT_LAPSE_C_PER_KM * c.ele) / 1000;
      this.cells.set(
        this.key(Math.round(c.lng / layer.cellSize.lng), Math.round(c.lat / layer.cellSize.lat)),
        {
          seaMin: decodeIntegers(c.tMin).map((v) => v / 10 + nightLift),
          seaMax: decodeIntegers(c.tMax).map((v) => v / 10 + lift),
          wet: decodeIntegers(c.wet),
          rain: decodeIntegers(c.rain).map((v) => v / 10),
          clear: decodeIntegers(c.clear),
          cloudy: decodeIntegers(c.cloudy),
          seaColdNight: tenths(c.tMinP10, nightLift),
          seaHotDay: tenths(c.tMaxP90, lift),
          wind: tenths(c.wind),
          windU: tenths(c.windU),
          windV: tenths(c.windV),
          windy: c.windy === undefined ? null : decodeIntegers(c.windy),
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
    const optional = (series: (cell: Cell) => number[] | null): number | null =>
      present.every(([cell]) => series(cell)) ? value((c) => series(c) ?? []) : null;

    const drop = (LAPSE_C_PER_KM * ele) / 1000;
    const nightDrop = (NIGHT_LAPSE_C_PER_KM * ele) / 1000;
    const clear = value((c) => c.clear);
    const cloudy = value((c) => c.cloudy);
    const coldNight = optional((c) => c.seaColdNight);
    const hotDay = optional((c) => c.seaHotDay);
    const [kmh, u, v, windy] = [
      optional((c) => c.wind),
      optional((c) => c.windU),
      optional((c) => c.windV),
      optional((c) => c.windy),
    ];
    return {
      tMin: value((c) => c.seaMin) - nightDrop,
      tMax: value((c) => c.seaMax) - drop,
      wet: value((c) => c.wet),
      rain: value((c) => c.rain),
      clear,
      partly: Math.max(0, 100 - clear - cloudy),
      cloudy,
      coldNight: coldNight === null ? null : coldNight - nightDrop,
      hotDay: hotDay === null ? null : hotDay - drop,
      wind: kmh === null || u === null || v === null || windy === null ? null : { kmh, u, v, windy },
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
  // Cooling scaled to reach the low exactly when the day curve starts again, so the curve has no step.
  const toLow = nightLength + LOW_LAG_H;
  const floor = Math.exp(-NIGHT_DECAY);
  const cooled = (Math.exp((-NIGHT_DECAY * sinceSunset) / toLow) - floor) / (1 - floor);
  return tMin + (daytime(dayLength) - tMin) * cooled;
}
