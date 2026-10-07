import type { Profile } from '#shared/bundle.ts';
import { localProjection, projectOnSegment, type LngLat } from '#shared/geo.ts';

type Column = 'km' | 'hours' | 'climbM' | 'ele' | 'lat' | 'lng';

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

  /** Position on the route; near hintKm the route is preferred, which keeps out-and-back stretches continuous. */
  snap(lng: number, lat: number, hintKm: number | null): RouteSnap {
    const project = localProjection(lat);
    const [x, y] = project(lng, lat);
    const dist2 = (i: number): number => {
      const [px, py] = project(this.data.lng[i], this.data.lat[i]);
      return (px - x) ** 2 + (py - y) ** 2;
    };
    let best = 0;
    let bestD = Infinity;
    let hinted = -1;
    let hintedD = Infinity;
    for (let i = 0; i < this.length; i++) {
      const d = dist2(i);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
      if (hintKm !== null && Math.abs(this.data.km[i] - hintKm) < 30 && d < hintedD) {
        hintedD = d;
        hinted = i;
      }
    }
    const k = hinted >= 0 && Math.sqrt(hintedD) < Math.sqrt(bestD) + 150 ? hinted : best;
    let km = this.data.km[k];
    let offRouteM = Math.sqrt(dist2(k));
    const at = (i: number): [number, number] => project(this.data.lng[i], this.data.lat[i]);
    for (const [a, b] of [
      [k - 1, k],
      [k, k + 1],
    ]) {
      if (a < 0 || b >= this.length) continue;
      const { t, distance } = projectOnSegment(x, y, ...at(a), ...at(b));
      if (distance < offRouteM) {
        offRouteM = distance;
        km = this.data.km[a] + (this.data.km[b] - this.data.km[a]) * t;
      }
    }
    return { index: k, km, offRouteM };
  }

  /** Grade in percent over about ±200 m. */
  gradeAt(index: number): number {
    const a = Math.max(0, index - 2);
    const b = Math.min(this.length - 1, index + 2);
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

  elevationRange(): [min: number, max: number] {
    let min = Infinity;
    let max = -Infinity;
    for (const e of this.data.ele) {
      if (e < min) min = e;
      if (e > max) max = e;
    }
    return [min, max];
  }
}
