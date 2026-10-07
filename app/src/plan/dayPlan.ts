import type { LandCategory, Poi } from '#shared/bundle.ts';
import type { LngLat } from '#shared/geo.ts';

import type { TripModel } from '../trip/model.ts';

/** Lower is preferred: hand-picked stops, then campgrounds / lodging from route files, then OpenStreetMap. */
type Priority = 0 | 1 | 2;

const SNAP_WINDOW_SHARE = 0.15;
const MIN_SNAP_WINDOW_H = 0.5;
const PRIORITY_COST_H = 0.3;
const MIN_DAY_KM = 2;
const ROUTE_SEARCH_KM = 8;

export interface OvernightCandidate {
  km: number;
  hours: number;
  lat: number;
  lng: number;
  name: string;
  description: string;
  priority: Priority;
}

export interface Night {
  number: number;
  km: number;
  lat: number;
  lng: number;
  name: string;
  description: string;
  /** True when moved to a listed stop, false for an even split with nothing nearby. */
  snapped: boolean;
  land: LandCategory | null;
}

export interface Day {
  number: number;
  startKm: number;
  endKm: number;
  km: number;
  climbM: number;
  hours: number;
  /** Singletrack / unpaved / paved share in percent (sums to 100) and km. */
  surfacePct: [number, number, number];
  surfaceKm: [number, number, number];
  highM: number;
  lowM: number;
  resupply: string[];
  waterPoints: number;
  from: string;
  to: string;
  night: Night | null;
  coords: LngLat[];
  mid: LngLat;
}

export interface DayPlan {
  count: number;
  hoursPerDay: number;
  days: Day[];
  nights: Night[];
}

function candidateName(p: Poi): string {
  if (!/^(campground|camp ?site|camping|camp)$/i.test(p.name.trim())) return p.name;
  const operator = /operator: ([^,]+)/.exec(p.description ?? '')?.[1];
  const base = /backcountry: yes/.test(p.description ?? '') ? 'Backcountry campsite' : 'Campground';
  return `${base}${operator ? ` (${operator})` : ''} at km ${(p.km ?? 0).toFixed(0)}`;
}

export function overnightCandidates(model: TripModel): OvernightCandidate[] {
  const { profile } = model;
  const out: OvernightCandidate[] = (model.bundle.plan?.overnights ?? []).map((o) => ({
    km: o.km,
    hours: profile.hoursAtKm(o.km),
    lat: o.lat,
    lng: o.lng,
    name: o.name,
    description: 'One of the hand-picked overnight stops.',
    priority: 0,
  }));
  for (const p of model.pois) {
    if (p.km === undefined || (p.category !== 'camp' && p.category !== 'lodging')) continue;
    out.push({
      km: p.km,
      hours: profile.hoursAtKm(p.km),
      lat: p.lat,
      lng: p.lng,
      name: candidateName(p),
      description: `${p.description ?? ''}${p.osm ? ' (OpenStreetMap - unverified)' : ` (${p.source})`}`,
      priority: p.osm ? 2 : 1,
    });
  }
  return out;
}

/** Index of the route vertex for a profile km, searched near that chainage so out-and-back stretches resolve correctly. */
function routeIndexAtKm(model: TripModel, km: number): number {
  const { coords, km: routeKm } = model.route;
  const [lng, lat] = model.profile.lngLatAtKm(km);
  const cos = Math.cos((lat * Math.PI) / 180);
  let lo = 0;
  let hi = routeKm.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (routeKm[mid] < km - ROUTE_SEARCH_KM) lo = mid + 1;
    else hi = mid;
  }
  let best = -1;
  let bestD = Infinity;
  for (let i = lo; i < routeKm.length && routeKm[i] <= km + ROUTE_SEARCH_KM; i++) {
    const d = ((coords[i][0] - lng) * cos) ** 2 + (coords[i][1] - lat) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best < 0 ? Math.min(lo, coords.length - 1) : best;
}

function placeNight(
  model: TripModel,
  candidates: readonly OvernightCandidate[],
  target: number,
  window: number,
  prevKm: number,
): Omit<Night, 'number' | 'land'> {
  const { profile } = model;
  let best: OvernightCandidate | null = null;
  let bestCost = Infinity;
  for (const c of candidates) {
    const dh = Math.abs(c.hours - target);
    if (dh > window || c.km <= prevKm + MIN_DAY_KM) continue;
    const cost = dh + PRIORITY_COST_H * c.priority;
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }
  if (best)
    return {
      km: best.km,
      lat: best.lat,
      lng: best.lng,
      name: best.name,
      description: best.description,
      snapped: true,
    };

  const km = profile.kmAtHours(target);
  const [lng, lat] = profile.lngLatAtKm(km);
  const nearest = candidates.reduce<OvernightCandidate | null>(
    (a, c) => (!a || Math.abs(c.km - km) < Math.abs(a.km - km) ? c : a),
    null,
  );
  const nearestText = nearest
    ? ` Nearest listed stop: ${nearest.name} at km ${nearest.km.toFixed(0)} (${Math.abs(nearest.km - km).toFixed(0)} km ${nearest.km < km ? 'back' : 'further'}, ${Math.abs(nearest.hours - target).toFixed(1)} h).`
    : '';
  const rounded = Math.round(km * 10) / 10;
  return {
    km: rounded,
    lat,
    lng,
    name: `Own choice near route km ${rounded}`,
    description: `No campground or lodging within ±${window.toFixed(1)} h of an even split. Wild camp near here where the land allows (see land owner), or use a town / stop nearby and shift the day.${nearestText}`,
    snapped: false,
  };
}

