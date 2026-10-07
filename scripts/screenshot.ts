/* oxlint-disable no-console */
import { parseArgs } from 'node:util';

import { chromium } from '@playwright/test';

const USAGE = `Usage: pnpm screenshot <url> [--out shot.png] [--width 1300] [--height 850] [--eval "js"] [--dark]

Opens the page in headless Chromium, waits until the map has finished drawing, saves a screenshot
and prints console errors. --eval runs JavaScript in the page first (e.g. clicks) and prints its result.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', default: 'screenshot.png' },
    width: { type: 'string', default: '1300' },
    height: { type: 'string', default: '850' },
    eval: { type: 'string' },
    dark: { type: 'boolean', default: false },
    timeout: { type: 'string', default: '60000' },
  },
});
const [url] = positionals;
if (!url) {
  console.log(USAGE);
  process.exit(1);
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({
  viewport: { width: Number(values.width), height: Number(values.height) },
  colorScheme: values.dark ? 'dark' : 'light',
});
const problems: string[] = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') problems.push(`${msg.type()}: ${msg.text()}`);
});
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

const waitForFirstIdle = async (): Promise<void> => {
  await page
    .waitForFunction(
      () => Number(document.querySelector<HTMLElement>('[data-testid=map]')?.dataset.idleCount ?? 0) > 0,
      null,
      {
        timeout: Number(values.timeout),
      },
    )
    .catch(() => problems.push('map did not become idle before the timeout'));
};

await page.goto(url);
await page
  .waitForSelector('main', { timeout: Number(values.timeout) })
  .catch(() => problems.push('page did not render <main>'));
const hasMap = (await page.locator('[data-testid=map]').count()) > 0;
if (hasMap) await waitForFirstIdle();
if (values.eval) {
  console.log('eval:', JSON.stringify(await page.evaluate(values.eval)));
  await page.waitForTimeout(400);
  if (hasMap) {
    await page
      .waitForFunction(() => !document.querySelector<HTMLElement>('[data-testid=map]')?.dataset.busy, null, {
        timeout: Number(values.timeout),
      })
      .catch(() => problems.push('map still busy at the timeout'));
  }
}
await page.screenshot({ path: values.out });
console.log(`saved ${values.out}`);
for (const p of problems) console.log(p);
await browser.close();
