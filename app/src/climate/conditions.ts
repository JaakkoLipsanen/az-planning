import { dayOfYear } from '#shared/climate.ts';

import type { TripCalendar } from '../plan/calendar.ts';
import type { Day, DayPlan } from '../plan/dayPlan.ts';
import type { TripModel } from '../trip/model.ts';
import type { Climate, ClimateField } from './field.ts';
import { moonNight, type MoonNight } from './moon.ts';
import { sunTimes, type SunTimes } from './sun.ts';
import { addDays, zonedInstant } from './time.ts';

/** Profile samples per day used for the day's weather; enough to catch climbs without slowing the plan. */
const SAMPLES_PER_DAY = 24;
const HOUR_MS = 3_600_000;
const KM_PER_DEGREE = 111.32;
/** Below this share of the mean speed the mean wind vector says little about the direction. */
const STEADY_WIND_SHARE = 0.3;

/** When riding starts each day and how long the breaks are. */
export interface RideTimes {
  /** Local HH:MM; null for sunrise. */
  startTime: string | null;
  breakPercent: number;
}

export interface DayRide {
  /** Start and estimated end of the riding day, breaks included (instants). */
  start: number;
  end: number;
  /** Route km where civil dusk falls when the day runs past it. */
  darkKm: number | null;
  /** The chosen start is before civil dawn. */
  startsInDark: boolean;
}

export interface DayWind {
  /** Typical mean wind speed at 2 m, km/h. */
  kmh: number;
  /** Mean wind along the day's direction of travel, km/h: positive is a tailwind. */
  tailKmh: number;
  /** Direction the prevailing wind comes from, degrees; null when it varies. */
  from: number | null;
  /** Share of days when it reaches 25 km/h, %. */
  windy: number;
}

export interface DayWeather {
  /** Range of the typical daily highs along the day's route, °C. */
  highs: [min: number, max: number];
  /** Typical low at the night stop (or the finish), °C, and the low that one night in ten is colder than. */
  nightLow: number;
  coldNight: number | null;
  /** The high that one day in ten exceeds, the warmest along the day, °C. */
  hotDay: number | null;
  /** Chance of a wet day, mean precipitation (mm) and sky shares (%), averaged along the day. */
  wet: number;
  rain: number;
  clear: number;
  partly: number;
  cloudy: number;
  wind: DayWind | null;
}

export interface DayConditions {
  date: string;
  /** Sun times at the day's start (morning) and end (evening). */
  morning: SunTimes;
  evening: SunTimes;
  ride: DayRide | null;
  /** The moon from dusk to dawn at the night stop; null after the last day. */
  moon: MoonNight | null;
  weather: DayWeather | null;
}

function sampleRange(model: TripModel, day: Day): [number, number, number] {
  const i0 = model.profile.indexAt('km', day.startKm);
  const i1 = Math.max(i0, model.profile.indexAt('km', day.endKm));
  return [i0, i1, Math.max(1, Math.floor((i1 - i0) / SAMPLES_PER_DAY))];
}

function dayWind(model: TripModel, samples: Climate[], day: Day): DayWind | null {
  const winds = samples.map((c) => c.wind);
  if (winds.length === 0 || winds.some((w) => w === null)) return null;
  const mean = (pick: (w: NonNullable<Climate['wind']>) => number): number =>
    winds.reduce((sum, w) => sum + (w ? pick(w) : 0), 0) / winds.length;
  const [kmh, u, v] = [mean((w) => w.kmh), mean((w) => w.u), mean((w) => w.v)];
  const { lng, lat } = model.profile.data;
  const [i0, i1, step] = sampleRange(model, day);
  let along = 0;
  let length = 0;
  for (let i = i0; i + step <= i1; i += step) {
    const j = i + step;
    const east = (lng[j] - lng[i]) * Math.cos((lat[i] * Math.PI) / 180) * KM_PER_DEGREE;
    const north = (lat[j] - lat[i]) * KM_PER_DEGREE;
    along += u * east + v * north;
    length += Math.hypot(east, north);
  }
  const steady = Math.hypot(u, v) >= STEADY_WIND_SHARE * kmh;
  return {
    kmh,
    tailKmh: length > 0 ? along / length : 0,
    from: steady ? ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360 : null,
    windy: mean((w) => w.windy),
  };
}

