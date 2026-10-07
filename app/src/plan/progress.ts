import { z } from 'zod';

import { dayOnDate, type TripCalendar } from './calendar.ts';
import { dayAtKm, type DayPlan, type Night } from './dayPlan.ts';

/** A remembered position helps the first GPS fix only while the trip is under way. */
const REMEMBERED_FOR_MS = 2 * 86_400_000;

const remembered = z.object({ km: z.number(), at: z.number() });

const positionKey = (slug: string): string => `trip:${slug}:position`;

export function rememberKm(slug: string, km: number): void {
  try {
    localStorage.setItem(positionKey(slug), JSON.stringify({ km, at: Date.now() }));
  } catch {
    // Without storage the first fix next time falls back to the plan.
  }
}

export function rememberedKm(slug: string): number | null {
  try {
    const value = remembered.safeParse(JSON.parse(localStorage.getItem(positionKey(slug)) ?? 'null')).data;
    return value && Date.now() - value.at < REMEMBERED_FOR_MS ? value.km : null;
  } catch {
    return null;
  }
}

/** Where the plan expects the rider to start today; null outside the trip's dates. */
export function expectedKm(plan: DayPlan, calendar: TripCalendar | null, today: string): number | null {
  const day = calendar && dayOnDate(calendar, today);
  return day ? (plan.days[day - 1]?.startKm ?? null) : null;
}

/** The night that ends today: by the calendar during the trip, else the night that ends the day at a km. */
export function tonight(
  plan: DayPlan,
  calendar: TripCalendar | null,
  today: string,
  km: number,
): Night | null {
  const day = calendar && dayOnDate(calendar, today);
  return (day ? plan.nights[day - 1] : dayAtKm(plan, km).night) ?? null;
}
