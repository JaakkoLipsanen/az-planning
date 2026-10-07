import { describe, expect, it } from 'vitest';

import { haversineM } from '#shared/geo.ts';

import type { TrackPoint } from '../config/load.ts';
import { PointIndex } from '../geo/spatial.ts';
import { passKms } from './passes.ts';
import type { Route } from './stitch.ts';

/** A route north along a meridian, about 111 m per step of 0.001°. */
function route(lats: number[]): Route {
  const points = lats.map((lat): TrackPoint => ({
    lat,
    lng: -110,
    ele: null,
    text: { lat: String(lat), lon: '-110', ele: '' },
  }));
  const cumM = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++)
    cumM[i] = cumM[i - 1] + haversineM(points[i - 1].lat, -110, points[i].lat, -110);
  return { sections: [], points, sectionOf: new Uint16Array(points.length), cumM };
}

const steps = (from: number, to: number): number[] => {
  const out: number[] = [];
  const step = from < to ? 1 : -1;
  for (let i = from; i !== to + step; i += step) out.push(30 + i * 0.001);
  return out;
};

describe('passKms', () => {
  it('finds each pass of an out-and-back', () => {
    const r = route([...steps(0, 60), ...steps(59, 0)]);
    const kms = passKms(r, new PointIndex(r.points), 30.02, -110, 300);
    expect(kms).toHaveLength(2);
    expect(kms[0]).toBeCloseTo(2.2, 1);
    expect(kms[1]).toBeCloseTo(11.1, 1);
  });

  it('counts the turnaround of an out-and-back as one pass', () => {
    const r = route([...steps(0, 60), ...steps(59, 0)]);
    expect(passKms(r, new PointIndex(r.points), 30.06, -110, 300)).toHaveLength(1);
  });

  it('is empty away from the route', () => {
    const r = route(steps(0, 10));
    expect(passKms(r, new PointIndex(r.points), 31, -110, 300)).toEqual([]);
  });
});
