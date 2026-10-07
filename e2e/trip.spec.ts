import type { Page } from '@playwright/test';

import { TILE_SOURCES } from '#shared/basemaps.ts';
import type { TripBundle } from '#shared/bundle.ts';

import {
  BUNDLE,
  clickProfile,
  expect,
  map,
  mapIdle,
  mapSettled,
  openTrip,
  serveBundle,
  test,
  TRIP,
  WEATHER_HOST,
} from './fixtures.ts';

const DISTANCE = `${Math.round(BUNDLE.stats.distanceKm).toLocaleString('en-US')} km`;
const DAYS = BUNDLE.plan?.defaultDays ?? 1;
const dayCards = (page: Page) => page.getByRole('list').getByRole('button', { name: /^Day \d+/ });

test('lists the trips and opens one', async ({ page, consoleErrors }) => {
  await page.goto('/');
  await page.getByRole('link', { name: new RegExp(BUNDLE.title) }).click();
  await expect(page).toHaveURL(new RegExp(`/${TRIP}/$`));
  await mapIdle(page);
  expect(consoleErrors).toEqual([]);
});

test('the trip page can be installed on its own', async ({ page }) => {
  await page.goto(`/${TRIP}/`);
  await expect(page).toHaveTitle(`${BUNDLE.title} map`);
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  expect(href).toBe(`/${TRIP}/manifest.webmanifest`);
  const manifest = (await (await page.request.get(href ?? '')).json()) as {
    start_url: string;
    icons: unknown[];
  };
  expect(manifest.start_url).toBe(`/${TRIP}/`);
  expect(manifest.icons.length).toBeGreaterThan(0);
  await expect(page.locator('link[rel=apple-touch-icon]')).toHaveAttribute(
    'href',
    `/trips/${TRIP}/icons/apple-touch-icon.png`,
  );
});

test('renders the trip with its day plan', async ({ page, consoleErrors }, testInfo) => {
  await openTrip(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(BUNDLE.title);
  await expect(page.locator('header')).toContainText(DISTANCE);
  await expect(dayCards(page)).toHaveCount(DAYS);
  await testInfo.attach('trip', { body: await page.screenshot(), contentType: 'image/png' });
  expect(consoleErrors).toEqual([]);
});

test('day count changes the plan and is remembered', async ({ page }) => {
  await openTrip(page);
  await page.getByRole('button', { name: 'One day more' }).click();
  await expect(dayCards(page)).toHaveCount(DAYS + 1);
  await expect(page.locator('header')).toContainText(`${DAYS + 1} days`);
  await page.reload();
  await mapIdle(page);
  await expect(page.locator('header')).toContainText(`${DAYS + 1} days`);
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(page.locator('header')).toContainText(`${DAYS} days`);
  expect(await page.evaluate((trip) => localStorage.getItem(`trip:${trip}:settings`), TRIP)).toBeNull();
});

test('hovering the profile shows the position on the map', async ({ page }) => {
  await openTrip(page);
  const box = await page.getByTestId('elevation-profile').boundingBox();
  if (!box) throw new Error('profile not visible');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
  await expect(page.getByText(/est\. speed/)).toBeVisible();
  await expect(page.locator('.maplibregl-marker')).toContainText(/Day \d+: .* remaining/);
  await page.mouse.move(box.x + box.width * 0.5, box.y - 200);
  await expect(page.locator('.maplibregl-marker')).toHaveCount(0);
});

test('clicking the profile selects a day and route clicks open popups', async ({ page }) => {
  await openTrip(page);
  await clickProfile(page, 0.3);
  await expect(page.getByRole('button', { pressed: true })).toHaveCount(1);
  await mapSettled(page);

  const box = await map(page).boundingBox();
  if (!box) throw new Error('map not visible');
  const popup = page.locator('.maplibregl-popup');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(popup).toContainText('Final route section');
  await page.mouse.click(box.x + box.width / 2 + 1, box.y + box.height / 2 + 1);
  await expect(popup).toHaveCount(1);
  await expect(popup).toContainText('Final route section');
});

test('exports GPX files', async ({ page }) => {
  await openTrip(page);
  const [full] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Whole route', exact: true }).click(),
  ]);
  expect(full.suggestedFilename()).toBe(BUNDLE.files?.gpxFull);
  const [days] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Each day/ }).click(),
  ]);
  expect(days.suggestedFilename()).toBe(`${TRIP}_${DAYS}days_all_days_gpx.zip`);
});

