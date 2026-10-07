import { degreesAround, EARTH_CIRCUMFERENCE_M, haversineM, type LngLat } from '#shared/geo.ts';
import {
  latToTileY,
  lngToTileX,
  tileXToLng,
  tileYToLat,
  toTileRuns,
  type TileId,
  type TileRun,
} from '#shared/tiles.ts';

/** Points along the lines no further apart than stepM. */
function resample(lines: readonly LngLat[][], stepM: number): LngLat[] {
  const out: LngLat[] = [];
  for (const line of lines) {
    let last: LngLat | undefined;
    for (const p of line) {
      if (!last) {
        out.push(p);
        last = p;
        continue;
      }
      const d = haversineM(last[1], last[0], p[1], p[0]);
      if (d < stepM) continue;
      const steps = Math.ceil(d / stepM);
      for (let k = 1; k <= steps; k++) {
        out.push([last[0] + ((p[0] - last[0]) * k) / steps, last[1] + ((p[1] - last[1]) * k) / steps]);
      }
      last = p;
    }
    if (last && line.at(-1) !== last) out.push(line.at(-1) as LngLat);
  }
  return out;
}

/**
 * Tiles of one zoom level whose area comes within radiusKm of the lines.
 * Every point of a line is within step/2 of a sample, so testing samples against radius + step/2 misses no tile.
 */
export function tilesNearLines(lines: readonly LngLat[][], z: number, radiusKm: number): TileId[] {
  const n = 2 ** z;
  const radiusM = radiusKm * 1000;
  const tileM = (EARTH_CIRCUMFERENCE_M / n) * Math.cos(((lines[0]?.[0]?.[1] ?? 0) * Math.PI) / 180);
  const stepM = Math.max(50, Math.min(radiusM, tileM) / 4);
  const reachM = radiusM + stepM / 2;
  const tiles = new Map<number, TileId>();
  for (const [lng, lat] of resample(lines, stepM)) {
    const { dLat, dLng } = degreesAround(reachM, lat);
    const x0 = Math.max(0, Math.floor(lngToTileX(lng - dLng, z)));
    const x1 = Math.min(n - 1, Math.floor(lngToTileX(lng + dLng, z)));
    const y0 = Math.max(0, Math.floor(latToTileY(lat + dLat, z)));
    const y1 = Math.min(n - 1, Math.floor(latToTileY(lat - dLat, z)));
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = y * n + x;
        if (tiles.has(key)) continue;
        const nearLng = Math.min(Math.max(lng, tileXToLng(x, z)), tileXToLng(x + 1, z));
        const nearLat = Math.min(Math.max(lat, tileYToLat(y + 1, z)), tileYToLat(y, z));
        if (haversineM(lat, lng, nearLat, nearLng) <= reachM) tiles.set(key, { z, x, y });
      }
    }
  }
  return [...tiles.values()];
}

/** Tile runs for every zoom in radiusKm (zoom -> buffer around the lines in km). */
export function coverageTiles(lines: readonly LngLat[][], radiusKm: ReadonlyMap<number, number>): TileRun[] {
  const tiles: TileId[] = [];
  for (const [z, radius] of radiusKm) tiles.push(...tilesNearLines(lines, z, radius));
  return toTileRuns(tiles);
}
