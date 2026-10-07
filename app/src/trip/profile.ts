import type { Profile } from '#shared/bundle.ts';
import { haversineM, localProjection, projectOnSegment, type LngLat } from '#shared/geo.ts';

type Column = 'km' | 'hours' | 'climbM' | 'ele' | 'lat' | 'lng';

/** Passes of the route within this distance of the nearest one are told apart by the hint or the movement. */
const PASS_TOLERANCE_M = 40;
/** Matching segments of one pass follow each other; a gap along the route starts another pass. */
const PASS_GAP_KM = 0.05;
/** Smaller moves between positions are GPS noise and say nothing about the direction. */
export const MIN_MOVE_M = 30;
/** Samples on each side of a segment that set the route's direction there; single segments can kink. */
const DIRECTION_SAMPLES = 1;
/** A pass the position moves backwards along counts as this much further away. */
const BACKWARDS_PENALTY_KM = 5;

export interface Position {
  lng: number;
  lat: number;
  km: number;
}

/** The nearest point of one pass, with the direction of the route there (projected metres). */
interface Pass extends RouteSnap {
  dx: number;
  dy: number;
}

const snapOf = ({ index, km, offRouteM }: Pass): RouteSnap => ({ index, km, offRouteM });

export interface RouteSnap {
  index: number;
  km: number;
  offRouteM: number;
}

export class RouteProfile {
  readonly data: Profile;
  readonly length: number;
  readonly totalKm: number;
  readonly totalHours: number;
  readonly totalClimbM: number;

  constructor(data: Profile) {
    this.data = data;
    this.length = data.km.length;
    this.totalKm = data.km[this.length - 1];
    this.totalHours = data.hours[this.length - 1];
    this.totalClimbM = data.climbM[this.length - 1];
  }