test('switches the basemap', async ({ page }) => {
  await openTrip(page);
  await page
    .getByTitle(TILE_SOURCES[BUNDLE.imagery?.default ?? 'terrain'].title)
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Map type' });
  await dialog.getByTitle(/aerial imagery/).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTitle(/aerial imagery/)).toBeVisible();
  const stored = await page.evaluate((trip) => localStorage.getItem(`trip:${trip}:settings`), TRIP);
  expect(JSON.parse(stored ?? '{}')).toEqual({ state: { basemap: 'usgs-imagery' }, version: 1 });
});

test('works on a phone-sized screen', async ({ page, consoleErrors }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTrip(page);
  const sidebar = page.getByRole('complementary', { name: 'Layers and day plan' });
  await expect(sidebar).not.toBeInViewport();
  await page.getByRole('button', { name: 'Layers' }).click();
  await expect(sidebar).toBeInViewport();
  await page.getByRole('button', { name: 'Close the panel' }).click();
  await expect(sidebar).not.toBeInViewport();
  expect(consoleErrors).toEqual([]);
});

test('a minimal bundle with an unknown tile source still works', async ({ page, consoleErrors }) => {
  await serveBundle(page, (bundle): TripBundle => ({
    schemaVersion: bundle.schemaVersion,
    slug: bundle.slug,
    version: 'minimal',
    title: bundle.title,
    shortName: bundle.shortName,
    bounds: bundle.bounds,
    region: bundle.region,
    stats: bundle.stats,
    kinds: bundle.kinds,
    sections: bundle.sections,
    profile: bundle.profile,
    imagery: { basemaps: ['future-source' as 'terrain', 'usgs-topo'], default: 'future-source' as 'terrain' },
  }));
  await openTrip(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(BUNDLE.title);
  await expect(page.locator('header')).not.toContainText('days');
  await clickProfile(page, 0.5);
  await expect(page.getByText(/est\. speed/)).toBeVisible();
  await expect(page.getByText(/Day \d+/)).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test('a start date adds dates, light and typical weather', async ({ page, consoleErrors }) => {
  await openTrip(page);
  await page.getByLabel('Start date').fill('2026-12-03');
  const first = dayCards(page).first();
  await expect(first).toContainText('Thu 3 Dec');
  await expect(first).toContainText(/ride \d\d:\d\d–\d\d:\d\d/);
  await expect(first).toContainText(/highs .*°C · night/);
  await page.getByRole('radio', { name: '°C' }).click();
  await expect(page.getByText(/Typical daily low and high/)).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('shows typical temperatures on the map for a date and hour', async ({ page, consoleErrors }) => {
  await openTrip(page);
  await page
    .getByTitle(TILE_SOURCES[BUNDLE.imagery?.default ?? 'terrain'].title)
    .first()
    .click();
  await page.getByLabel('Typical temperature at a date and hour').check();
  await page.keyboard.press('Escape');
  const control = page.getByRole('group', { name: 'Temperature overlay' });
  await expect(control).toBeVisible();
  await control.getByLabel('Hour').fill('15');
  await expect(control).toContainText('15:00');
  await expect(page.getByTestId('route-temperature')).toContainText(/min\s*−?\d+ °C\s*km \d+/);
  await expect(page.getByTestId('route-temperature')).toContainText(/avg\s*−?\d+ °C/);
  await mapSettled(page);
  const box = await map(page).boundingBox();
  if (!box) throw new Error('map not visible');
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.55);
  await expect(page.locator('.maplibregl-marker')).toContainText(/Typical −?\d+ °C at 15:00 · 1,000 m/);
  await control.getByRole('button', { name: 'Hide the temperature overlay' }).click();
  await expect(control).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test('measures distances between clicked points', async ({ page }) => {
  await openTrip(page);
  await page.getByRole('button', { name: 'Measure distances' }).click();
  const box = await map(page).boundingBox();
  if (!box) throw new Error('map not visible');
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await expect(page.getByTestId('measure-total')).toContainText('km');
  await expect(page.locator('.maplibregl-popup')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('measure-total')).toHaveText('');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('group', { name: 'Distance measurement' })).toHaveCount(0);
});

test.describe('on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('tapping the route opens a popup that fits the screen', async ({ page, consoleErrors }) => {
    await openTrip(page);
    const profile = await page.getByTestId('elevation-profile').boundingBox();
    const box = await map(page).boundingBox();
    if (!profile || !box) throw new Error('map or profile not visible');
    await page.touchscreen.tap(profile.x + profile.width * 0.62, profile.y + profile.height * 0.6);
    await mapSettled(page);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

    const popup = page.locator('.maplibregl-popup');
    await expect(popup).toContainText('Final route section');
    await mapSettled(page);
    const rect = await popup.boundingBox();
    expect(rect && rect.x >= box.x && rect.x + rect.width <= box.x + box.width).toBe(true);
    await expect(page.locator('.maplibregl-marker [class*=label]')).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
  });

  test('the position card shows the day, tonight and the next water', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: BUNDLE.profile.lat[3000], longitude: BUNDLE.profile.lng[3000] });
    await openTrip(page);
    await page.getByRole('button', { name: /Find my location/i }).click();
    const card = page.getByTestId('position-card');
    await expect(card).toContainText(/Route km \d+/);
    await expect(card).toContainText(/Day \d+ of \d+/);
    await expect(card).toContainText(/Water: [\d.]+ km/);
    await expect(card.getByRole('button', { name: /Sleep here tonight/ })).toBeVisible();
  });

  test('tapping the map with the temperature overlay on shows the temperature there', async ({ page }) => {
    await page.addInitScript(
      ([trip]) =>
        localStorage.setItem(
          `trip:${trip}:settings`,
          JSON.stringify({ state: { temperatureOverlay: true }, version: 1 }),
        ),
      [TRIP],
    );
    await openTrip(page);
    const box = await map(page).boundingBox();
    if (!box) throw new Error('map not visible');
    await page.touchscreen.tap(box.x + box.width * 0.3, box.y + box.height * 0.7);
    await expect(page.locator('.maplibregl-popup')).toContainText(/Typical −?\d+ °C at 06:00/);
  });
});

