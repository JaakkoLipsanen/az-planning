import type { Notice } from '#shared/bundle.ts';

import { formatDate } from '../climate/time.ts';
import type { TripModel } from '../trip/model.ts';
import { onDay, type Day } from './dayPlan.ts';
import { parseOpeningHours, WEEKDAY_NAMES } from './openingHours.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface OpeningOnDay {
  name: string;
  km: number;
  /** That weekday's hours, or null when closed. */
  hours: string | null;
}

export interface DayNotes {
  notices: string[];
  /** Shops and cafés on the day with known hours, on the planned weekday. */
  opening: OpeningOnDay[];
}

export const weekdayOf = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay();

function applies(notice: Notice, date: string): boolean {
  return (
    (!notice.months || notice.months.includes(Number(date.slice(5, 7)))) &&
    (!notice.weekdays || notice.weekdays.includes(weekdayOf(date))) &&
    (!notice.from || date >= notice.from) &&
    (!notice.to || date <= notice.to)
  );
}

/** "Nov–Mar", "Mon, Wed": values (the first name is value `first`) in cycle order, runs of three or more as ranges. */
function cycleList(values: readonly number[], names: readonly string[], first: number): string {
  const n = names.length;
  const set = new Set(values.map((v) => (((v - first) % n) + n) % n));
  const start = [...Array(n).keys()].find((i) => set.has(i) && !set.has((i - 1 + n) % n)) ?? 0;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const at = (start + i) % n;
    if (!set.has(at) || (i > 0 && set.has((at - 1 + n) % n))) continue;
    let end = at;
    while (set.has((end + 1) % n) && (end + 1) % n !== start) end = (end + 1) % n;
    const span = (end - at + n) % n;
    const name = (k: number): string => names[k];
    parts.push(span >= 2 ? `${name(at)}–${name(end)}` : span === 1 ? `${name(at)}, ${name(end)}` : name(at));
  }
  return parts.join(', ');
}

/** When a notice applies, for showing it without a date: "Nov–Mar", "Mon–Thu until Thu 31 Dec". */
export function noticeWhen(notice: Notice): string {
  return [
    notice.months && cycleList(notice.months, MONTHS, 1),
    notice.weekdays && cycleList(notice.weekdays, WEEKDAYS, 0),
    notice.from && `from ${formatDate(notice.from)}`,
    notice.to && `until ${formatDate(notice.to)}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The trip's notices for the parts of the route a day covers: on a date, those that apply then;
 * without one, all of them with when they apply.
 */
export function dayNotes(model: TripModel, day: Day, date: string | null): DayNotes {
  const notices = (model.bundle.notices ?? [])
    .filter((n) =>
      n.kms.some(([a, b]) => b >= day.startKm && (a < day.endKm || onDay(a, day.startKm, day.endKm))),
    )
    .filter((n) => date === null || applies(n, date))
    .map((n) => {
      const when = date === null ? noticeWhen(n) : '';
      return when ? `${when}: ${n.text}` : n.text;
    });
  const opening: OpeningOnDay[] = [];
  if (date !== null) {
    const weekday = weekdayOf(date);
    const seen = new Set<number>();
    for (const { km, index, poi } of model.stops) {
      if (poi.category !== 'resupply' && poi.category !== 'bike') continue;
      if (!poi.hours || seen.has(index) || !onDay(km, day.startKm, day.endKm)) continue;
      const week = parseOpeningHours(poi.hours);
      if (!week) continue;
      seen.add(index);
      opening.push({ name: poi.name, km, hours: week[weekday] });
    }
  }
  return { notices, opening };
}

export function closedText(opening: readonly OpeningOnDay[], date: string): string | null {
  const closed = opening.filter((o) => o.hours === null).map((o) => o.name);
  return closed.length > 0 ? `Closed on ${WEEKDAY_NAMES[weekdayOf(date)]}s: ${closed.join(', ')}` : null;
}
