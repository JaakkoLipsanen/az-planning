import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { Connect, Plugin } from 'vite';

import type { TripBundle, TripIndex } from '#shared/bundle.ts';
import { escapeXml } from '#shared/gpx.ts';

const HEAD_MARKER = '<!-- trip-head -->';
const THEME_COLOR = '#efe9dc';
const DEFAULT_HEAD = '<title>Trip maps</title>';

interface TripEntry {
  slug: string;
  distDir: string;
  bundle: TripBundle;
}

const bundleCache = new Map<string, { mtimeMs: number; bundle: TripBundle }>();

/** Parses a trip.json once per change; the dev server asks for trips on many requests. */
function readBundle(file: string): TripBundle {
  const { mtimeMs } = statSync(file);
  const cached = bundleCache.get(file);
  if (cached?.mtimeMs === mtimeMs) return cached.bundle;
  const bundle = JSON.parse(readFileSync(file, 'utf8')) as TripBundle;
  bundleCache.set(file, { mtimeMs, bundle });
  return bundle;
}

function readTrips(tripsDir: string): TripEntry[] {
  return readdirSync(tripsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(tripsDir, d.name, 'dist', 'trip.json')))
    .map((d) => {
      const distDir = path.join(tripsDir, d.name, 'dist');
      return { slug: d.name, distDir, bundle: readBundle(path.join(distDir, 'trip.json')) };
    });
}

function tripIndex(trips: readonly TripEntry[]): TripIndex {
  return {
    trips: trips.map(({ bundle }) => ({
      slug: bundle.slug,
      title: bundle.title,
      subtitle: bundle.subtitle,
      stats: bundle.stats,
    })),
  };
}

function manifest({ slug, bundle }: TripEntry): string {
  const icons = `/trips/${slug}/icons`;
  return JSON.stringify(
    {
      name: `${bundle.title} map`,
      short_name: bundle.shortName,
      description: bundle.description,
      start_url: `/${slug}/`,
      scope: `/${slug}/`,
      display: 'standalone',
      orientation: 'any',
      background_color: THEME_COLOR,
      theme_color: THEME_COLOR,
      icons: [
        { src: `${icons}/icon-192.png`, sizes: '192x192', type: 'image/png' },
        { src: `${icons}/icon-512.png`, sizes: '512x512', type: 'image/png' },
        { src: `${icons}/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    1,
  );
}

function tripHead({ slug, bundle }: TripEntry): string {
  return [
    `<title>${escapeXml(bundle.title)} map</title>`,
    `<meta name="description" content="${escapeXml(bundle.description ?? bundle.title)}">`,
    `<link rel="manifest" href="/${slug}/manifest.webmanifest">`,
    `<link rel="icon" type="image/png" href="/trips/${slug}/icons/icon-192.png">`,
    `<link rel="apple-touch-icon" href="/trips/${slug}/icons/apple-touch-icon.png">`,
    `<meta name="apple-mobile-web-app-title" content="${escapeXml(bundle.shortName)}">`,
  ].join('\n    ');
}

function filesIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) =>
    statSync(path.join(dir, f)).isFile(),
  );
}

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.gpx': 'application/gpx+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

const TRIP_FILE = /^\/trips\/([^/]+)\/(.+)$/;
const TRIP_MANIFEST = /^\/([^/]+)\/manifest\.webmanifest$/;

/** Serves trips/<slug>/dist under /trips/<slug>/ and gives every trip its own installable page at /<slug>/. */
export function tripsPlugin(tripsDir: string): Plugin {
  const devMiddleware: Connect.NextHandleFunction = (req, res, next) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const file = TRIP_FILE.exec(pathname);
    const manifestFor = TRIP_MANIFEST.exec(pathname)?.[1];
    if (pathname !== '/trips/index.json' && !file && !manifestFor) return next();
    const send = (body: string | Buffer, type: string): void => {
      res.setHeader('Content-Type', type);
      res.end(body);
    };
    const trips = readTrips(tripsDir);
    if (pathname === '/trips/index.json')
      return send(JSON.stringify(tripIndex(trips)), CONTENT_TYPES['.json']);
    const trip = trips.find((t) => t.slug === (file?.[1] ?? manifestFor));
    if (!trip) return next();
    if (manifestFor) return send(manifest(trip), CONTENT_TYPES['.webmanifest']);
    const target = path.join(trip.distDir, file?.[2] ?? '');
    if (!target.startsWith(trip.distDir + path.sep) || !existsSync(target)) return next();
    send(readFileSync(target), CONTENT_TYPES[path.extname(target)] ?? 'application/octet-stream');
  };

  return {
    name: 'trips',
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use(devMiddleware);
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        // The build writes one page per trip in generateBundle and needs the marker kept.
        if (!ctx.server) return html;
        const slug = ctx.originalUrl?.split('/')[1];
        const trip = slug ? readTrips(tripsDir).find((t) => t.slug === slug) : undefined;
        return html.replace(HEAD_MARKER, trip ? tripHead(trip) : DEFAULT_HEAD);
      },
    },
    generateBundle(_options, bundle) {
      const index = bundle['index.html'];
      if (index?.type !== 'asset') throw new Error('trips plugin: index.html missing from the bundle');
      const html = String(index.source);
      if (!html.includes(HEAD_MARKER))
        throw new Error(`trips plugin: ${HEAD_MARKER} missing from index.html`);
      index.source = html.replace(HEAD_MARKER, DEFAULT_HEAD);
      this.emitFile({ type: 'asset', fileName: '404.html', source: index.source });
      const trips = readTrips(tripsDir);
      this.emitFile({
        type: 'asset',
        fileName: 'trips/index.json',
        source: JSON.stringify(tripIndex(trips)),
      });
      for (const trip of trips) {
        for (const file of filesIn(trip.distDir)) {
          this.emitFile({
            type: 'asset',
            fileName: `trips/${trip.slug}/${file}`,
            source: readFileSync(path.join(trip.distDir, file)),
          });
        }
        this.emitFile({
          type: 'asset',
          fileName: `${trip.slug}/index.html`,
          source: html.replace(HEAD_MARKER, tripHead(trip)),
        });
        this.emitFile({
          type: 'asset',
          fileName: `${trip.slug}/manifest.webmanifest`,
          source: manifest(trip),
        });
      }
    },
  };
}