function weatherOf(model: TripModel, field: ClimateField, day: Day, date: string): DayWeather | null {
  const { profile } = model;
  const doy = dayOfYear(date);
  const [i0, i1, step] = sampleRange(model, day);
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
  const hotDays = samples.map((c) => c.hotDay).filter((t) => t !== null);
  return {
    highs: [Math.min(...highs), Math.max(...highs)],
    nightLow: night.tMin,
    coldNight: night.coldNight,
    hotDay: hotDays.length === samples.length ? Math.max(...hotDays) : null,
    wet: mean((c) => c.wet),
    rain: mean((c) => c.rain),
    clear: mean((c) => c.clear),
    partly: mean((c) => c.partly),
    cloudy: mean((c) => c.cloudy),
    wind: dayWind(model, samples, day),
  };
}

function rideOf(
  model: TripModel,
  day: Day,
  date: string,
  sun: { morning: SunTimes; evening: SunTimes },
  times: RideTimes,
): DayRide | null {
  const { profile, timeZone } = model;
  let start = sun.morning.sunrise;
  if (times.startTime) {
    const [h, m] = times.startTime.split(':').map(Number);
    start = zonedInstant(date, h + m / 60, timeZone);
  }
  if (start === null) return null;
  const slowdown = 1 + times.breakPercent / 100;
  const end = start + day.hours * slowdown * HOUR_MS;
  const { dusk } = sun.evening;
  const darkKm =
    dusk !== null && end > dusk
      ? profile.kmAtHours(profile.hoursAtKm(day.startKm) + Math.max(0, dusk - start) / HOUR_MS / slowdown)
      : null;
  return {
    start,
    end,
    darkKm,
    startsInDark: sun.morning.dawn !== null && start < sun.morning.dawn,
  };
}

/** Dates, sun times, riding hours, moon and typical weather for every day of the plan. */
export function dayConditions(
  model: TripModel,
  plan: DayPlan,
  calendar: TripCalendar,
  times: RideTimes,
): DayConditions[] {
  return plan.days.map((day) => {
    const date = calendar.dates[day.number - 1];
    const [startLng, startLat] = model.profile.lngLatAtKm(day.startKm);
    const [endLng, endLat] = model.profile.lngLatAtKm(day.endKm);
    const sun = { morning: sunTimes(date, startLat, startLng), evening: sunTimes(date, endLat, endLng) };
    const nextDawn = sunTimes(addDays(date, 1), endLat, endLng).dawn;
    const night = day.night ?? null;
    return {
      date,
      ...sun,
      ride: rideOf(model, day, date, sun, times),
      moon:
        night && sun.evening.dusk !== null && nextDawn !== null
          ? moonNight(sun.evening.dusk, nextDawn, night.lat, night.lng)
          : null,
      weather: model.climate ? weatherOf(model, model.climate, day, date) : null,
    };
  });
}

/** Typical low and high at every profile sample on the date the plan reaches it (NaN without data). */
export function temperatureAlongRoute(
  model: TripModel,
  dayOfSample: Int16Array,
  dates: readonly string[],
): { tMin: Float32Array; tMax: Float32Array } {
  const { profile, climate } = model;
  const tMin = new Float32Array(profile.length).fill(NaN);
  const tMax = new Float32Array(profile.length).fill(NaN);
  if (!climate) return { tMin, tMax };
  for (let i = 0; i < profile.length; i++) {
    const date = dates[dayOfSample[i] - 1];
    if (!date) continue;
    const c = climate.at(profile.data.lng[i], profile.data.lat[i], profile.data.ele[i], dayOfYear(date));
    if (c) {
      tMin[i] = c.tMin;
      tMax[i] = c.tMax;
    }
  }
  return { tMin, tMax };
}
