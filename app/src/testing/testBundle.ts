import { BUNDLE_SCHEMA_VERSION, type Poi, type TripBundle } from '#shared/bundle.ts';
import { encodePolyline } from '#shared/polyline.ts';

export const KM_PER_DEGREE = 111.2;

/** A 100 km route due north at constant speed: 10 km per hour, 1 km samples, all singletrack. */
export function testBundle(pois: Poi[] = []): TripBundle {
  const km = Array.from({ length: 101 }, (_, i) => i);
  const lat = km.map((k) => 30 + k / KM_PER_DEGREE);
  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    slug: 'test',
    version: 'v',
    title: 'Test',
    shortName: 'Test',
    bounds: [-110, 30, -110, lat[100]],
    region: [-111, 29, -109, 32],
    stats: { distanceKm: 100, climbM: 0, movingHours: 10 },
    kinds: { trail: { label: 'Trail', color: '#000000' } },
    sections: [
      {
        id: '1',
        name: 'All',
        kind: 'trail',
        km: 100,
        climbM: 0,
        movingHours: 10,
        parts: [{ surface: 0, line: encodePolyline(lat.map((y) => [-110, y])) }],
      },
    ],
    profile: {
      km,
      ele: km.map(() => 500),
      lat,
      lng: km.map(() => -110),
      section: km.map(() => 0),
      surface: km.map(() => 0),
      climbM: km.map(() => 0),
      hours: km.map((k) => k / 10),
    },
    pois: { items: pois },
    imagery: { basemaps: ['usgs-topo', 'terrain'], default: 'usgs-topo' },
    offline: {
      packs: [
        { id: 'topo', label: 'Topo', source: 'usgs-topo', tiles: [], tileCount: 0, estimatedBytes: 0 },
        {
          id: 'detail',
          label: 'Detail',
          source: 'usgs-topo',
          tiles: [],
          tileCount: 0,
          estimatedBytes: 0,
          selected: false,
        },
      ],
    },
    plan: {
      minDays: 2,
      maxDays: 10,
      defaultDays: 4,
      longDayHours: 7,
      start: 'Start',
      finish: 'Finish',
      overnights: [],
    },
  };
}
