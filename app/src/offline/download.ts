import { TILE_SOURCES } from '#shared/basemaps.ts';
import type { OfflinePack, TripBundle } from '#shared/bundle.ts';
import { fromTileRuns, type TileId } from '#shared/tiles.ts';

import {
  tileKey,
  tilePackCache,
  tilePackPrefix,
  tripFileKey,
  tripFilesCache,
  tripFileUrl,
} from './cacheNames.ts';
import { EMPTY_TILE_HEADER, providerUrl } from './tileProtocol.ts';

const CONCURRENCY = 6;
const ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;
const FILE_TIMEOUT_MS = 120_000;

export interface PackStatus {
  pack: OfflinePack;
  stored: number;
  complete: boolean;
}

export interface OfflineStatus {
  packs: PackStatus[];
  filesStored: boolean;
}

export interface DownloadProgress {
  doneTiles: number;
  totalTiles: number;
  bytes: number;
  failed: number;
  startedAt: number;
  updatedAt: number;
}

export class StorageFullError extends Error {
  constructor() {
    super('The storage this browser allows the site is full. Choose fewer packs or free up space.');
  }
}

/** Files stored with the bundle version in their key; trip.json itself is kept current by loadTrip. */
function versionedFiles(bundle: TripBundle): string[] {
  return [bundle.files?.gpxFull, bundle.files?.gpxSections].filter((f): f is string => Boolean(f));
}

function packKeys(pack: OfflinePack): Map<string, TileId> {
  const keys = new Map<string, TileId>();
  for (const tile of fromTileRuns(pack.tiles)) keys.set(tileKey(pack.source, tile.z, tile.x, tile.y), tile);
  return keys;
}

async function storedKeys(cacheName: string): Promise<Set<string>> {
  if (!(await caches.has(cacheName))) return new Set();
  const cache = await caches.open(cacheName);
  return new Set((await cache.keys()).map((request) => request.url));
}

export async function offlineStatus(bundle: TripBundle): Promise<OfflineStatus> {
  const packs = await Promise.all(
    (bundle.offline?.packs ?? []).map(async (pack) => {
      const stored = await storedKeys(tilePackCache(bundle.slug, pack.id));
      let count = 0;
      for (const key of packKeys(pack).keys()) if (stored.has(key)) count++;
      return { pack, stored: count, complete: count === pack.tileCount };
    }),
  );
  const files = await storedKeys(tripFilesCache(bundle.slug));
  const filesStored =
    files.has(new URL(tripFileUrl(bundle.slug, 'trip.json'), location.origin).href) &&
    versionedFiles(bundle).every((f) => files.has(tripFileKey(bundle, f)));
  return { packs, filesStored };
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'QuotaExceededError';
}

/** The tile as a response to store; providers' 404s become empty markers so a pack can still be complete. */
async function fetchTile(url: string, signal: AbortSignal): Promise<{ response: Response; bytes: number }> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
      if (response.status === 404 || response.status === 204) {
        return {
          response: new Response(null, { status: 200, headers: { [EMPTY_TILE_HEADER]: '1' } }),
          bytes: 0,
        };
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const type = response.headers.get('Content-Type') ?? 'image/png';
      return { response: new Response(blob, { headers: { 'Content-Type': type } }), bytes: blob.size };
    } catch (error) {
      if (signal.aborted || attempt >= ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

/** Stores the bundle and its files for this version and removes files of older builds. */
async function storeTripFiles(bundle: TripBundle, signal: AbortSignal): Promise<void> {
  const cache = await caches.open(tripFilesCache(bundle.slug));
  const tripJson = tripFileUrl(bundle.slug, 'trip.json');
  if (!(await cache.match(tripJson))) {
    // The file as served, not the normalized bundle, which lacks what this app version does not know.
    const response = await fetch(tripJson, { cache: 'no-cache', signal });
    if (!response.ok) throw new Error(`trip.json: HTTP ${response.status}`);
    await cache.put(tripJson, response);
  }
  const keep = new Set([new URL(tripJson, location.origin).href]);
  for (const file of versionedFiles(bundle)) {
    const key = tripFileKey(bundle, file);
    keep.add(key);
    if (await cache.match(key)) continue;
    const response = await fetch(tripFileUrl(bundle.slug, file), {
      cache: 'no-cache',
      signal: AbortSignal.any([signal, AbortSignal.timeout(FILE_TIMEOUT_MS)]),
    });
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    await cache.put(key, response);
  }
  for (const request of await cache.keys()) if (!keep.has(request.url)) await cache.delete(request);
}

/** Deletes the tile caches of this trip that the bundle no longer lists (renamed or removed packs). */
async function deleteOrphanedPacks(bundle: TripBundle): Promise<void> {
  const current = new Set((bundle.offline?.packs ?? []).map((p) => tilePackCache(bundle.slug, p.id)));
  for (const name of await caches.keys()) {
    if (name.startsWith(tilePackPrefix(bundle.slug)) && !current.has(name)) await caches.delete(name);
  }
}

interface QueuedTile {
  cache: Cache;
  key: string;
  url: string;
}

async function missingTiles(bundle: TripBundle, packIds: readonly string[]): Promise<QueuedTile[]> {
  const queue: QueuedTile[] = [];
  for (const pack of bundle.offline?.packs ?? []) {
    if (!packIds.includes(pack.id)) continue;
    const cache = await caches.open(tilePackCache(bundle.slug, pack.id));
    const expected = packKeys(pack);
    const stored = new Set<string>();
    for (const request of await cache.keys()) {
      if (expected.has(request.url)) stored.add(request.url);
      else await cache.delete(request);
    }
    for (const [key, { z, x, y }] of expected) {
      const url = providerUrl(pack.source, z, x, y);
      if (!stored.has(key) && url) queue.push({ cache, key, url });
    }
  }
  return queue;
}

/** Stores the trip files and the missing tiles of the chosen packs; tiles of older builds are removed. */
export async function downloadOffline(
  bundle: TripBundle,
  packIds: readonly string[],
  signal: AbortSignal,
  onProgress: (progress: DownloadProgress) => void,
): Promise<DownloadProgress> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Persistence is a best-effort request; downloads work without it.
  }
  await deleteOrphanedPacks(bundle);
  await storeTripFiles(bundle, signal);
  const queue = await missingTiles(bundle, packIds);

  const progress: DownloadProgress = {
    doneTiles: 0,
    totalTiles: queue.length,
    bytes: 0,
    failed: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  onProgress({ ...progress });
  const stop = new AbortController();
  const active = AbortSignal.any([signal, stop.signal]);
  let storageFull = false;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < queue.length && !active.aborted) {
      const item = queue[next++];
      try {
        const { response, bytes } = await fetchTile(item.url, active);
        await item.cache.put(item.key, response);
        progress.bytes += bytes;
      } catch (error) {
        if (isQuotaError(error)) {
          storageFull = true;
          stop.abort();
        }
        if (active.aborted) return;
        progress.failed++;
      }
      progress.doneTiles++;
      progress.updatedAt = Date.now();
      onProgress({ ...progress });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (storageFull) throw new StorageFullError();
  return progress;
}

export async function deleteOffline(bundle: TripBundle): Promise<void> {
  await caches.delete(tripFilesCache(bundle.slug));
  for (const name of await caches.keys())
    if (name.startsWith(tilePackPrefix(bundle.slug))) await caches.delete(name);
}

export function estimatedBytes(packs: readonly PackStatus[]): number {
  return packs.reduce(
    (sum, { pack, stored }) => sum + (pack.tileCount - stored) * TILE_SOURCES[pack.source].averageTileBytes,
    0,
  );
}
