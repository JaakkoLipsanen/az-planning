import { describe, expect, it } from 'vitest';

import type { Trip, TrackPoint } from '../config/load.ts';
import type { SectionConfig } from '../config/schema.ts';
import { sliceTrack, stitchRoute } from './stitch.ts';

function point(lat: number): TrackPoint {
  return { lat, lng: -110, ele: null, text: { lat: String(lat), lon: '-110', ele: '' } };
}

function section(id: string, track: string, range?: [number, number], reverse = false): SectionConfig {
  return { id, name: id, kind: 'trail', parts: [{ track, range, reverse }] };
}

function trip(sections: SectionConfig[]): Trip {
  return {
    slug: 'test',
    dir: '',
    tracks: new Map([
      ['a', [30, 30.001, 30.002, 30.003].map(point)],
      ['b', [30.003, 30.004, 30.005].map(point)],
    ]),
    waypoints: new Map(),
    config: { sections } as Trip['config'],
  };
}

describe('sliceTrack', () => {
  it('takes an inclusive range, optionally reversed', () => {
    const t = trip([]);
    expect(sliceTrack(t, { track: 'a', range: [1, 2], reverse: false }).map((p) => p.lat)).toEqual([
      30.001, 30.002,
    ]);
    expect(sliceTrack(t, { track: 'a', range: [1, 2], reverse: true }).map((p) => p.lat)).toEqual([
      30.002, 30.001,
    ]);
  });

  it('rejects ranges outside the track', () => {
    expect(() => sliceTrack(trip([]), { track: 'a', range: [2, 9], reverse: false })).toThrow(/outside/);
  });
});

describe('stitchRoute', () => {
  it('joins sections and drops the repeated point where they meet', () => {
    const route = stitchRoute(trip([section('1', 'a'), section('2', 'b')]));
    expect(route.points.map((p) => p.lat)).toEqual([30, 30.001, 30.002, 30.003, 30.004, 30.005]);
    expect([...route.sectionOf]).toEqual([0, 0, 0, 0, 1, 1]);
    expect(route.cumM.at(-1)).toBeCloseTo(556, -1);
  });

  it('rejects a section with fewer than two points', () => {
    expect(() => stitchRoute(trip([section('1', 'a', [1, 1])]))).toThrow(/fewer than 2 points/);
  });
});
