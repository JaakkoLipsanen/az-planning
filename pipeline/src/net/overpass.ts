import { cachedJson } from './http.ts';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
}

interface OverpassResult {
  elements: OverpassElement[];
  remark?: string;
}

/** Overpass reports timeouts and memory limits with HTTP 200 and a remark; those results are incomplete. */
function rejectRemarks(data: Buffer): void {
  const { remark } = JSON.parse(data.toString('utf8')) as OverpassResult;
  if (remark && /error|timed out|out of memory/i.test(remark)) throw new Error(`Overpass: ${remark}`);
}

export async function overpass(query: string): Promise<OverpassElement[]> {
  const result = await cachedJson<OverpassResult>(ENDPOINT, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validate: rejectRemarks,
  });
  return result.elements;
}