  /** First sample index whose (non-decreasing) column value is >= value. */
  indexAt(column: 'km' | 'hours', value: number): number {
    const values = this.data[column];
    let lo = 0;
    let hi = this.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  interpolate(from: 'km' | 'hours', value: number, to: Column): number {
    const i = this.indexAt(from, value);
    if (i <= 0) return this.data[to][0];
    const a = this.data[from][i - 1];
    const b = this.data[from][i];
    const t = b > a ? Math.max(0, Math.min(1, (value - a) / (b - a))) : 0;
    return this.data[to][i - 1] + (this.data[to][i] - this.data[to][i - 1]) * t;
  }

  hoursAtKm(km: number): number {
    return this.interpolate('km', km, 'hours');
  }

  kmAtHours(hours: number): number {
    return this.interpolate('hours', hours, 'km');
  }

  climbAtKm(km: number): number {
    return this.interpolate('km', km, 'climbM');
  }

  lngLatAtKm(km: number): LngLat {
    return [this.interpolate('km', km, 'lng'), this.interpolate('km', km, 'lat')];
  }

  lngLatAt(index: number): LngLat {
    return [this.data.lng[index], this.data.lat[index]];
  }

  /** The nearest point of every pass of the route within PASS_TOLERANCE_M of the nearest pass. */
  private passes(lng: number, lat: number): Pass[] {
    const project = localProjection(lat);
    const [x, y] = project(lng, lat);
    const { km: kms, lng: lngs, lat: lats } = this.data;
    const last = this.length - 1;
    const at = (i: number): [number, number] => project(lngs[i], lats[i]);
    const segments: { i: number; t: number; distance: number }[] = [];
    let best = Infinity;
    let p = at(0);
    for (let i = 0; i < Math.max(1, last); i++) {
      const q = at(Math.min(i + 1, last));
      const { t, distance } = projectOnSegment(x, y, ...p, ...q);
      segments.push({ i, t, distance });
      best = Math.min(best, distance);
      p = q;
    }
    const nearest: (typeof segments)[number][] = [];
    let previousKm = -Infinity;
    for (const segment of segments) {
      if (segment.distance > best + PASS_TOLERANCE_M) continue;
      const current = nearest.at(-1);
      if (current && kms[segment.i] - previousKm <= PASS_GAP_KM) {
        if (segment.distance < current.distance) nearest[nearest.length - 1] = segment;
      } else {
        nearest.push(segment);
      }
      previousKm = kms[Math.min(segment.i + 1, last)];
    }
    return nearest.map(({ i, t, distance }) => {
      const next = Math.min(i + 1, last);
      const [ax, ay] = at(Math.max(0, i - DIRECTION_SAMPLES));
      const [bx, by] = at(Math.min(last, next + DIRECTION_SAMPLES));
      return {
        index: t < 0.5 ? i : next,
        km: kms[i] + (kms[next] - kms[i]) * t,
        offRouteM: distance,
        dx: bx - ax,
        dy: by - ay,
      };
    });
  }

  /** Position on the route; where it passes the same place more than once, the pass nearest to hintKm. */
  snap(lng: number, lat: number, hintKm: number | null): RouteSnap {
    const passes = this.passes(lng, lat);
    const nearest = passes.reduce((a, b) => (b.offRouteM < a.offRouteM ? b : a));
    if (hintKm === null) return snapOf(nearest);
    return snapOf(passes.reduce((a, b) => (Math.abs(b.km - hintKm) < Math.abs(a.km - hintKm) ? b : a)));
  }

  /**
   * A moving position: on stretches the route passes more than once (out-and-backs, loops), the pass nearest
   * along the route to the previous position, where going backwards along a pass counts as far away.
   */
  follow(lng: number, lat: number, previous: Position): RouteSnap {
    const project = localProjection(lat);
    const [x0, y0] = project(previous.lng, previous.lat);
    const [x1, y1] = project(lng, lat);
    const moved = Math.hypot(x1 - x0, y1 - y0) >= MIN_MOVE_M;
    const cost = (p: Pass): number =>
      Math.abs(p.km - previous.km) +
      (moved && p.dx * (x1 - x0) + p.dy * (y1 - y0) < 0 ? BACKWARDS_PENALTY_KM : 0);
    return snapOf(this.passes(lng, lat).reduce((a, b) => (cost(b) < cost(a) ? b : a)));
  }

  /** Grade in percent over halfWindow samples on each side (samples are about 100 m apart). */
  gradeAt(index: number, halfWindow = 2): number {
    const a = Math.max(0, index - halfWindow);
    const b = Math.min(this.length - 1, index + halfWindow);
    const dx = (this.data.km[b] - this.data.km[a]) * 1000;
    return dx < 50 ? 0 : ((this.data.ele[b] - this.data.ele[a]) / dx) * 100;
  }

  /** Modelled moving speed in km/h around a sample. */
  speedAt(index: number): number | null {
    const a = Math.max(0, index - 3);
    const b = Math.min(this.length - 1, index + 3);
    const dh = this.data.hours[b] - this.data.hours[a];
    return dh > 1e-6 ? (this.data.km[b] - this.data.km[a]) / dh : null;
  }
}

/** Follows a moving position (GPS) along the route, judging its direction over at least MIN_MOVE_M. */
export class RouteFollower {
  private readonly profile: RouteProfile;
  private anchor: Position | null = null;

  constructor(profile: RouteProfile) {
    this.profile = profile;
  }

  /** The position on the route; hintKm helps the first one where the route passes more than once. */
  update(lng: number, lat: number, hintKm: number | null): RouteSnap {
    const { anchor } = this;
    const snap = anchor ? this.profile.follow(lng, lat, anchor) : this.profile.snap(lng, lat, hintKm);
    if (!anchor || haversineM(anchor.lat, anchor.lng, lat, lng) >= MIN_MOVE_M)
      this.anchor = { lng, lat, km: snap.km };
    return snap;
  }

  reset(): void {
    this.anchor = null;
  }
}
