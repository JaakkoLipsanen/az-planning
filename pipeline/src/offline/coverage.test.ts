import { describe, expect, it } from 'vitest';

import { degreesAround, haversineM, type LngLat } from '#shared/geo.ts';
import { countTiles, fromTileRuns, tileBounds, tileKey, tilesInBounds } from '#shared/tiles.ts';

import { coverageTiles, tilesNearLines } from './coverage.ts';

const line: LngLat[] = [
  [-111, 32],
  [-110.5, 32.2],
];

function distanceToTileKm(lng: number, lat: number, z: number, x: number, y: number): number {
  const [w, s, e, n] = tileBounds({ z, x, y });
  return haversineM(lat, lng, Math.min(Math.max(lat, s), n), Math.min(Math.max(lng, w), e)) / 1000;
}

describe('tilesNearLines', () => {
  it('covers every tile the line passes through', () => {
    const tiles = tilesNearLines([line], 14, 0.1);
    for (const [lng, lat] of line) {
      expect(tiles.some((t) => distanceToTileKm(lng, lat, t.z, t.x, t.y) === 0)).toBe(true);
    }
  });

  it('grows with the radius and stays close to it', () => {
    const narrow = tilesNearLines([line], 12, 2).length;
    const wide = tilesNearLines([line], 12, 20).length;
    expect(wide).toBeGreaterThan(narrow);
    for (const t of tilesNearLines([[line[0]]], 12, 20))
      expect(distanceToTileKm(-111, 32, t.z, t.x, t.y)).toBeLessThanOrEqual(20 * 1.125);
  });

  it('includes every tile within the radius of any point of the line', () => {
    const [z, radiusKm] = [13, 3];
    const included = new Set(tilesNearLines([line], z, radiusKm).map(tileKey));
    const missing: string[] = [];
    for (let k = 0; k <= 100; k++) {
      const lng = line[0][0] + ((line[1][0] - line[0][0]) * k) / 100;
      const lat = line[0][1] + ((line[1][1] - line[0][1]) * k) / 100;
      const { dLat, dLng } = degreesAround(radiusKm * 1000, lat);
      const near = tilesInBounds([lng - dLng, lat - dLat, lng + dLng, lat + dLat], z).filter(
        (t) => distanceToTileKm(lng, lat, t.z, t.x, t.y) <= radiusKm,
      );
      missing.push(...near.map(tileKey).filter((key) => !included.has(key)));
    }
    expect(missing).toEqual([]);
  });
});

describe('coverageTiles', () => {
  it('combines zoom levels into runs', () => {
    const runs = coverageTiles(
      [line],
      new Map([
        [10, 30],
        [12, 5],
      ]),
    );
    const zooms = new Set([...fromTileRuns(runs)].map((t) => t.z));
    expect(zooms).toEqual(new Set([10, 12]));
    expect(countTiles(runs)).toBe(
      tilesNearLines([line], 10, 30).length + tilesNearLines([line], 12, 5).length,
    );
  });
});
