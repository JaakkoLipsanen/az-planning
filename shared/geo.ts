export type LngLat = [lng: number, lat: number];

/** West, south, east, north in degrees. */
export type Bounds = [west: number, south: number, east: number, north: number];

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;
export const EARTH_CIRCUMFERENCE_M = 40_075_017;
export const METERS_PER_DEGREE_LAT = 110_574;
const METERS_PER_DEGREE_LNG_AT_EQUATOR = 111_320;

export function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLng = (lng2 - lng1) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function boundsOf(points: Iterable<LngLat>, into?: Bounds): Bounds {
  const b: Bounds = into ? [...into] : [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lng, lat] of points) {
    if (lng < b[0]) b[0] = lng;
    if (lat < b[1]) b[1] = lat;
    if (lng > b[2]) b[2] = lng;
    if (lat > b[3]) b[3] = lat;
  }
  return b;
}

export interface LocalProjection {
  (lng: number, lat: number): [x: number, y: number];
  inverse: (x: number, y: number) => LngLat;
}

/** Local equirectangular projection to metres, accurate enough for distances under ~100 km. */
export function localProjection(originLat: number): LocalProjection {
  const kx = METERS_PER_DEGREE_LNG_AT_EQUATOR * Math.cos(originLat * DEG);
  const project = (lng: number, lat: number): [number, number] => [lng * kx, lat * METERS_PER_DEGREE_LAT];
  return Object.assign(project, {
    inverse: (x: number, y: number): LngLat => [x / kx, y / METERS_PER_DEGREE_LAT],
  });
}

/** Degrees of latitude and longitude that span `meters` around a latitude. */
export function degreesAround(meters: number, lat: number): { dLat: number; dLng: number } {
  const dLat = meters / METERS_PER_DEGREE_LAT;
  return { dLat, dLng: meters / (METERS_PER_DEGREE_LNG_AT_EQUATOR * Math.cos(lat * DEG)) };
}

export interface SegmentProjection {
  /** Position along the segment, 0 at a and 1 at b. */
  t: number;
  distance: number;
}

/** Closest point of segment a-b to p, in planar coordinates. */
export function projectOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): SegmentProjection {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return { t, distance: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) };
}

/** Douglas-Peucker simplification with a tolerance in metres. Returns the indices of the kept points. */
export function simplifyIndices(points: readonly LngLat[], toleranceM: number): number[] {
  const n = points.length;
  if (n < 3) return points.map((_, i) => i);
  const meanLat = points.reduce((sum, p) => sum + p[1], 0) / n;
  const project = localProjection(meanLat);
  const xy = points.map(([lng, lat]) => project(lng, lat));
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
    if (b <= a + 1) continue;
    let maxDist = -1;
    let maxIndex = a;
    for (let i = a + 1; i < b; i++) {
      const { distance } = projectOnSegment(...xy[i], ...xy[a], ...xy[b]);
      if (distance > maxDist) {
        maxDist = distance;
        maxIndex = i;
      }
    }
    if (maxDist > toleranceM) {
      keep[maxIndex] = 1;
      stack.push([a, maxIndex], [maxIndex, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

export function simplify(points: readonly LngLat[], toleranceM: number): LngLat[] {
  return simplifyIndices(points, toleranceM).map((i) => points[i]);
}

/** Elevation gain with a hysteresis threshold, ignoring missing values. */
export function elevationGain(elevations: Iterable<number | null>, thresholdM: number): number {
  let gain = 0;
  let last: number | null = null;
  for (const e of elevations) {
    if (e === null) continue;
    if (last === null) {
      last = e;
      continue;
    }
    const d = e - last;
    if (Math.abs(d) >= thresholdM) {
      if (d > 0) gain += d;
      last = e;
    }
  }
  return gain;
}
