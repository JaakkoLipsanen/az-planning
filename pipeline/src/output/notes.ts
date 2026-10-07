import { readFile, writeFile } from 'node:fs/promises';

import type { TripBundle } from '#shared/bundle.ts';

import { log } from '../log.ts';

const START = '<!-- generated:summary -->';
const END = '<!-- /generated:summary -->';

function summary(bundle: TripBundle): string {
  const { distanceKm, climbM, movingHours } = bundle.stats;
  const rows = bundle.sections.map(
    (s) =>
      `| ${s.id} | ${s.name} | ${s.km.toFixed(1)} | ${Math.round(s.climbM)} | ${s.movingHours.toFixed(1)} |`,
  );
  const sum = (pick: (s: TripBundle['sections'][number]) => number): number =>
    bundle.sections.reduce((a, s) => a + pick(s), 0);
  return [
    START,
    `**Total: ${Math.round(distanceKm).toLocaleString('en-US')} km, about ${Math.round(climbM).toLocaleString('en-US')} m of climbing, estimated ${Math.round(movingHours)} h moving.**`,
    '',
    '| # | Section | km | climb m | est. moving h |',
    '|---|---|---:|---:|---:|',
    ...rows,
    `| | **Total** | **${sum((s) => s.km).toFixed(1)}** | **${Math.round(sum((s) => s.climbM))}** | **${sum((s) => s.movingHours).toFixed(1)}** |`,
    END,
  ].join('\n');
}

/** Rewrites the generated block of the trip's NOTES.md, if it has one. */
export async function updateNotes(file: string, bundle: TripBundle): Promise<void> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return;
  }
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start < 0 || end < start) {
    log.warn(`${file} has no ${START} block; summary not updated`);
    return;
  }
  await writeFile(file, text.slice(0, start) + summary(bundle) + text.slice(end + END.length));
}
