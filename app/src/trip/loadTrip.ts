import { z } from 'zod';

import { BUNDLE_SCHEMA_VERSION, type TripBundle, type TripIndex } from '#shared/bundle.ts';

import { tripFileKey, tripFilesCache, tripFileUrl } from '../offline/cacheNames.ts';
import { normalizeBundle } from './normalize.ts';

/** How long to wait for the network before using the stored copy; longer when there is none. */
const TIMEOUT_WITH_COPY_MS = 3_000;
const TIMEOUT_WITHOUT_COPY_MS = 15_000;
const FILE_TIMEOUT_MS = 120_000;
const INDEX_CACHE = 'trip-index';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const response = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(timeoutMs) });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

async function openCache(name: string): Promise<Cache | null> {
  try {
    return await caches.open(name);
  } catch {
    return null;
  }
}

function parse<T>(text: string | null | undefined, schema: z.ZodType<T>): T | null {
  if (!text) return null;
  try {
    return schema.safeParse(JSON.parse(text)).data ?? null;
  } catch {
    return null;
  }
}

/** Network first with a short timeout when a copy is stored; a valid response replaces the stored copy. */
async function loadJson<T>(url: string, cacheName: string, schema: z.ZodType<T>): Promise<T> {
  const cache = await openCache(cacheName);
  const stored = await cache?.match(url).catch(() => undefined);
  const freshText = await fetchText(url, stored ? TIMEOUT_WITH_COPY_MS : TIMEOUT_WITHOUT_COPY_MS);
  const fresh = parse(freshText, schema);
  if (fresh) {
    await cache?.put(url, new Response(freshText, { headers: JSON_HEADERS })).catch(() => undefined);
    return fresh;
  }
  const copy = parse(await stored?.text(), schema);
  if (copy) return copy;
  throw new Error(
    navigator.onLine
      ? `Could not load ${url}`
      : 'You are offline and this trip has not been stored on this device.',
  );
}

/** Only the parts that tell a trip bundle from an error page; the rest is trusted to match its schemaVersion. */
const bundleSchema = z
  .looseObject({ schemaVersion: z.number(), slug: z.string(), sections: z.array(z.unknown()) })
  .transform((value) => value as unknown as TripBundle);

const indexSchema = z
  .looseObject({ trips: z.array(z.unknown()) })
  .transform((value) => value as unknown as TripIndex);

export async function loadTrip(slug: string): Promise<TripBundle> {
  const bundle = await loadJson(tripFileUrl(slug, 'trip.json'), tripFilesCache(slug), bundleSchema);
  if (bundle.schemaVersion > BUNDLE_SCHEMA_VERSION) {
    throw new Error(
      'This trip needs a newer version of the app. Accept the update prompt, or close the app completely and open it again.',
    );
  }
  return normalizeBundle(bundle);
}

export function loadTripIndex(): Promise<TripIndex> {
  return loadJson('/trips/index.json', INDEX_CACHE, indexSchema);
}

/** A trip file (GPX etc.) as text: the copy stored for this bundle version by an offline download, else the network. */
export async function fetchTripText(bundle: TripBundle, file: string): Promise<string> {
  const cache = await openCache(tripFilesCache(bundle.slug));
  const stored = await cache?.match(tripFileKey(bundle, file)).catch(() => undefined);
  if (stored) return stored.text();
  const fresh = await fetchText(tripFileUrl(bundle.slug, file), FILE_TIMEOUT_MS);
  if (fresh !== null) return fresh;
  throw new Error(`${file} is not available offline; download the trip for offline use first.`);
}
