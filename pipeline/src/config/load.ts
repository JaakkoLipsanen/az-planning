import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { TILE_SOURCES } from '#shared/basemaps.ts';
import {
  countTrackSegments,
  parseTrackPoints,
  parseWaypoints,
  type GpxPoint,
  type GpxWaypoint,
} from '#shared/gpx.ts';

import { log } from '../log.ts';
import { tripDir } from '../paths.ts';
import { tripConfigSchema, type TripConfig } from './schema.ts';

/** Path segments the app itself uses; a trip slug becomes the first segment of its URL. */
const RESERVED_SLUGS = new Set(['assets', 'fonts', 'trips', 'index.html', 'sw.js']);

export interface TrackPoint {
  lat: number;
  lng: number;
  ele: number | null;
  /** The point as written in the source file; copied verbatim into output GPX. */
  text: GpxPoint;
}

export interface Trip {
  slug: string;
  dir: string;
  config: TripConfig;
  tracks: Map<string, TrackPoint[]>;
  waypoints: Map<string, GpxWaypoint[]>;
}

function toTrackPoint(text: GpxPoint): TrackPoint {
  return {
    lat: Number(text.lat),
    lng: Number(text.lon),
    ele: text.ele === '' ? null : Number(text.ele),
    text,
  };
}

function duplicates(values: readonly string[]): string[] {
  return [...new Set(values.filter((v, i) => values.indexOf(v) !== i))];
}

function checkReferences(config: TripConfig): string[] {
  const errors: string[] = [];
  const hasTrack = (key: string): boolean => Object.hasOwn(config.tracks, key);
  for (const s of config.sections) {
    if (!Object.hasOwn(config.kinds, s.kind)) errors.push(`section ${s.id}: unknown kind "${s.kind}"`);
    for (const part of s.parts)
      if (!hasTrack(part.track)) errors.push(`section ${s.id}: unknown track "${part.track}"`);
  }
  const alternatives = config.alternatives.flatMap((group) => group.items);
  for (const alt of alternatives)
    if (!hasTrack(alt.track)) errors.push(`alternative ${alt.id}: unknown track "${alt.track}"`);

  const shownTracks = Object.entries(config.tracks).flatMap(([key, t]) => (t.show ? [key] : []));
  const packs = config.offline?.packs ?? [];
  for (const [what, ids] of [
    ['section ids', config.sections.map((s) => s.id)],
    ['shown track and alternative ids', [...shownTracks, ...alternatives.map((a) => a.id)]],
    ['offline pack ids', packs.map((p) => p.id)],
  ] as const) {
    const repeated = duplicates(ids);
    if (repeated.length > 0) errors.push(`${what} must be unique: ${repeated.join(', ')}`);
  }

  const basemaps = config.imagery?.basemaps ?? ['terrain'];
  if (config.imagery && !basemaps.includes(config.imagery.default))
    errors.push(`imagery.default "${config.imagery.default}" is not in imagery.basemaps`);
  for (const pack of packs) {
    if (TILE_SOURCES[pack.source].kind === 'raster' && !basemaps.includes(pack.source))
      errors.push(`offline pack ${pack.id}: "${pack.source}" is not in imagery.basemaps`);
  }
  return errors;
}

export async function loadTrip(slug: string): Promise<Trip> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || RESERVED_SLUGS.has(slug))
    throw new Error(`"${slug}" is not a valid trip slug: use lowercase letters, digits and dashes`);
  const dir = tripDir(slug);
  const file = path.join(dir, 'trip.yaml');
  const raw: unknown = parseYaml(await readFile(file, 'utf8'));
  const parsed = tripConfigSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${file} is invalid:\n${z.prettifyError(parsed.error)}`);
  const config = parsed.data;
  const errors = checkReferences(config);
  if (errors.length > 0) throw new Error(`${file} is invalid:\n  ${errors.join('\n  ')}`);

  const tracks = new Map<string, TrackPoint[]>();
  const waypoints = new Map<string, GpxWaypoint[]>();
  await Promise.all(
    Object.entries(config.tracks).map(async ([key, track]) => {
      const xml = await readFile(path.join(dir, track.file), 'utf8');
      const points = parseTrackPoints(xml).map(toTrackPoint);
      if (points.length === 0) throw new Error(`${track.file} has no track points`);
      const segments = countTrackSegments(xml);
      if (segments > 1) log.warn(`${track.file}: its ${segments} track segments are joined into one line`);
      tracks.set(key, points);
      if (track.waypoints) waypoints.set(key, parseWaypoints(xml));
    }),
  );
  return { slug, dir, config, tracks, waypoints };
}
