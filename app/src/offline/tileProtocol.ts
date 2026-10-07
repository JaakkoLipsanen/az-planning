import { addProtocol, type GetResourceResponse, type RequestParameters } from 'maplibre-gl';

import { TILE_SOURCES, tileUrl, type TileSourceId, isTileSourceId } from '#shared/basemaps.ts';

import { hashText } from '../lib/format.ts';
import { preferencesStore } from '../state/preferences.ts';
import { tileKey } from './cacheNames.ts';

const TILE_PROTOCOL = 'tiles';
const NETWORK_TIMEOUT_MS = 10_000;
const MAX_ANCESTOR_LEVELS = 6;
export const EMPTY_TILE_HEADER = 'x-empty-tile';

const TRANSPARENT_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0),
).buffer;

export function protocolTemplate(source: TileSourceId): string {
  return `${TILE_PROTOCOL}://${source}/{z}/{x}/{y}`;
}

/** Changes with the style and token, so MapLibre reloads the tiles; the token itself stays out of the URL. */
export function mapboxTemplate(style: string, token: string): string {
  return `${protocolTemplate('mapbox')}?style=${encodeURIComponent(style)}&token=${hashText(token)}`;
}

/** The provider URL for a tile; Mapbox needs the token and style from the user's preferences. */
export function providerUrl(source: TileSourceId, z: number, x: number, y: number): string | null {
  let template = TILE_SOURCES[source].url;
  if (source === 'mapbox') {
    const { mapboxToken, mapboxStyle } = preferencesStore.getState();
    if (!mapboxToken) return null;
    template = template.replace('{style}', mapboxStyle).replace('{token}', encodeURIComponent(mapboxToken));
  }
  return tileUrl(template, z, x, y);
}

async function storedTile(source: TileSourceId, z: number, x: number, y: number): Promise<Response | null> {
  if (typeof caches === 'undefined') return null;
  try {
    return (await caches.match(tileKey(source, z, x, y))) ?? null;
  } catch {
    return null;
  }
}

async function fromNetwork(url: string, signal: AbortSignal): Promise<ArrayBuffer | 'missing' | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(NETWORK_TIMEOUT_MS)]),
    });
    if (response.status === 404 || response.status === 204) return 'missing';
    return response.ok ? await response.arrayBuffer() : null;
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}

/** Crops the matching part of an ancestor tile and scales it up to a full tile. */
async function fromAncestor(
  source: TileSourceId,
  z: number,
  x: number,
  y: number,
): Promise<ArrayBuffer | null> {
  const dem = TILE_SOURCES[source].kind === 'dem';
  for (let up = 1; up <= Math.min(MAX_ANCESTOR_LEVELS, z); up++) {
    const stored = await storedTile(source, z - up, x >> up, y >> up);
    if (!stored || stored.headers.has(EMPTY_TILE_HEADER)) continue;
    const image = await createImageBitmap(await stored.blob(), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    const size = image.width;
    const sub = size / 2 ** up;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = !dem;
    ctx.drawImage(
      image,
      (x - ((x >> up) << up)) * sub,
      (y - ((y >> up) << up)) * sub,
      sub,
      sub,
      0,
      0,
      size,
      size,
    );
    const blob = await canvas.convertToBlob({ type: dem ? 'image/png' : 'image/jpeg', quality: 0.9 });
    return blob.arrayBuffer();
  }
  return null;
}

/** A tile's image: the stored copy, the provider, or a stored ancestor scaled up; null when there is none. */
export async function tileData(
  source: TileSourceId,
  z: number,
  x: number,
  y: number,
  signal: AbortSignal,
): Promise<ArrayBuffer | null> {
  const stored = await storedTile(source, z, x, y);
  if (stored) return stored.headers.has(EMPTY_TILE_HEADER) ? null : stored.arrayBuffer();
  const url = providerUrl(source, z, x, y);
  const network = url ? await fromNetwork(url, signal) : null;
  if (network === 'missing') return null;
  return network ?? fromAncestor(source, z, x, y);
}

/** Computes a tile from other data, such as the temperature overlay; null draws nothing. */
export type TileRenderer = (
  tile: { z: number; x: number; y: number },
  params: URLSearchParams,
  signal: AbortSignal,
) => Promise<ArrayBuffer | null>;

const renderers = new Map<string, TileRenderer>();

/** Serves tiles://<name>/... from a renderer instead of a provider; null removes it. */
export function setTileRenderer(name: string, renderer: TileRenderer | null): void {
  if (renderer) renderers.set(name, renderer);
  else renderers.delete(name);
}

async function loadTile(
  params: RequestParameters,
  abort: AbortController,
): Promise<GetResourceResponse<ArrayBuffer>> {
  const match = /^tiles:\/\/([\w-]+)\/(\d+)\/(\d+)\/(\d+)(?:\?(.*))?$/.exec(params.url);
  if (!match) throw new Error(`bad tile url ${params.url}`);
  const name = match[1];
  const query: string | undefined = match[5];
  const [z, x, y] = [Number(match[2]), Number(match[3]), Number(match[4])];
  const renderer = renderers.get(name);
  if (renderer) {
    const data = await renderer({ z, x, y }, new URLSearchParams(query ?? ''), abort.signal);
    return { data: data ?? TRANSPARENT_PNG.slice(0) };
  }
  if (!isTileSourceId(name)) throw new Error(`unknown tile source ${name}`);
  const data = await tileData(name, z, x, y, abort.signal);
  if (data) return { data };
  if (TILE_SOURCES[name].kind === 'dem') throw new Error(`no elevation tile ${z}/${x}/${y}`);
  return { data: TRANSPARENT_PNG.slice(0) };
}

/** One tile as an image blob, stored copy first; used for previews outside the map. */
export async function fetchTileBlob(
  source: TileSourceId,
  z: number,
  x: number,
  y: number,
): Promise<Blob | null> {
  const stored = await storedTile(source, z, x, y);
  if (stored && !stored.headers.has(EMPTY_TILE_HEADER)) return stored.blob();
  const url = providerUrl(source, z, x, y);
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) });
    return response.ok ? await response.blob() : null;
  } catch {
    return null;
  }
}

let registered = false;

export function registerTileProtocol(): void {
  if (registered) return;
  registered = true;
  addProtocol(TILE_PROTOCOL, loadTile);
}
