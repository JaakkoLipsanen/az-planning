import { dayOfYear } from '#shared/climate.ts';
import { clamp } from '#shared/geo.ts';

import type { RouteStop, TripModel } from '../trip/model.ts';
import type { TripCalendar } from './calendar.ts';
import { dayAtKm, type DayPlan } from './dayPlan.ts';

/** What counts as a source: natural water (creeks, springs, tanks) and unverified OpenStreetMap points. */
export interface SupplyOptions {
  natural: boolean;
  osm: boolean;
}

/** A stretch of the route between two supply points; null ends are the start and the finish. */
export interface Stretch {
  fromKm: number;
  toKm: number;
  km: number;
  hours: number;
  from: RouteStop | null;
  to: RouteStop | null;
  /** Nights of the plan inside the stretch. */
  nights: number;
  /** Warmest typical high along it on the planned dates, °C. */
  highC: number | null;
}

const NIGHT_LITRES = 1.5;
const HIGH_SAMPLE_KM = 2;

/** Places to fill bottles: water points, and anywhere that sells food or drink. */
export function waterStops(model: TripModel, { natural, osm }: SupplyOptions): RouteStop[] {
  return model.stops.filter(
    ({ poi }) =>
      (osm || !poi.osm) &&
      (poi.category === 'resupply' || (poi.category === 'water' && (natural || poi.water !== 'natural'))),
  );
}

export function resupplyStops(model: TripModel, { osm }: SupplyOptions): RouteStop[] {
  return model.stops.filter(({ poi }) => poi.category === 'resupply' && (osm || !poi.osm));
}

function warmestHigh(
  model: TripModel,
  plan: DayPlan,
  calendar: TripCalendar,
  fromKm: number,
  toKm: number,
): number | null {
  const { climate, profile } = model;
  if (!climate) return null;
  let high: number | null = null;
  for (let km = fromKm; km <= toKm; km += HIGH_SAMPLE_KM) {
    const date = calendar.dates[dayAtKm(plan, km).number - 1];
    const [lng, lat] = profile.lngLatAtKm(km);
    const c = climate.at(lng, lat, profile.interpolate('km', km, 'ele'), dayOfYear(date));
    if (c) high = Math.max(high ?? -Infinity, c.tMax);
  }
  return high;
}

/** The stretches between consecutive stops, from the start to the finish. */
export function stretchesBetween(
  model: TripModel,
  plan: DayPlan,
  calendar: TripCalendar | null,
  stops: readonly RouteStop[],
): Stretch[] {
  const { profile } = model;
  const out: Stretch[] = [];
  let from: RouteStop | null = null;
  for (const to of [...stops, null]) {
    const fromKm = from?.km ?? 0;
    const toKm = to?.km ?? profile.totalKm;
    if (toKm > fromKm) {
      out.push({
        fromKm,
        toKm,
        km: toKm - fromKm,
        hours: profile.hoursAtKm(toKm) - profile.hoursAtKm(fromKm),
        from,
        to,
        nights: plan.nights.filter((n) => n.km > fromKm && n.km < toKm).length,
        highC: calendar ? warmestHigh(model, plan, calendar, fromKm, toKm) : null,
      });
    }
    if (to) from = to;
  }
  return out;
}

/**
 * Rough drinking water for a stretch: 0.5 l per hour of riding when it is cool, rising to 1.25 l in the heat,
 * and 1.5 l for every night (cooking, breakfast).
 */
export function litresFor(stretch: Stretch): number {
  const perHour = clamp(0.5 + ((stretch.highC ?? 15) - 15) / 30, 0.5, 1.25);
  return stretch.hours * perHour + stretch.nights * NIGHT_LITRES;
}

export function longest(stretches: readonly Stretch[], count: number): Stretch[] {
  return stretches.toSorted((a, b) => b.km - a.km).slice(0, count);
}

/** The longest part of any stretch inside the day from a to b, km. */
export function longestWithin(stretches: readonly Stretch[], a: number, b: number): number {
  return stretches.reduce((max, s) => Math.max(max, Math.min(b, s.toKm) - Math.max(a, s.fromKm)), 0);
}

/** The first stop after a km (a little behind counts, for a position next to it). */
export function nextStop(stops: readonly RouteStop[], km: number): RouteStop | null {
  return stops.find((s) => s.km >= km - 0.1) ?? null;
}
