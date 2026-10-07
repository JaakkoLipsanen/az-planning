import type { TripBundle } from '#shared/bundle.ts';

import { expect, mapIdle, serveBundle, test, TRIP } from './fixtures.ts';

const TILES_PER_PACK = 6;

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
  await expect(page.getByText('✓ Ready offline')).toBeVisible();
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
  await expect(page.getByText('✓ Ready offline')).toBeVisible();

  version = 'second';
  await page.reload();
  await mapIdle(page);
  await expect(page.getByText('Trip updated')).toBeVisible();
  await page.getByRole('button', { name: /^Download/ }).click();
  await expect(page.getByText('✓ Ready offline')).toBeVisible();
  const versions = await page.evaluate(async (trip) => {
    const cache = await caches.open(`trip-files:${trip}`);
    return (await cache.keys()).map((r) => new URL(r.url).searchParams.get('v')).filter(Boolean);
  }, TRIP);
  expect(new Set(versions)).toEqual(new Set(['second']));
});
