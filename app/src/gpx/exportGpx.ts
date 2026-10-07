import { haversineM } from '#shared/geo.ts';
import { GPX_SYMBOLS, parseTrackPoints, writeGpx, type GpxPoint, type GpxWaypoint } from '#shared/gpx.ts';

import { formatHours } from '../lib/format.ts';
import type { Day, DayPlan } from '../plan/dayPlan.ts';
import { fetchTripText } from '../trip/loadTrip.ts';
import type { TripModel } from '../trip/model.ts';
import { makeZip } from './zip.ts';

interface FullTrack {
  points: GpxPoint[];
  km: Float64Array;
}

const tracks = new WeakMap<TripModel, Promise<FullTrack>>();

/** The route's full-resolution track, parsed once from the full GPX file. */
function fullTrack(model: TripModel): Promise<FullTrack> {
  let track = tracks.get(model);
  if (!track) {
    const file = model.bundle.files?.gpxFull;
    if (!file) return Promise.reject(new Error('This trip has no GPX file.'));
    track = fetchTripText(model.bundle, file).then((xml) => {
      const points = parseTrackPoints(xml);
      const km = new Float64Array(points.length);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        km[i] = km[i - 1] + haversineM(Number(a.lat), Number(a.lon), Number(b.lat), Number(b.lon)) / 1000;
      }
      return { points, km };
    });
    track.catch(() => tracks.delete(model));
    tracks.set(model, track);
  }
  return track;
}

function lastAtOrBefore(km: Float64Array, value: number): number {
  let lo = 0;
  let hi = km.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (km[mid] <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function firstAtOrAfter(km: Float64Array, value: number): number {
  let lo = 0;
  let hi = km.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (km[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function dayStatsText(day: Day): string {
  return `${Math.round(day.km)} km, +${Math.round(day.climbM)} m, ${formatHours(day.hours)} moving (estimate); trail ${day.surfacePct[0]}% / dirt ${day.surfacePct[1]}% / paved ${day.surfacePct[2]}%. Route km ${day.startKm.toFixed(1)}-${day.endKm.toFixed(1)}.`;
}

function dayFileName(model: TripModel, plan: DayPlan, day: Day): string {
  return `${model.bundle.slug}_${plan.count}days_day${String(day.number).padStart(2, '0')}_km${Math.round(day.startKm)}-${Math.round(day.endKm)}.gpx`;
}

function dayGpx(model: TripModel, plan: DayPlan, track: FullTrack, day: Day): string {
  const first = lastAtOrBefore(track.km, day.startKm + 1e-6);
  const last =
    day.number === plan.count ? track.points.length - 1 : firstAtOrAfter(track.km, day.endKm - 1e-6);
  const stats = dayStatsText(day);
  const title = `${model.bundle.shortName} - Day ${day.number} of ${plan.count}`;
  const waypoints: GpxWaypoint[] = [];
  const previous = day.number > 1 ? plan.nights[day.number - 2] : null;
  if (previous) {
    waypoints.push({
      lat: previous.lat,
      lng: previous.lng,
      name: `Start D${day.number}: ${previous.name.slice(0, 60)}`,
      description: previous.description,
      symbol: 'Campground',
      type: 'night',
    });
  }
  const listed = new Set<number>();
  for (const { km, index, poi: p } of model.stops) {
    if (p.osm || listed.has(index) || km < day.startKm - 0.05 || km > day.endKm + 0.05) continue;
    listed.add(index);
    waypoints.push({
      lat: p.lat,
      lng: p.lng,
      name: p.name,
      description: `${p.description ? `${p.description} ` : ''}[route km ${km.toFixed(1)}; ${p.source}]`,
      symbol: GPX_SYMBOLS[p.category],
      type: p.category,
    });
  }
  if (day.night) {
    const land = day.night.land ? ` Land: ${day.night.land.label}.` : '';
    waypoints.push({
      lat: day.night.lat,
      lng: day.night.lng,
      name: `Night ${day.number}: ${day.night.name.slice(0, 60)}`,
      description: day.night.description + land,
      symbol: 'Campground',
      type: 'night',
    });
  }
  return writeGpx({
    name: title,
    description: `${stats} From: ${day.from}. To: ${day.to}.`,
    creator: model.bundle.title,
    waypoints,
    tracks: [{ name: title, description: stats, points: track.points.slice(first, last + 1) }],
  });
}

function saveBlob(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 4000);
}

/** Saves a GPX of the trip and resolves to a status message. */
export async function exportRouteGpx(model: TripModel, kind: 'full' | 'sections'): Promise<string> {
  const file = kind === 'full' ? model.bundle.files?.gpxFull : model.bundle.files?.gpxSections;
  if (!file) throw new Error('This trip has no GPX file.');
  const text = await fetchTripText(model.bundle, file);
  saveBlob(new Blob([text], { type: 'application/gpx+xml' }), file);
  return `Saved ${file}.`;
}

export async function exportDayGpx(model: TripModel, plan: DayPlan, day: Day): Promise<string> {
  const name = dayFileName(model, plan, day);
  saveBlob(
    new Blob([dayGpx(model, plan, await fullTrack(model), day)], { type: 'application/gpx+xml' }),
    name,
  );
  return `Saved ${name}.`;
}

export async function exportAllDaysGpx(model: TripModel, plan: DayPlan): Promise<string> {
  const track = await fullTrack(model);
  const zip = await makeZip(
    plan.days.map((day) => ({ name: dayFileName(model, plan, day), text: dayGpx(model, plan, track, day) })),
  );
  const name = `${model.bundle.slug}_${plan.count}days_all_days_gpx.zip`;
  saveBlob(zip, name);
  return `Saved ${name}.`;
}