function dayStats(
  model: TripModel,
  a: number,
  b: number,
): Pick<Day, 'surfaceKm' | 'surfacePct' | 'highM' | 'lowM'> {
  const { data } = model.profile;
  const surfaceKm: [number, number, number] = [0, 0, 0];
  let highM = -Infinity;
  let lowM = Infinity;
  const i0 = model.profile.indexAt('km', a);
  const i1 = model.profile.indexAt('km', b);
  for (let i = Math.max(1, i0); i <= i1 && i < model.profile.length; i++) {
    const x0 = Math.max(a, data.km[i - 1]);
    const x1 = Math.min(b, data.km[i]);
    if (x1 > x0) surfaceKm[data.surface[i]] += x1 - x0;
    highM = Math.max(highM, data.ele[i]);
    lowM = Math.min(lowM, data.ele[i]);
  }
  const total = surfaceKm[0] + surfaceKm[1] + surfaceKm[2] || 1;
  const surfacePct = surfaceKm.map((v) => Math.round((v / total) * 100)) as [number, number, number];
  surfacePct[surfaceKm.indexOf(Math.max(...surfaceKm))] +=
    100 - surfacePct[0] - surfacePct[1] - surfacePct[2];
  return { surfaceKm, surfacePct, highM, lowM };
}

function poisOnDay(model: TripModel, a: number, b: number): Pick<Day, 'resupply' | 'waterPoints'> {
  const resupply: string[] = [];
  let waterPoints = 0;
  for (const p of model.pois) {
    if (p.km === undefined || p.osm || p.km <= a || p.km > b) continue;
    if (p.category === 'water') waterPoints++;
    if (p.category === 'resupply') {
      const name = p.name.split(/[:(,]/)[0].trim();
      if (!resupply.includes(name)) resupply.push(name);
    }
  }
  return { resupply, waterPoints };
}

/** Splits the route into `count` days of equal moving time, moving each night to the best stop within ±15 % of a day. */
export function computePlan(
  model: TripModel,
  candidates: readonly OvernightCandidate[],
  count: number,
): DayPlan {
  const { profile } = model;
  const settings = model.bundle.plan;
  const hoursPerDay = profile.totalHours / count;
  const window = Math.max(MIN_SNAP_WINDOW_H, SNAP_WINDOW_SHARE * hoursPerDay);
  const nights: Night[] = [];
  let prevKm = 0;
  for (let k = 1; k < count; k++) {
    const target = k * hoursPerDay;
    let night = placeNight(model, candidates, target, window, prevKm);
    if (night.km <= prevKm) {
      const km = Math.min(Math.max(profile.kmAtHours(target), prevKm + MIN_DAY_KM), profile.totalKm);
      const [lng, lat] = profile.lngLatAtKm(km);
      night = { km, lat, lng, name: `Near route km ${km.toFixed(1)}`, description: '', snapped: false };
    }
    nights.push({ ...night, number: k, land: model.landAt(night.lng, night.lat) });
    prevKm = night.km;
  }

  const bounds = [0, ...nights.map((n) => n.km), profile.totalKm];
  const days: Day[] = [];
  for (let d = 0; d < count; d++) {
    const a = bounds[d];
    const b = bounds[d + 1];
    const ia = routeIndexAtKm(model, a);
    const ib = d === count - 1 ? model.route.coords.length - 1 : routeIndexAtKm(model, b);
    days.push({
      number: d + 1,
      startKm: a,
      endKm: b,
      km: b - a,
      climbM: profile.climbAtKm(b) - profile.climbAtKm(a),
      hours: profile.hoursAtKm(b) - profile.hoursAtKm(a),
      ...dayStats(model, a, b),
      ...poisOnDay(model, a, b),
      from: d === 0 ? (settings?.start ?? 'Start') : nights[d - 1].name,
      to: d === count - 1 ? (settings?.finish ?? 'Finish') : nights[d].name,
      night: nights[d] ?? null,
      coords: model.route.coords.slice(Math.min(ia, ib), Math.max(ia, ib) + 1),
      mid: profile.lngLatAtKm((a + b) / 2),
    });
  }
  return { count, hoursPerDay, days, nights };
}

export function dayAtKm(plan: DayPlan, km: number): Day {
  return plan.days.find((d) => km <= d.endKm + 1e-6) ?? plan.days[plan.days.length - 1];
}

export interface DayProgress {
  day: Day;
  doneKm: number;
  hoursLeft: number;
}

/** Where a route km falls in the day plan: the day, the distance ridden that day and the moving time left. */
export function dayProgress(model: TripModel, plan: DayPlan, km: number): DayProgress {
  const day = dayAtKm(plan, km);
  return {
    day,
    doneKm: Math.max(0, km - day.startKm),
    hoursLeft: Math.max(0, model.profile.hoursAtKm(day.endKm) - model.profile.hoursAtKm(km)),
  };
}
