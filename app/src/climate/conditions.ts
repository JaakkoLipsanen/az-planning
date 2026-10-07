import { dayOfYear } from '#shared/climate.ts';

import type { Day, DayPlan } from '../plan/dayPlan.ts';
import type { TripModel } from '../trip/model.ts';
import type { Climate, ClimateField } from './field.ts';
import { sunTimes, type SunTimes } from './sun.ts';
import { addDays } from './time.ts';

/** Profile samples per day used for the day's weather; enough to catch climbs without slowing the plan. */
const SAMPLES_PER_DAY = 24;

export interface DayWeather {
  /** Range of the typical daily highs along the day's route, °C. */
  highs: [min: number, max: number];
  /** Typical low at the night stop (or the finish), °C. */
  nightLow: number;
  /** Chance of a wet day, mean precipitation (mm) and sky shares (%), averaged along the day. */
  wet: number;
  rain: number;
  clear: number;
  partly: number;
  cloudy: number;
}

export interface DayConditions {
  date: string;
  /** Sun times at the day's start (morning) and end (evening). */
  morning: SunTimes;
  evening: SunTimes;
  weather: DayWeather | null;
}

function weatherOf(model: TripModel, field: ClimateField, day: Day, date: string): DayWeather | null {
  const { profile } = model;
  const doy = dayOfYear(date);
  const i0 = profile.indexAt('km', day.startKm);
  const i1 = Math.max(i0, profile.indexAt('km', day.endKm));
  const step = Math.max(1, Math.floor((i1 - i0) / SAMPLES_PER_DAY));
  const samples: Climate[] = [];
  for (let i = i0; i <= i1; i += step) {
    const c = field.at(profile.data.lng[i], profile.data.lat[i], profile.data.ele[i], doy);
    if (c) samples.push(c);
  }
  const night = field.at(profile.data.lng[i1], profile.data.lat[i1], profile.data.ele[i1], doy);
  if (samples.length === 0 || !night) return null;
  const mean = (pick: (c: Climate) => number): number =>
    samples.reduce((sum, c) => sum + pick(c), 0) / samples.length;
  const highs = samples.map((c) => c.tMax);
  return {
    highs: [Math.min(...highs), Math.max(...highs)],
    nightLow: night.tMin,
    wet: mean((c) => c.wet),
    rain: mean((c) => c.rain),
    clear: mean((c) => c.clear),
    partly: mean((c) => c.partly),
    cloudy: mean((c) => c.cloudy),
  };
}

/** Dates, sun times and typical weather for every day of the plan from a start date. */
export function dayConditions(model: TripModel, plan: DayPlan, startDate: string): DayConditions[] {
  return plan.days.map((day) => {
    const date = addDays(startDate, day.number - 1);
    const [startLng, startLat] = model.profile.lngLatAtKm(day.startKm);
    const [endLng, endLat] = model.profile.lngLatAtKm(day.endKm);
    return {
      date,
      morning: sunTimes(date, startLat, startLng),
      evening: sunTimes(date, endLat, endLng),
      weather: model.climate ? weatherOf(model, model.climate, day, date) : null,
    };
  });
}

/** Typical low and high at every profile sample on the date the plan reaches it (NaN without data). */
export function temperatureAlongRoute(
  model: TripModel,
  dayOfSample: Int16Array,
  startDate: string,
): { tMin: Float32Array; tMax: Float32Array } {
  const { profile, climate } = model;
  const tMin = new Float32Array(profile.length).fill(NaN);
  const tMax = new Float32Array(profile.length).fill(NaN);
  if (!climate) return { tMin, tMax };
  const doyOfDay = new Map<number, number>();
  for (let i = 0; i < profile.length; i++) {
    const day = dayOfSample[i];
    let doy = doyOfDay.get(day);
    if (doy === undefined) {
      doy = dayOfYear(addDays(startDate, day - 1));
      doyOfDay.set(day, doy);
    }
    const c = climate.at(profile.data.lng[i], profile.data.lat[i], profile.data.ele[i], doy);
    if (c) {
      tMin[i] = c.tMin;
      tMax[i] = c.tMax;
    }
  }
  return { tMin, tMax };
}
