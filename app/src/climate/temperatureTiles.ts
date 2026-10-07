import { dayOfYear } from '#shared/climate.ts';
import { tileBounds, tileYToLat, TILE_SIZE } from '#shared/tiles.ts';

import type { TileRenderer } from '../offline/tileProtocol.ts';
import { elevationTile } from './elevation.ts';
import { temperatureAt, type ClimateField } from './field.ts';
import { sunTimes } from './sun.ts';
import { isIsoDate, zonedInstant } from './time.ts';

/** Nodes per tile side where the climate is evaluated; pixels interpolate between them and add elevation. */
const LATTICE = 9;

/** °C and colour stops of the overlay: a new hue every 5 °C, and a step from blue to green at freezing. */
export const TEMPERATURE_RAMP: [celsius: number, rgb: [number, number, number]][] = [
  [-20, [44, 12, 79]],
  [-10, [59, 76, 192]],
  [-5, [91, 143, 249]],
  [-0.01, [169, 214, 245]],
  [0, [65, 182, 196]],
  [5, [127, 205, 187]],
  [10, [194, 230, 153]],
  [15, [255, 255, 178]],
  [20, [254, 204, 92]],
  [25, [253, 141, 60]],
  [30, [240, 59, 32]],
  [40, [140, 13, 37]],
];

export function temperatureColor(celsius: number): [number, number, number] {
  const ramp = TEMPERATURE_RAMP;
  if (celsius <= ramp[0][0]) return ramp[0][1];
  for (let i = 1; i < ramp.length; i++) {
    const [t1, c1] = ramp[i];
    if (celsius > t1) continue;
    const [t0, c0] = ramp[i - 1];
    const f = (celsius - t0) / (t1 - t0);
    return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * f)) as [number, number, number];
  }
  return ramp[ramp.length - 1][1];
}

/** A CSS gradient of the ramp for the legend. */
export function temperatureGradient(): string {
  const [lo, hi] = [TEMPERATURE_RAMP[0][0], TEMPERATURE_RAMP[TEMPERATURE_RAMP.length - 1][0]];
  const stops = TEMPERATURE_RAMP.map(
    ([t, [r, g, b]]) => `rgb(${r} ${g} ${b}) ${(((t - lo) / (hi - lo)) * 100).toFixed(1)}%`,
  );
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/**
 * Temperature at sea level and its drop per km of height at the lattice nodes of a tile at one instant (NaN
 * where there is no climate data); lows and highs fall differently with height, so the drop depends on the hour.
 */
function seaLevelLattice(
  field: ClimateField,
  tile: { z: number; x: number; y: number },
  date: string,
  instant: number,
): { sea: Float32Array; dropPerKm: Float32Array } {
  const [west, , east] = tileBounds(tile);
  const day = dayOfYear(date);
  const sea = new Float32Array(LATTICE * LATTICE).fill(NaN);
  const dropPerKm = new Float32Array(LATTICE * LATTICE).fill(NaN);
  const centreLat = tileYToLat(tile.y + 0.5, tile.z);
  const sun = sunTimes(date, centreLat, (west + east) / 2);
  for (let j = 0; j < LATTICE; j++) {
    const lat = tileYToLat(tile.y + j / (LATTICE - 1), tile.z);
    for (let i = 0; i < LATTICE; i++) {
      const lng = west + ((east - west) * i) / (LATTICE - 1);
      const low = field.at(lng, lat, 0, day);
      const high = field.at(lng, lat, 1000, day);
      if (!low || !high) continue;
      const k = j * LATTICE + i;
      sea[k] = temperatureAt(low.tMin, low.tMax, sun, instant);
      dropPerKm[k] = sea[k] - temperatureAt(high.tMin, high.tMax, sun, instant);
    }
  }
  return { sea, dropPerKm };
}

function bilinear(grid: Float32Array, i: number, j: number, fx: number, fy: number): number {
  const a = grid[j * LATTICE + i];
  const b = grid[j * LATTICE + i + 1];
  const c = grid[(j + 1) * LATTICE + i];
  const d = grid[(j + 1) * LATTICE + i + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/** Typical temperature at a date and local hour, from the climate grid and the elevation of every pixel. */
export function temperatureRenderer(field: ClimateField, timeZone: string): TileRenderer {
  return async (tile, params) => {
    const date = params.get('date');
    const hour = Number(params.get('hour'));
    if (!isIsoDate(date) || !Number.isInteger(hour)) return null;
    const lattice = seaLevelLattice(field, tile, date, zonedInstant(date, hour, timeZone));
    if (lattice.sea.every(Number.isNaN)) return null;
    const elevation = await elevationTile(tile.z, tile.x, tile.y);
    if (!elevation) return null;

    const image = new ImageData(TILE_SIZE, TILE_SIZE);
    const step = (LATTICE - 1) / TILE_SIZE;
    for (let py = 0; py < TILE_SIZE; py++) {
      const v = (py + 0.5) * step;
      const j = Math.min(LATTICE - 2, Math.floor(v));
      const fy = v - j;
      for (let px = 0; px < TILE_SIZE; px++) {
        const u = (px + 0.5) * step;
        const i = Math.min(LATTICE - 2, Math.floor(u));
        const fx = u - i;
        const sea = bilinear(lattice.sea, i, j, fx, fy);
        if (Number.isNaN(sea)) continue;
        const k = py * TILE_SIZE + px;
        const drop = bilinear(lattice.dropPerKm, i, j, fx, fy);
        const [r, g, bl] = temperatureColor(sea - (drop * Math.max(0, elevation[k])) / 1000);
        image.data.set([r, g, bl, 255], k * 4);
      }
    }
    const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
    canvas.getContext('2d')?.putImageData(image, 0, 0);
    return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
  };
}

export function temperatureTemplate(date: string, hour: number): string {
  return `tiles://temperature/{z}/{x}/{y}?date=${date}&hour=${hour}`;
}
