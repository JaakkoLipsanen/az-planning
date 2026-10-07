import { describe, expect, it } from 'vitest';

import type { Profile } from '#shared/bundle.ts';

import { RouteFollower, RouteProfile } from './profile.ts';

const KM_PER_DEGREE = 111.2;

/** 10 km north and the same way back, a sample every 100 m. */
function outAndBack(): RouteProfile {
  const km = Array.from({ length: 201 }, (_, i) => i / 10);
  const lat = km.map((k) => 30 + (k <= 10 ? k : 20 - k) / KM_PER_DEGREE);
  return new RouteProfile({
    km,
    lat,
    lng: km.map(() => -110),
    ele: km.map(() => 0),
    section: km.map(() => 0),
    surface: km.map(() => 0),
    climbM: km.map(() => 0),
    hours: km.map((k) => k / 10),
  } satisfies Profile);
}

/** A point beside the route at a distance north of the start. */
function at(km: number): [number, number] {
  return [-110.00002, 30 + km / KM_PER_DEGREE];
}

describe('RouteProfile.snap', () => {
  const profile = outAndBack();

  it('follows an out-and-back forward instead of going back along the other leg', () => {
    const follower = new RouteFollower(profile);
    follower.update(...at(9), 9);
    for (let trueKm = 9.01; trueKm < 19.5; trueKm += 0.01) {
      const s = follower.update(...at(trueKm <= 10 ? trueKm : 20 - trueKm), null);
      // Both legs meet at the turnaround, so the position may lag there for a moment.
      expect(Math.abs(s.km - trueKm)).toBeLessThan(Math.abs(trueKm - 10) < 0.5 ? 0.35 : 0.05);
    }
  });

  it('keeps the pass while standing still', () => {
    const [lng, lat] = at(3);
    expect(profile.follow(lng, lat, { lng, lat, km: 17 }).km).toBeCloseTo(17, 1);
  });

  it('takes the pass nearest to a hint', () => {
    expect(profile.snap(...at(3), 2).km).toBeCloseTo(3, 1);
    expect(profile.snap(...at(3), 15).km).toBeCloseTo(17, 1);
  });

  it('measures the distance to the route', () => {
    const s = profile.snap(-110.01, 30 + 5 / KM_PER_DEGREE, null);
    expect(s.offRouteM).toBeCloseTo(963, -1);
  });
});
