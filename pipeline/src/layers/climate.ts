import type { ClimateCell, ClimateLayer } from '#shared/bundle.ts';
import { CLIMATE_WEEKS, dayDistance, dayOfYear, weekCentreDay } from '#shared/climate.ts';
import { round, type LngLat } from '#shared/geo.ts';
import { encodeIntegers } from '#shared/polyline.ts';

import { log } from '../log.ts';
import { mapLimit } from '../net/http.ts';
import { POWER_CELL, powerDaily, type PowerDay } from '../net/power.ts';

/** Days on each side of a week's centre that count towards it; wider than a week to smooth year-to-year noise. */
const WINDOW_DAYS = 7;
const WET_DAY_MM = 1;
const CLEAR_BELOW = 25;
const CLOUDY_ABOVE = 75;
const SOURCE = 'NASA POWER (MERRA-2 temperature and precipitation, CERES cloud cover)';

function cellCentre(lng: number, lat: number): LngLat {
  return [
    round(Math.round(lng / POWER_CELL.lng) * POWER_CELL.lng, 4),
    round(Math.round(lat / POWER_CELL.lat) * POWER_CELL.lat, 4),
  ];
}

/** The grid cells the lines pass through and their neighbours, so values can be interpolated anywhere near them. */
export function cellsNear(lines: readonly LngLat[][]): LngLat[] {
  const cells = new Map<string, LngLat>();
  for (const line of lines) {
    for (const [lng, lat] of line) {
      for (const dx of [-1, 0, 1]) {
        for (const dy of [-1, 0, 1]) {
          const cell = cellCentre(lng + dx * POWER_CELL.lng, lat + dy * POWER_CELL.lat);
          cells.set(cell.join(','), cell);
        }
      }
    }
  }
  return [...cells.values()].toSorted((a, b) => a[1] - b[1] || a[0] - b[0]);
}

const mean = (values: readonly number[]): number => values.reduce((s, v) => s + v, 0) / (values.length || 1);
const share = (days: readonly PowerDay[], test: (d: PowerDay) => boolean): number =>
  Math.round((100 * days.filter(test).length) / (days.length || 1));

/** Weekly climate of one cell from its daily record. */
export function weeklyClimate(days: readonly PowerDay[]): Omit<ClimateCell, 'lat' | 'lng' | 'ele'> {
  const byDay = Array.from({ length: 365 }, (): PowerDay[] => []);
  for (const day of days) byDay[dayOfYear(day.date)].push(day);
  const weeks = Array.from({ length: CLIMATE_WEEKS }, (_, week) => {
    const centre = weekCentreDay(week);
    return byDay.filter((_days, d) => dayDistance(d, centre) <= WINDOW_DAYS).flat();
  });
  const series = (pick: (week: PowerDay[]) => number): string => encodeIntegers(weeks.map(pick));
  return {
    tMin: series((w) => mean(w.map((d) => d.tMin)) * 10),
    tMax: series((w) => mean(w.map((d) => d.tMax)) * 10),
    wet: series((w) => share(w, (d) => d.rain >= WET_DAY_MM)),
    rain: series((w) => mean(w.map((d) => d.rain)) * 10),
    clear: series((w) => share(w, (d) => d.cloud < CLEAR_BELOW)),
    cloudy: series((w) => share(w, (d) => d.cloud > CLOUDY_ABOVE)),
  };
}

/** Weekly climate of the grid cells around the lines, from NASA POWER daily data over the given years. */
export async function buildClimateLayer(
  lines: readonly LngLat[][],
  years: [number, number],
): Promise<ClimateLayer> {
  const centres = cellsNear(lines);
  log.info(`${centres.length} climate cells, ${years[0]}-${years[1]}`);
  const cells = await mapLimit(centres, 4, async ([lng, lat]): Promise<ClimateCell> => {
    const series = await powerDaily(lat, lng, years);
    return { lat, lng, ele: Math.round(series.elevation), ...weeklyClimate(series.days) };
  });
  return {
    source: SOURCE,
    years,
    cellSize: POWER_CELL,
    wetDayMm: WET_DAY_MM,
    cloud: { clearBelow: CLEAR_BELOW, cloudyAbove: CLOUDY_ABOVE },
    cells,
  };
}
