import type { LngLat } from './geo.ts';

const PRECISION = 1e5;

function encodeSigned(value: number, out: string[]): void {
  let v = value < 0 ? ~(value << 1) : value << 1;
  while (v >= 0x20) {
    out.push(String.fromCharCode((0x20 | (v & 0x1f)) + 63));
    v >>= 5;
  }
  out.push(String.fromCharCode(v + 63));
}

function decodeSigned(s: string, start: number): [value: number, next: number] {
  let shift = 0;
  let result = 0;
  let i = start;
  let byte: number;
  do {
    byte = s.charCodeAt(i++) - 63;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);
  return [result & 1 ? ~(result >> 1) : result >> 1, i];
}

/** Google encoded polyline (precision 5) of [lng, lat] points. */
export function encodePolyline(points: readonly LngLat[]): string {
  const out: string[] = [];
  let prevLat = 0;
  let prevLng = 0;
  for (const [lng, lat] of points) {
    const iLat = Math.round(lat * PRECISION);
    const iLng = Math.round(lng * PRECISION);
    encodeSigned(iLat - prevLat, out);
    encodeSigned(iLng - prevLng, out);
    prevLat = iLat;
    prevLng = iLng;
  }
  return out.join('');
}

export function decodePolyline(s: string): LngLat[] {
  const out: LngLat[] = [];
  let lat = 0;
  let lng = 0;
  let i = 0;
  while (i < s.length) {
    const [dLat, afterLat] = decodeSigned(s, i);
    const [dLng, afterLng] = decodeSigned(s, afterLat);
    i = afterLng;
    lat += dLat;
    lng += dLng;
    out.push([lng / PRECISION, lat / PRECISION]);
  }
  return out;
}

/** Delta-encoded integer series using the polyline alphabet. */
export function encodeIntegers(values: readonly number[]): string {
  const out: string[] = [];
  let prev = 0;
  for (const value of values) {
    const v = Math.round(value);
    encodeSigned(v - prev, out);
    prev = v;
  }
  return out.join('');
}

export function decodeIntegers(s: string): number[] {
  const out: number[] = [];
  let value = 0;
  let i = 0;
  while (i < s.length) {
    const [delta, next] = decodeSigned(s, i);
    i = next;
    value += delta;
    out.push(value);
  }
  return out;
}
