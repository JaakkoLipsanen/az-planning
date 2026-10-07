/** Climate values are stored per week of a 365-day year; week k is centred on day 7k + 3 (0-based). */
export const CLIMATE_WEEKS = 52;

export function weekCentreDay(week: number): number {
  return 7 * week + 3;
}

const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** 0-based day of a 365-day year for an ISO date (YYYY-MM-DD or YYYYMMDD); 29 February counts as 28 February. */
export function dayOfYear(date: string): number {
  const digits = date.replaceAll('-', '');
  const month = Number(digits.slice(4, 6));
  const day = Math.min(Number(digits.slice(6, 8)), month === 2 ? 28 : 31);
  return MONTH_START[month - 1] + day - 1;
}

/** Shortest distance between two days of the year, across the new year. */
export function dayDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 365;
  return Math.min(d, 365 - d);
}
