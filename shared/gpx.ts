import type { PoiCategory } from './bundle.ts';

/** A track point with its coordinates kept as the exact text of the source file. */
export interface GpxPoint {
  lat: string;
  lon: string;
  ele: string;
}

export interface GpxWaypoint {
  lat: number;
  lng: number;
  name: string;
  description?: string;
  symbol?: string;
  type?: string;
}

export interface GpxTrack {
  name: string;
  description?: string;
  points: readonly GpxPoint[];
}

export interface GpxDocument {
  name: string;
  description?: string;
  creator: string;
  waypoints?: readonly GpxWaypoint[];
  tracks: readonly GpxTrack[];
}

export const GPX_SYMBOLS: Record<PoiCategory, string> = {
  water: 'Drinking Water',
  resupply: 'Shopping Center',
  camp: 'Campground',
  lodging: 'Lodging',
  bike: 'Bike Trail',
  info: 'Information',
};

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};
const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c);
}

function unescapeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return XML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function attribute(attrs: string, name: string): string | undefined {
  return new RegExp(`\\b${name}=(["'])(.*?)\\1`).exec(attrs)?.[2];
}

function element(body: string, name: string): string | undefined {
  const text = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(body)?.[1];
  return text?.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
}

function* elements(xml: string, tag: string): Generator<{ attrs: string; body: string }> {
  const pattern = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
  for (const match of xml.matchAll(pattern)) yield { attrs: match[1] ?? '', body: match[2] ?? '' };
}

export function parseTrackPoints(xml: string): GpxPoint[] {
  const out: GpxPoint[] = [];
  for (const { attrs, body } of elements(xml, 'trkpt')) {
    const lat = attribute(attrs, 'lat');
    const lon = attribute(attrs, 'lon');
    if (lat === undefined || lon === undefined) continue;
    out.push({ lat, lon, ele: element(body, 'ele')?.trim() ?? '' });
  }
  return out;
}

export function countTrackSegments(xml: string): number {
  return xml.match(/<trkseg\b/g)?.length ?? 0;
}

export function parseWaypoints(xml: string): GpxWaypoint[] {
  const out: GpxWaypoint[] = [];
  for (const { attrs, body } of elements(xml, 'wpt')) {
    const lat = Number(attribute(attrs, 'lat'));
    const lng = Number(attribute(attrs, 'lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const name = unescapeXml(element(body, 'name') ?? '').trim();
    const description = unescapeXml((element(body, 'desc') ?? '').replace(/<[^>]+>/g, '')).trim();
    out.push({ lat, lng, name, description });
  }
  return out;
}

function waypointXml(w: GpxWaypoint): string {
  const parts = [
    `  <wpt lat="${w.lat.toFixed(6)}" lon="${w.lng.toFixed(6)}">`,
    `    <name>${escapeXml(w.name)}</name>`,
  ];
  if (w.description) parts.push(`    <desc>${escapeXml(w.description)}</desc>`);
  if (w.symbol) parts.push(`    <sym>${escapeXml(w.symbol)}</sym>`);
  if (w.type) parts.push(`    <type>${escapeXml(w.type)}</type>`);
  parts.push('  </wpt>');
  return parts.join('\n');
}

function trackPointXml(p: GpxPoint): string {
  return p.ele
    ? `      <trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.ele}</ele></trkpt>`
    : `      <trkpt lat="${p.lat}" lon="${p.lon}"></trkpt>`;
}

export function writeGpx(doc: GpxDocument): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="${escapeXml(doc.creator)}">`,
    '  <metadata>',
    `    <name>${escapeXml(doc.name)}</name>`,
  ];
  if (doc.description) lines.push(`    <desc>${escapeXml(doc.description)}</desc>`);
  lines.push('  </metadata>');
  for (const w of doc.waypoints ?? []) lines.push(waypointXml(w));
  for (const track of doc.tracks) {
    lines.push('  <trk>', `    <name>${escapeXml(track.name)}</name>`);
    if (track.description) lines.push(`    <desc>${escapeXml(track.description)}</desc>`);
    lines.push('    <trkseg>');
    for (const p of track.points) lines.push(trackPointXml(p));
    lines.push('    </trkseg>', '  </trk>');
  }
  lines.push('</gpx>', '');
  return lines.join('\n');
}
