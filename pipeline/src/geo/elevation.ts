import { PNG } from 'pngjs';

import { TILE_SOURCES, tileUrl } from '#shared/basemaps.ts';
import type { LatLng } from '#shared/geo.ts';
import { latToTileY, lngToTileX, TILE_SIZE } from '#shared/tiles.ts';

import { cachedFetch, mapLimit } from '../net/http.ts';

const ZOOM = 12;
const MIN_VALID = -500;
const MAX_VALID = 9000;

function decodeTerrarium(png: Buffer): Float32Array {
  const { data, width, height } = PNG.sync.read(png);
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const value = data[i * 4] * 256 + data[i * 4 + 1] + data[i * 4 + 2] / 256 - 32768;
    out[i] = value < MIN_VALID ? 0 : value;
  }
  return out;
}

function pixelPosition(lat: number, lng: number): [px: number, py: number] {
  return [lngToTileX(lng, ZOOM) * TILE_SIZE, latToTileY(lat, ZOOM) * TILE_SIZE];
}

/** Elevation lookups from Terrarium DEM tiles; call load() for the area first. */
export class ElevationModel {
  private readonly tiles = new Map<string, Float32Array | null>();

  async load(points: Iterable<LatLng>): Promise<void> {
    const needed = new Set<string>();
    for (const { lat, lng } of points) {
      const [px, py] = pixelPosition(lat, lng);
      for (const x of [Math.floor(px), Math.floor(px) + 1]) {
        for (const y of [Math.floor(py), Math.floor(py) + 1]) {
          const key = `${Math.floor(x / TILE_SIZE)}/${Math.floor(y / TILE_SIZE)}`;
          if (!this.tiles.has(key)) needed.add(key);
        }
      }
    }
    await mapLimit([...needed], 8, async (key) => {
      const [x, y] = key.split('/').map(Number);
      const png = await cachedFetch(tileUrl(TILE_SOURCES.terrain.url, ZOOM, x, y), { allowMissing: true });
      this.tiles.set(key, png ? decodeTerrarium(png) : null);
    });
  }

  private pixel(x: number, y: number): number | null {
    const tile = this.tiles.get(`${Math.floor(x / TILE_SIZE)}/${Math.floor(y / TILE_SIZE)}`);
    if (!tile) return null;
    const value = tile[(y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE)];
    return value > MAX_VALID ? null : value;
  }

  /** Bilinear elevation in metres, or null outside the loaded tiles. */
  sample(lat: number, lng: number): number | null {
    const [px, py] = pixelPosition(lat, lng);
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const tx = px - x0;
    const ty = py - y0;
    const corners: [number, number, number][] = [
      [x0, y0, (1 - tx) * (1 - ty)],
      [x0 + 1, y0, tx * (1 - ty)],
      [x0, y0 + 1, (1 - tx) * ty],
      [x0 + 1, y0 + 1, tx * ty],
    ];
    let sum = 0;
    let weight = 0;
    for (const [x, y, w] of corners) {
      const value = this.pixel(x, y);
      if (value === null) continue;
      sum += value * w;
      weight += w;
    }
    return weight > 0 ? sum / weight : null;
  }

  /** Point elevations, filling gaps from the DEM and then from the nearest earlier (or first known) value. */
  fill(points: readonly (LatLng & { ele: number | null })[]): number[] {
    const known = points.map((p) => p.ele ?? this.sample(p.lat, p.lng));
    let last = known.find((e) => e !== null) ?? 0;
    return known.map((ele) => {
      last = ele ?? last;
      return last;
    });
  }
}
