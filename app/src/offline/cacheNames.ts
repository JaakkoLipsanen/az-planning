import type { TileSourceId } from '#shared/basemaps.ts';
import type { TripBundle } from '#shared/bundle.ts';

/** Cache Storage layout: trip files and each tile pack have their own cache, so each can be checked and removed. */
export const tripFilesCache = (slug: string): string => `trip-files:${slug}`;

export const tilePackPrefix = (slug: string): string => `tiles:${slug}:`;

export const tilePackCache = (slug: string, packId: string): string => `${tilePackPrefix(slug)}${packId}`;

export function tileKey(source: TileSourceId, z: number, x: number, y: number): string {
  return `${location.origin}/__tiles/${source}/${z}/${x}/${y}`;
}

export function tripFileUrl(slug: string, file: string): string {
  return `/trips/${slug}/${file}`;
}

/** Stored trip files are keyed by bundle version, so a rebuilt trip never serves files from an older build. */
export function tripFileKey(bundle: TripBundle, file: string): string {
  return `${location.origin}${tripFileUrl(bundle.slug, file)}?v=${bundle.version}`;
}