test('lists the longest stretches without water and resupply', async ({ page }) => {
  await openTrip(page);
  const panel = page.locator('#supplies');
  await expect(panel).toContainText('Longest without water');
  await expect(panel.getByRole('listitem').first()).toContainText(/\d+ km · km \d+–\d+ · .*carry ~[\d.]+ l/);
  await panel.getByLabel(/creeks, springs and tanks/).check();
  const stored = await page.evaluate((trip) => localStorage.getItem(`trip:${trip}:settings`), TRIP);
  expect(JSON.parse(stored ?? '{}').state).toEqual({ waterNatural: true });
  await expect(page.locator('#checklist')).toContainText(BUNDLE.checklist?.[0].text ?? '');
});

test('search finds a point the route passes twice and shows both passes', async ({ page }) => {
  const twice = BUNDLE.pois?.items.find((p) => p.kms && !p.osm && p.category === 'resupply');
  if (!twice?.kms) throw new Error('the bundle has no point passed twice');
  await openTrip(page);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('searchbox').fill(twice.name);
  await page.getByRole('searchbox').press('Enter');
  const popup = page.locator('.maplibregl-popup');
  await expect(popup).toContainText(twice.name);
  await expect(popup).toContainText(`route km ${twice.kms.join(' and ')}`);
  await expect(popup.getByRole('button', { name: /^Sleep here at km/ })).toHaveCount(twice.kms.length);
});

