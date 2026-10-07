import type { ClimateLayer } from '#shared/bundle.ts';
import { dayOfYear } from '#shared/climate.ts';
import type { Bounds } from '#shared/geo.ts';

import type { TripSettings } from '../state/tripStore.ts';
import type { TripModel } from '../trip/model.ts';
import { elevationAt } from './elevation.ts';
import { temperatureAt } from './field.ts';
import { sunTimes } from './sun.ts';
import { zonedInstant } from './time.ts';

type OverlaySettings = Pick<TripSettings, 'overlayDate' | 'startDate' | 'overlayHour'>;

/** The date the temperature overlay shows: chosen for it, else the trip's start date, else today. */
export function overlayDate(settings: Pick<TripSettings, 'overlayDate' | 'startDate'>): string {
  return settings.overlayDate ?? settings.startDate ?? new Date().toISOString().slice(0, 10);
}

/** The area the climate grid covers, so the map requests overlay tiles only there. */
export function climateBounds(layer: ClimateLayer): Bounds {
  const { lng: dx, lat: dy } = layer.cellSize;
  const lngs = layer.cells.map((c) => c.lng);
  const lats = layer.cells.map((c) => c.lat);
  return [
    Math.min(...lngs) - dx / 2,
    Math.min(...lats) - dy / 2,
    Math.max(...lngs) + dx / 2,
    Math.max(...lats) + dy / 2,
  ];
}

export interface PointTemperature {
  celsius: number;
  /** Elevation the temperature was adjusted to, m. */
  ele: number;
  date: string;
  hour: number;
}

/** The typical temperature the overlay shows at a point, from the terrain tile of the zoom level on screen. */
export async function temperatureHere(
  model: TripModel,
  settings: OverlaySettings,
  [lng, lat]: [number, number],
  zoom: number,
): Promise<PointTemperature | null> {
  if (!model.climate) return null;
  const ele = await elevationAt(lng, lat, zoom);
  if (ele === null) return null;
  const date = overlayDate(settings);
  const c = model.climate.at(lng, lat, Math.max(0, ele), dayOfYear(date));
  if (!c) return null;
  const instant = zonedInstant(date, settings.overlayHour, model.timeZone);
  return {
    celsius: temperatureAt(c.tMin, c.tMax, sunTimes(date, lat, lng), instant),
    ele: Math.round(ele),
    date,
    hour: settings.overlayHour,
  };
}
