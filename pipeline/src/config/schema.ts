import { z } from 'zod';

import { TILE_SOURCES, type TileSourceId } from '#shared/basemaps.ts';
import { POI_CATEGORIES, SURFACES } from '#shared/bundle.ts';

const color = z.string().regex(/^#[0-9a-f]{6}$/i, 'expected a #rrggbb colour');
const id = z.union([z.string(), z.number()]).transform(String);
const tileSourceId = z.enum(Object.keys(TILE_SOURCES) as [TileSourceId, ...TileSourceId[]]);
const point = z.strictObject({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) });

/** [west, south, east, north], the same order everywhere in trip.yaml. */
const bounds = z
  .tuple([z.number(), z.number(), z.number(), z.number()])
  .refine(
    ([w, s, e, n]) => w < e && s < n && Math.abs(s) <= 90 && Math.abs(n) <= 90,
    'expected [west, south, east, north]',
  );

/** An IANA time zone name, such as America/Phoenix. */
const timeZone = z.string().refine((name) => {
  try {
    return new Intl.DateTimeFormat('en', { timeZone: name }).resolvedOptions().timeZone !== '';
  } catch {
    return false;
  }
}, 'expected an IANA time zone such as America/Phoenix');

const surfaceSpeeds = z.strictObject({ single: z.number().positive(), unpaved: z.number().positive() });

/** Zoom level -> value. */
const zoomMap = z
  .record(z.string().regex(/^\d+$/, 'zoom levels are whole numbers'), z.number().positive())
  .transform((record) => new Map(Object.entries(record).map(([zoom, value]) => [Number(zoom), value])));

/** [first] or [first, last]; inclusive point indices. */
const pointRange = z.union([
  z.tuple([z.number().int().nonnegative()]),
  z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
]);

const trackSlice = z.strictObject({
  track: z.string(),
  range: pointRange.optional(),
  reverse: z.boolean().default(false),
});

const track = z.strictObject({
  file: z.string(),
  show: z.strictObject({ name: z.string(), color }).optional(),
  waypoints: z.strictObject({ label: z.string(), keepAll: z.boolean().default(false) }).optional(),
});

const kind = z.strictObject({
  label: z.string(),
  color,
  surface: z.enum(SURFACES),
  speed: surfaceSpeeds.optional(),
});

const section = z
  .strictObject({
    id,
    name: z.string(),
    kind: z.string(),
    track: z.string().optional(),
    range: pointRange.optional(),
    reverse: z.boolean().default(false),
    parts: z.array(trackSlice).min(1).optional(),
    speed: z.strictObject({ kmh: z.number().positive(), climbRate: z.number().positive() }).optional(),
  })
  .refine((s) => (s.track === undefined) !== (s.parts === undefined), 'a section needs either track or parts')
  .transform(({ track: trackKey, range, reverse, parts, ...rest }) => ({
    ...rest,
    parts: parts ?? [{ track: trackKey as string, range, reverse }],
  }));

const alternative = z.strictObject({
  id,
  name: z.string(),
  note: z.string().optional(),
  color: color.default('#888888'),
  style: z.enum(['option', 'skipped']).default('option'),
  track: z.string(),
  range: pointRange.optional(),
  reverse: z.boolean().default(false),
});

const poiCategory = z.enum(POI_CATEGORIES);

const pois = z.strictObject({
  note: z.string().optional(),
  link: z.strictObject({ label: z.string(), url: z.url() }).optional(),
  waypointMaxDistanceM: z.number().positive().default(2500),
  onRouteDistanceM: z.number().positive().default(800),
  gpxMaxDistanceM: z.number().positive().default(400),
  keywords: z.partialRecord(poiCategory, z.array(z.string())).default({}),
  categoryOverrides: z.record(z.string(), poiCategory).default({}),
  descriptionAppend: z.record(z.string(), z.string()).default({}),
  custom: z
    .array(
      point.extend({ name: z.string(), category: poiCategory, description: z.string().default('') }).strict(),
    )
    .default([]),
  osm: z
    .strictObject({
      radiusM: z.number().positive().default(1500),
      onRouteDistanceM: z.number().positive().default(1200),
      denseAreas: z.array(bounds).default([]),
    })
    .optional(),
});