test('a night can be fixed and followed by a rest day', async ({ page }) => {
  await openTrip(page);
  await page.getByLabel('Start date').fill('2026-12-03');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('searchbox').fill('night 3');
  await page.getByRole('searchbox').press('Enter');
  const popup = page.locator('.maplibregl-popup');
  await expect(popup).toContainText(/^Night 3:/);
  await popup.getByRole('button', { name: 'Rest day here' }).click();
  const plan = page.locator('#day-plan');
  await expect(plan).toContainText(`${DAYS} riding days + 1 rest day`);
  await expect(plan).toContainText('1 night fixed by you');
  await expect(plan.getByText(/^Rest day/)).toHaveCount(1);
  await expect(dayCards(page).nth(3)).toContainText('Mon 7 Dec');
  await popup.getByRole('button', { name: 'Remove the rest day' }).click();
  await expect(plan).toContainText(`${DAYS} riding days`);
  await expect(plan.getByText(/^Rest day/)).toHaveCount(0);
});

test('the profile zooms to the selected day and follows the arrow keys', async ({ page }) => {
  await openTrip(page);
  await dayCards(page).nth(2).click();
  const zoom = page.getByRole('button', { name: 'Show the whole route in the profile' });
  await expect(zoom).toBeVisible();
  const profile = page.getByTestId('elevation-profile');
  await profile.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText(/est\. speed/)).toBeVisible();
  await zoom.click();
  await expect(page.getByRole('button', { name: 'Show only day 3 in the profile' })).toBeVisible();
  await page.getByRole('radio', { name: 'Gradient' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText('12 % and steeper').first()).toBeVisible();
});

test('a shared plan link shows its plan until the user keeps it or goes back', async ({ page }) => {
  const encoded = Buffer.from(JSON.stringify({ days: DAYS + 2 })).toString('base64url');
  await page.goto(`/${TRIP}/#plan=${encoded}`);
  await mapIdle(page);
  await expect(page.locator('header')).toContainText(`${DAYS + 2} days`);
  await expect(page).toHaveURL(new RegExp(`/${TRIP}/$`));
  await page.getByRole('button', { name: 'Back to my settings' }).click();
  await expect(page.locator('header')).toContainText(`${DAYS} days`);
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('days within the next week show the weather forecast', async ({ page }) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: BUNDLE.timezone }).format(new Date());
  const forecast = `https://${WEATHER_HOST}/gridpoints/TWC/1,1/forecast`;
  await page.route(
    (url) => url.host === WEATHER_HOST,
    (route) =>
      route.fulfill({
        json: route.request().url().includes('/points/')
          ? { properties: { forecast } }
          : {
              properties: {
                periods: [
                  {
                    startTime: `${today}T06:00:00-07:00`,
                    isDaytime: true,
                    temperature: 21,
                    probabilityOfPrecipitation: { value: 10 },
                    windSpeed: '5 to 15 km/h',
                    windDirection: 'NW',
                    shortForecast: 'Sunny',
                  },
                  {
                    startTime: `${today}T18:00:00-07:00`,
                    isDaytime: false,
                    temperature: 4,
                    probabilityOfPrecipitation: { value: 0 },
                    windSpeed: '5 km/h',
                    windDirection: 'N',
                    shortForecast: 'Clear',
                  },
                ],
              },
            },
      }),
  );
  await openTrip(page);
  await page.getByLabel('Start date').fill(today);
  await expect(dayCards(page).first()).toContainText(
    'Forecast: Sunny · 21 °C / 4 °C · rain 10 % · NW 5–15 km/h',
  );
});
