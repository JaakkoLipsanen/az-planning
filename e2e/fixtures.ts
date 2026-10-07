import { readFileSync } from 'node:fs';

import { expect, test as base, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

import { TILE_SOURCES } from '#shared/basemaps.ts';
import type { TripBundle } from '#shared/bundle.ts';

export const TRIP = 'az-grand-tour';
export const BUNDLE = JSON.parse(
  readFileSync(new URL(`../trips/${TRIP}/dist/trip.json`, import.meta.url), 'utf8'),
) as TripBundle;

function solidPng(r: number, g: number, b: number): Buffer {
  const png = new PNG({ width: 256, height: 256 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([r, g, b, 255], i);
  return PNG.sync.write(png);
}

/** Stand-ins for the online tile servers: a flat raster and a Terrarium tile at 1000 m. */
const RASTER_TILE = solidPng(214, 205, 182);
const DEM_TILE = solidPng(131, 232, 0);
const tileHosts = (kind: 'raster' | 'dem'): Set<string> =>
  new Set(Object.values(TILE_SOURCES).flatMap((s) => (s.kind === kind ? [new URL(s.url).host] : [])));
const RASTER_HOSTS = tileHosts('raster');
const DEM_HOSTS = tileHosts('dem');

const BENIGN = [/GPU stall/, /Geolocation support is not available/];

export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if ((msg.type() === 'error' || msg.type() === 'warning') && !BENIGN.some((re) => re.test(msg.text())))
        errors.push(msg.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await use(errors);
  },
  page: async ({ page }, use) => {
    await page.route(
      (url) => RASTER_HOSTS.has(url.host),
      (route) => route.fulfill({ body: RASTER_TILE, contentType: 'image/png' }),
    );
    await page.route(
      (url) => DEM_HOSTS.has(url.host),
      (route) => route.fulfill({ body: DEM_TILE, contentType: 'image/png' }),
    );
    await use(page);
  },
});

export { expect };

export const map = (page: Page) => page.getByTestId('map');

/** Waits until MapLibre has rendered everything at least `after` + 1 times. */
export async function mapIdle(page: Page, after = 0): Promise<void> {
  await expect
    .poll(async () => Number((await map(page).getAttribute('data-idle-count')) ?? 0))
    .toBeGreaterThan(after);
}

/** Waits until the map is neither moving nor loading. */
export async function mapSettled(page: Page): Promise<void> {
  await page.waitForTimeout(300);
  await expect(map(page)).not.toHaveAttribute('data-busy');
}

export async function openTrip(page: Page): Promise<void> {
  await page.goto(`/${TRIP}/`);
  await mapIdle(page);
}

/** Serves a modified copy of the trip bundle, for testing older or newer bundles. */
export async function serveBundle(page: Page, edit: (bundle: TripBundle) => TripBundle): Promise<void> {
  await page.route(`**/trips/${TRIP}/trip.json`, async (route) => {
    const bundle = (await (await route.fetch()).json()) as TripBundle;
    await route.fulfill({ json: edit(bundle) });
  });
}

export async function clickProfile(page: Page, share: number): Promise<void> {
  const box = await page.getByTestId('elevation-profile').boundingBox();
  if (!box) throw new Error('profile not visible');
  await page.mouse.click(box.x + box.width * share, box.y + box.height * 0.6);
}
