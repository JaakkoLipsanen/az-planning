import { PNG } from 'pngjs';

import { TILE_SOURCES, tileUrl } from '#shared/basemaps.ts';
import type { TripBundle } from '#shared/bundle.ts';
import { latToTileY, lngToTileX } from '#shared/tiles.ts';

import {
  BUNDLE,
  expect,
  failTiles,
  map,
  mapIdle,
  mapSettled,
  serveBundle,
  serveTileColor,
  test,
  TRIP,
} from './fixtures.ts';

const TILES_PER_PACK = 6;
/** Downloading stores the trip's GPX files too (about 12 MB), which can take a while on a busy machine. */
const DOWNLOAD = { timeout: 30_000 };

/** The real packs hold thousands of tiles; a few per pack keep the test fast. */
function tinyPacks(bundle: TripBundle): TripBundle {
  for (const pack of bundle.offline?.packs ?? []) {
    pack.tiles = pack.tiles.slice(0, 1).map(([z, x, y0]) => [z, x, y0, y0 + TILES_PER_PACK - 1]);
    pack.tileCount = TILES_PER_PACK;
  }
  return bundle;
}

test('a downloaded trip opens and draws without a network', async ({ page, context, consoleErrors }) => {
  await serveBundle(page, tinyPacks);

  await page.goto(`/${TRIP}/`);
  await mapIdle(page);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await page.getByRole('button', { name: /^Download/ }).click();
  await expect(page.getByText('✓ Ready offline')).toBeVisible(DOWNLOAD);
  await expect(page.locator('header').getByRole('button', { name: 'Offline ✓' })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await mapIdle(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Arizona Grand Tour');
  await expect(page.getByText('✓ Ready offline')).toBeVisible();
  const [gpx] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Whole route', exact: true }).click(),
  ]);
  expect(gpx.suggestedFilename()).toMatch(/_full\.gpx$/);
  expect(consoleErrors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(e))).toEqual([]);
});

test('a rebuilt trip asks for its files again', async ({ page }) => {
  let version = 'first';
  await serveBundle(page, (bundle) => ({ ...tinyPacks(bundle), version }));
  await page.goto(`/${TRIP}/`);
  await mapIdle(page);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.getByRole('button', { name: /^Download/ }).click();
  await expect(page.getByText('✓ Ready offline')).toBeVisible(DOWNLOAD);

  version = 'second';
  await page.reload();
  await mapIdle(page);
  await expect(page.getByText('Trip updated')).toBeVisible();
  await page.getByRole('button', { name: /^Download/ }).click();
  await expect(page.getByText('✓ Ready offline')).toBeVisible(DOWNLOAD);
  const versions = await page.evaluate(async (trip) => {
    const cache = await caches.open(`trip-files:${trip}`);
    return (await cache.keys()).map((r) => new URL(r.url).searchParams.get('v')).filter(Boolean);
  }, TRIP);
  expect(new Set(versions)).toEqual(new Set(['second']));
});

test('offline, past the stored zoom levels, the map scales up a stored tile', async ({ page, context }) => {
  const index = Math.floor(BUNDLE.profile.km.length / 2);
  const [lng, lat, km] = [BUNDLE.profile.lng[index], BUNDLE.profile.lat[index], BUNDLE.profile.km[index]];
  const z = 10;
  const [x, y] = [Math.floor(lngToTileX(lng, z)), Math.floor(latToTileY(lat, z))];
  await serveBundle(page, (bundle) => {
    const pack = bundle.offline?.packs.find((p) => p.source === bundle.imagery?.default);
    if (!pack || !bundle.offline) throw new Error('no pack for the default basemap');
    bundle.offline.packs = [{ ...pack, tiles: [[z, x, y, y]], tileCount: 1 }];
    return bundle;
  });
  // Only the stored tile is red, so red at zoom 13 can only come from scaling it up.
  const source = BUNDLE.imagery?.default ?? 'usgs-topo';
  await serveTileColor(page, tileUrl(TILE_SOURCES[source].url, z, x, y), [200, 30, 30]);
  await page.goto(`/${TRIP}/`);
  await mapIdle(page);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.getByRole('button', { name: /^Download/ }).click();
  await expect(page.getByText('✓ Ready offline')).toBeVisible(DOWNLOAD);

  await context.setOffline(true);
  await failTiles(page);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('searchbox').fill(`km ${km}`);
  await page.getByRole('searchbox').press('Enter');
  await mapSettled(page);
  const shot = PNG.sync.read(await map(page).screenshot());
  let red = 0;
  let samples = 0;
  for (let py = 20; py < shot.height; py += 40) {
    for (let px = 20; px < shot.width; px += 40) {
      const i = (py * shot.width + px) * 4;
      samples++;
      if (shot.data[i] > 150 && shot.data[i + 1] < 90 && shot.data[i + 2] < 90) red++;
    }
  }
  expect(red / samples).toBeGreaterThan(0.5);
});
