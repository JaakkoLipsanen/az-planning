import { SURFACES, type Profile, type SurfaceIndex } from '#shared/bundle.ts';
import { round } from '#shared/geo.ts';

import type { SectionConfig, TripConfig } from '../config/schema.ts';
import type { Route } from './stitch.ts';

const SAMPLE_SPACING_M = 100;
const CLIMB_THRESHOLD_M = 5;

export interface SectionTotals {
  climbM: number;
  movingHours: number;
}

export interface ProfileResult {
  profile: Profile;
  sections: SectionTotals[];
}

interface Speed {
  kmh: number;
  climbRate: number;
}

function speedFor(surface: SurfaceIndex, section: SectionConfig, config: TripConfig): Speed {
  if (section.speed) return section.speed;
  const name = SURFACES[surface];
  const climbRate = config.speed.climbRates[name];
  if (name === 'paved') return { kmh: config.speed.pavedKmh, climbRate };
  const kmh = config.kinds[section.kind].speed?.[name] ?? config.speed.fallbackKmh[name];
  return { kmh, climbRate };
}

/** Cumulative climb per route point, with the hysteresis restarting at every section. */
function cumulativeClimb(route: Route, elevations: readonly number[]): Float64Array {
  const out = new Float64Array(route.points.length);
  let total = 0;
  let last = elevations[0];
  for (let i = 0; i < out.length; i++) {
    if (i > 0 && route.sectionOf[i] !== route.sectionOf[i - 1]) last = elevations[i];
    const d = elevations[i] - last;
    if (Math.abs(d) >= CLIMB_THRESHOLD_M) {
      if (d > 0) total += d;
      last = elevations[i];
    }
    out[i] = total;
  }
  return out;
}

function sectionClimbs(route: Route, climb: Float64Array): number[] {
  const lastIndex = route.sections.map(() => -1);
  route.sectionOf.forEach((section, i) => {
    lastIndex[section] = i;
  });
  let previous = 0;
  return lastIndex.map((i) => {
    if (i < 0) return 0;
    const sectionClimb = climb[i] - previous;
    previous = climb[i];
    return sectionClimb;
  });
}

/** The first point past every SAMPLE_SPACING_M, plus both ends. */
function sampleIndices(cumM: Float64Array): number[] {
  const out = [0];
  let next = SAMPLE_SPACING_M;
  for (let i = 1; i < cumM.length - 1; i++) {
    if (cumM[i] < next) continue;
    out.push(i);
    next = (Math.floor(cumM[i] / SAMPLE_SPACING_M) + 1) * SAMPLE_SPACING_M;
  }
  if (cumM.length > 1) out.push(cumM.length - 1);
  return out;
}

/** Profile samples with surface-aware moving time: hours = km / speed + climb / climbing rate. */
export function buildProfile(
  route: Route,
  elevations: readonly number[],
  surfaces: Uint8Array,
  config: TripConfig,
): ProfileResult {
  const climb = cumulativeClimb(route, elevations);
  const samples = sampleIndices(route.cumM);
  const sections = sectionClimbs(route, climb).map((climbM) => ({ climbM, movingHours: 0 }));
  const profile: Profile = {
    km: [],
    ele: [],
    lat: [],
    lng: [],
    section: [],
    surface: [],
    climbM: [],
    hours: [],
  };
  let hours = 0;
  samples.forEach((i, k) => {
    const section = route.sectionOf[i];
    const surface = surfaces[i] as SurfaceIndex;
    if (k > 0) {
      const prev = samples[k - 1];
      const speed = speedFor(surface, route.sections[section].config, config);
      const dKm = (route.cumM[i] - route.cumM[prev]) / 1000;
      const dClimb = climb[i] - climb[prev];
      const dHours = dKm / speed.kmh + dClimb / speed.climbRate;
      hours += dHours;
      sections[section].movingHours += dHours;
    }
    const p = route.points[i];
    profile.km.push(round(route.cumM[i] / 1000, 2));
    profile.ele.push(Math.round(elevations[i]));
    profile.lat.push(round(p.lat, 5));
    profile.lng.push(round(p.lng, 5));
    profile.section.push(section);
    profile.surface.push(surface);
    profile.climbM.push(Math.round(climb[i]));
    profile.hours.push(round(hours, 3));
  });
  return { profile, sections };
}