const plan = z.strictObject({
  days: z
    .strictObject({
      min: z.number().int().positive(),
      max: z.number().int().positive(),
      default: z.number().int().positive(),
    })
    .refine((d) => d.min <= d.default && d.default <= d.max, 'expected min <= default <= max'),
  longDayHours: z.number().positive(),
  start: z.string(),
  finish: z.string(),
  /** Suggested first day; the app lets the user change it. */
  startDate: z.iso.date().optional(),
  note: z.string().optional(),
  overnights: z.array(point.extend({ name: z.string(), km: z.number().optional() }).strict()).default([]),
});

const offlinePack = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9-]+$/, 'pack ids are lowercase letters, digits and dashes'),
    label: z.string(),
    source: tileSourceId,
    /** Zoom -> buffer around the route and alternatives, in km. */
    radiusKm: zoomMap,
    /** Ticked for download by default. */
    selected: z.boolean().default(true),
  })
  .refine((p) => TILE_SOURCES[p.source].offline, 'this tile source does not allow offline storage')
  .refine((p) => {
    const { minzoom, maxzoom } = TILE_SOURCES[p.source];
    return [...p.radiusKm.keys()].every((zoom) => zoom >= minzoom && zoom <= maxzoom);
  }, 'radiusKm has zoom levels the tile source does not serve');

export const tripConfigSchema = z.strictObject({
  title: z.string(),
  shortName: z.string(),
  subtitle: z.string().optional(),
  description: z.string().optional(),
  attribution: z.string().optional(),
  /** Needed for sun times and dates in the app. */
  timezone: timeZone.optional(),
  /** Area of the basemap overlay and land data; defaults to the route's bounds plus a margin. */
  region: bounds.optional(),
  tracks: z.record(z.string(), track),
  kinds: z.record(z.string(), kind),
  speed: z
    .strictObject({
      pavedKmh: z.number().positive().default(20),
      fallbackKmh: surfaceSpeeds.default({ single: 10, unpaved: 14 }),
      climbRates: z
        .strictObject({
          single: z.number().positive(),
          unpaved: z.number().positive(),
          paved: z.number().positive(),
        })
        .default({ single: 450, unpaved: 550, paved: 700 }),
    })
    .prefault({}),
  sections: z.array(section).min(1),
  alternatives: z.array(z.strictObject({ group: z.string(), items: z.array(alternative) })).default([]),
  pois: pois.optional(),
  plan: plan.optional(),
  basemap: z.strictObject({ majorPlaces: z.array(z.string()).default([]) }).optional(),
  land: z
    .strictObject({
      /** BLM Surface Management Agency: United States only. */
      provider: z.literal('blm').default('blm'),
      corridorKm: z.number().positive(),
      note: z.string().optional(),
    })
    .optional(),
  imagery: z
    .strictObject({
      basemaps: z.array(tileSourceId).min(1),
      default: tileSourceId,
      thumbnail: point.optional(),
    })
    .optional(),
  offline: z.strictObject({ packs: z.array(offlinePack) }).optional(),
  /** Typical weather from NASA POWER daily data over these years (inclusive). */
  climate: z
    .strictObject({
      years: z
        .tuple([z.int().min(1985), z.int()])
        .refine(([first, last]) => first <= last, 'expected [first year, last year]'),
    })
    .optional(),
  gpx: z
    .strictObject({
      baseName: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      creator: z.string().default('trip-planner'),
    })
    .prefault({}),
});

export type TripConfig = z.infer<typeof tripConfigSchema>;
export type TrackConfig = TripConfig['tracks'][string];
export type SectionConfig = TripConfig['sections'][number];
export type TrackSlice = SectionConfig['parts'][number];
export type AlternativeConfig = TripConfig['alternatives'][number]['items'][number];
export type PoiConfig = NonNullable<TripConfig['pois']>;
export type OfflinePackConfig = NonNullable<TripConfig['offline']>['packs'][number];
