/* oxlint-disable no-console */
import { readdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { buildTrip } from './build.ts';
import { loadTrip } from './config/load.ts';
import { log } from './log.ts';
import { setCacheOnly } from './net/http.ts';
import { TRIPS_DIR } from './paths.ts';
import { stitchRoute } from './route/stitch.ts';
import { printNearest } from './tools/nearest.ts';

const USAGE = `Usage: pnpm trip <command> [options]

  build <slug...> | --all              Rebuild trips/<slug>/dist from trip.yaml (online data is cached in .cache/)
        [--offline]                    Use only .cache/ and fail on anything missing from it
  validate <slug...> | --all           Check trip.yaml, the GPX files and the section joins without network access
  --strict                             Fail on warnings (build and validate)
  nearest <slug> <track> <lat,lon>     Point indices of a track near a location, for section and alternative ranges
          [--count 3]
`;

function latLon(value: string): [number, number] {
  const [lat, lon] = value.split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`expected lat,lon but got "${value}"`);
  return [lat, lon];
}

async function allTrips(): Promise<string[]> {
  const entries = await readdir(TRIPS_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function validateTrip(slug: string): Promise<void> {
  const route = stitchRoute(await loadTrip(slug));
  log.info(`${slug}: ${route.sections.length} sections, ${Math.round((route.cumM.at(-1) ?? 0) / 1000)} km`);
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      all: { type: 'boolean' },
      offline: { type: 'boolean' },
      strict: { type: 'boolean' },
      count: { type: 'string', default: '3' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, ...args] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return;
  }
  if (command === 'build' || command === 'validate') {
    const slugs = values.all ? await allTrips() : args;
    if (slugs.length === 0) throw new Error('name a trip or pass --all');
    setCacheOnly(Boolean(values.offline));
    for (const slug of slugs) {
      if (command === 'build') await buildTrip(slug);
      else await validateTrip(slug);
    }
    if (values.strict && log.warnings > 0)
      throw new Error(`${log.warnings} warning${log.warnings > 1 ? 's' : ''} (--strict)`);
  } else if (command === 'nearest') {
    const [slug, track, at] = args;
    if (!slug || !track || !at) throw new Error('usage: pnpm trip nearest <slug> <track> <lat,lon>');
    await printNearest(slug, track, ...latLon(at), Number(values.count));
  } else {
    throw new Error(`unknown command "${command}"\n\n${USAGE}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
