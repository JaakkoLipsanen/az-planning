import Flatbush from 'flatbush';

import { haversineM, localProjection, type LatLng, type LocalProjection } from '#shared/geo.ts';

/** Candidates ranked in the projection before the exact distance picks one; keeps far-north routes accurate. */
const CANDIDATES = 8;

export interface Nearest {
  index: number;
  distanceM: number;
}

export class PointIndex {
  private readonly points: readonly LatLng[];
  private readonly index: Flatbush;
  private readonly project: LocalProjection;

  constructor(points: readonly LatLng[]) {
    if (points.length === 0) throw new Error('PointIndex needs at least one point');
    this.points = points;
    const meanLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
    this.project = localProjection(meanLat);
    this.index = new Flatbush(points.length);
    for (const p of points) {
      const [x, y] = this.project(p.lng, p.lat);
      this.index.add(x, y);
    }
    this.index.finish();
  }

  /** Nearest point, optionally only among indices in [from, to]. */
  nearest(lat: number, lng: number, from = 0, to = this.points.length - 1): Nearest {
    const [x, y] = this.project(lng, lat);
    const candidates = this.index.neighbors(x, y, CANDIDATES, Infinity, (i) => i >= from && i <= to);
    let best: Nearest = { index: from, distanceM: Infinity };
    for (const index of candidates) {
      const p = this.points[index];
      const distanceM = haversineM(lat, lng, p.lat, p.lng);
      if (distanceM < best.distanceM) best = { index, distanceM };
    }
    return best;
  }

  /** Indices of all points within radiusM, in index order. */
  within(lat: number, lng: number, radiusM: number): number[] {
    const [x, y] = this.project(lng, lat);
    return this.index
      .neighbors(x, y, Infinity, radiusM * 1.01)
      .filter((i) => haversineM(lat, lng, this.points[i].lat, this.points[i].lng) <= radiusM)
      .toSorted((a, b) => a - b);
  }
}
