import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Resvg } from '@resvg/resvg-js';

import { boundsOf, simplify, type LngLat } from '#shared/geo.ts';

const BACKGROUND = '#b5531c';
const FINISH = '#ffd21f';
const SIZE = 512;

/** The route outline in white on the accent colour; padding leaves room for maskable icon crops. */
function iconSvg(route: readonly LngLat[], padding: number): string {
  const [west, south, east, north] = boundsOf(route);
  const kx = Math.cos(((south + north) / 2) * (Math.PI / 180));
  const width = (east - west) * kx;
  const height = north - south;
  const scale = (SIZE * (1 - 2 * padding)) / Math.max(width, height);
  const ox = (SIZE - width * scale) / 2;
  const oy = (SIZE - height * scale) / 2;
  const xy = simplify(route, 500).map(([lng, lat]) => [
    ox + (lng - west) * kx * scale,
    oy + (north - lat) * scale,
  ]);
  const [start, end] = [xy[0], xy.at(-1) ?? xy[0]];
  const stroke = SIZE * 0.03;
  const dot = SIZE * 0.045;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="${BACKGROUND}"/>
  <polyline points="${xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="none" stroke="#fff" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${start[0]}" cy="${start[1]}" r="${dot}" fill="#fff"/>
  <circle cx="${end[0]}" cy="${end[1]}" r="${dot}" fill="${FINISH}" stroke="#fff" stroke-width="${SIZE * 0.01}"/>
</svg>`;
}

function png(svg: string, size: number): Buffer {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

const ICON_FILES = {
  icon192: 'icons/icon-192.png',
  icon512: 'icons/icon-512.png',
  maskable512: 'icons/icon-maskable-512.png',
  appleTouch: 'icons/apple-touch-icon.png',
} as const;

export async function writeIcons(distDir: string, route: readonly LngLat[]): Promise<void> {
  await mkdir(path.join(distDir, 'icons'), { recursive: true });
  const regular = iconSvg(route, 0.14);
  const maskable = iconSvg(route, 0.22);
  await Promise.all([
    writeFile(path.join(distDir, ICON_FILES.icon192), png(regular, 192)),
    writeFile(path.join(distDir, ICON_FILES.icon512), png(regular, 512)),
    writeFile(path.join(distDir, ICON_FILES.maskable512), png(maskable, 512)),
    writeFile(path.join(distDir, ICON_FILES.appleTouch), png(regular, 180)),
  ]);
}
