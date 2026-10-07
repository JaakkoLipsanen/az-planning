import type { Bounds } from './geo.ts';

export interface TileId {
  z: number;
  x: number;
  y: number;
}

/** A column of tiles: zoom, x and an inclusive y range. Compact storage for tile sets. */
export type TileRun = [z: number, x: number, y0: number, y1: number];

export const TILE_SIZE = 256;

export function lngToTileX(lng: number, z: number): number {
  return ((lng + 180) / 360) * 2 ** z;
}

export function latToTileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

export function tileXToLng(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

export function tileAt(lng: number, lat: number, z: number): TileId {
  return { z, x: Math.floor(lngToTileX(lng, z)), y: Math.floor(latToTileY(lat, z)) };
}

export function tileBounds({ z, x, y }: TileId): Bounds {
  return [tileXToLng(x, z), tileYToLat(y + 1, z), tileXToLng(x + 1, z), tileYToLat(y, z)];
}

export function tilesInBounds(bounds: Bounds, z: number): TileId[] {
  const max = 2 ** z - 1;
  const x0 = Math.max(0, Math.floor(lngToTileX(bounds[0], z)));
  const x1 = Math.min(max, Math.floor(lngToTileX(bounds[2], z)));
  const y0 = Math.max(0, Math.floor(latToTileY(bounds[3], z)));
  const y1 = Math.min(max, Math.floor(latToTileY(bounds[1], z)));
  const out: TileId[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y });
  return out;
}

export function tileKey({ z, x, y }: TileId): string {
  return `${z}/${x}/${y}`;
}

export function toTileRuns(tiles: Iterable<TileId>): TileRun[] {
  const sorted = [...tiles].toSorted((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
  const runs: TileRun[] = [];
  for (const { z, x, y } of sorted) {
    const last = runs.at(-1);
    if (last && last[0] === z && last[1] === x && last[3] === y - 1) last[3] = y;
    else if (!last || last[0] !== z || last[1] !== x || last[3] !== y) runs.push([z, x, y, y]);
  }
  return runs;
}

export function* fromTileRuns(runs: Iterable<TileRun>): Generator<TileId> {
  for (const [z, x, y0, y1] of runs) for (let y = y0; y <= y1; y++) yield { z, x, y };
}

export function countTiles(runs: readonly TileRun[]): number {
  return runs.reduce((sum, [, , y0, y1]) => sum + y1 - y0 + 1, 0);
}
