import { lngToTileX, latToTileY, TILE_SIZE } from '#shared/tiles.ts';

import { tileData } from '../offline/tileProtocol.ts';

/** Decoded elevation tiles kept for the overlay and for hovering; about 260 KB each. */
const CACHE_SIZE = 48;
const MAX_ZOOM = 12;

const cache = new Map<string, Promise<Float32Array | null>>();

async function decodeTerrarium(png: ArrayBuffer): Promise<Float32Array | null> {
  const image = await createImageBitmap(new Blob([png]), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, TILE_SIZE, TILE_SIZE);
  const { data } = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
  const out = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let i = 0; i < out.length; i++)
    out[i] = data[i * 4] * 256 + data[i * 4 + 1] + data[i * 4 + 2] / 256 - 32768;
  return out;
}

/** Elevations of a terrain tile in metres, row by row; null where there is no tile. */
export function elevationTile(z: number, x: number, y: number): Promise<Float32Array | null> {
  const key = `${z}/${x}/${y}`;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const loading = tileData('terrain', z, x, y, new AbortController().signal)
    .then((png) => (png ? decodeTerrarium(png) : null))
    .catch(() => null);
  cache.set(key, loading);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  return loading;
}

/** Elevation at a point from the terrain tile of a zoom level (capped at the finest one served). */
export async function elevationAt(lng: number, lat: number, zoom: number): Promise<number | null> {
  const z = Math.max(0, Math.min(MAX_ZOOM, Math.floor(zoom)));
  const tx = lngToTileX(lng, z);
  const ty = latToTileY(lat, z);
  const [x, y] = [Math.floor(tx), Math.floor(ty)];
  const tile = await elevationTile(z, x, y);
  if (!tile) return null;
  const px = Math.min(TILE_SIZE - 1, Math.floor((tx - x) * TILE_SIZE));
  const py = Math.min(TILE_SIZE - 1, Math.floor((ty - y) * TILE_SIZE));
  return tile[py * TILE_SIZE + px];
}
