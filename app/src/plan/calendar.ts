import { addDays } from '../climate/time.ts';

export interface RestDay {
  /** The night it follows: the rider stays a second night there. */
  night: number;
  date: string;
}

/** Dates of the riding days and the rest days between them. */
export interface TripCalendar {
  /** Date of each riding day, by day number - 1. */
  dates: string[];
  rests: RestDay[];
  end: string;
}

/** Rest days only count after nights that exist with this many days. */
export function usableRestDays(restDays: readonly number[], count: number): number[] {
  return [...new Set(restDays)].filter((night) => night >= 1 && night < count).toSorted((a, b) => a - b);
}

export function tripCalendar(startDate: string, count: number, restDays: readonly number[]): TripCalendar {
  const rests = usableRestDays(restDays, count);
  const dates: string[] = [];
  const restDates: RestDay[] = [];
  let offset = 0;
  for (let day = 1; day <= count; day++) {
    dates.push(addDays(startDate, day - 1 + offset));
    if (rests.includes(day)) {
      offset++;
      restDates.push({ night: day, date: addDays(startDate, day - 1 + offset) });
    }
  }
  return { dates, rests: restDates, end: dates.at(-1) ?? startDate };
}

/** The riding day on a date; on a rest day, the day after it. Null outside the trip. */
export function dayOnDate(calendar: TripCalendar, date: string): number | null {
  if (date < calendar.dates[0] || date > calendar.end) return null;
  const index = calendar.dates.findIndex((d) => d >= date);
  return index < 0 ? null : index + 1;
}
