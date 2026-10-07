import { dayOfYear } from '#shared/climate.ts';

import type { TripModel } from '../trip/model.ts';
import { temperatureAt } from './field.ts';
import { sunTimes, type SunTimes } from './sun.ts';
import { zonedInstant } from './time.ts';

/** Sun times change by about a minute over this distance, so they are computed once per stretch. */
const SUN_STEP_KM = 20;

export interface RouteTemperatureStats {
  mean: number;
  min: number;
  max: number;
  /** 10 % of the route is colder than p10 and 10 % warmer than p90. */
  p10: number;
  p90: number;
  minKm: number;
  maxKm: number;
  /** Share of the route below 0 °C, 0-1. */
  freezing: number;
}

/** The value below which a share (0-1) of the sorted values lie, interpolating between neighbours. */
export function percentile(sorted: ArrayLike<number>, share: number): number {
  const position = (sorted.length - 1) * share;
  const below = Math.floor(position);
  const above = Math.min(sorted.length - 1, below + 1);
  return sorted[below] + (sorted[above] - sorted[below]) * (position - below);
}

/** Typical temperature along the whole route at one date and local hour; null without climate data. */
export function routeTemperatureStats(
  model: TripModel,
  date: string,
  hour: number,
): RouteTemperatureStats | null {
  const { profile, climate, timeZone } = model;
  if (!climate) return null;
  const day = dayOfYear(date);
  const instant = zonedInstant(date, hour, timeZone);
  const values: number[] = [];
  let [min, max, minKm, maxKm] = [Infinity, -Infinity, 0, 0];
  let sun: SunTimes | null = null;
  let sunKm = -Infinity;
  for (let i = 0; i < profile.length; i++) {
    const { km, lat, lng, ele } = profile.data;
    if (!sun || km[i] - sunKm > SUN_STEP_KM) {
      sun = sunTimes(date, lat[i], lng[i]);
      sunKm = km[i];
    }
    const c = climate.at(lng[i], lat[i], ele[i], day);
    if (!c) continue;
    const t = temperatureAt(c.tMin, c.tMax, sun, instant);
    values.push(t);
    if (t < min) [min, minKm] = [t, km[i]];
    if (t > max) [max, maxKm] = [t, km[i]];
  }
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return {
    mean: values.reduce((sum, t) => sum + t, 0) / values.length,
    min,
    max,
    p10: percentile(sorted, 0.1),
    p90: percentile(sorted, 0.9),
    minKm,
    maxKm,
    freezing: values.filter((t) => t < 0).length / values.length,
  };
}
