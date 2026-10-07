import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import { log } from '../log.ts';
import { CACHE_DIR } from '../paths.ts';

const USER_AGENT = 'trip-planner-pipeline/1.0 (personal bikepacking trip planning)';
const MAX_ATTEMPTS = 4;

let cacheOnly = false;

/** Serve every request from .cache/ (also expired entries) and fail on anything missing from it. */
export function setCacheOnly(on: boolean): void {
  cacheOnly = on;
}

export interface FetchOptions {
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  /** Treat 404 / 204 as "no data" (cached as such) instead of an error. */
  allowMissing?: boolean;
  /** Re-fetch cached responses older than this. Default: cached forever. */
  maxAgeDays?: number;
  /** Throws for responses that must not be cached, such as errors reported with HTTP 200. */
  validate?: (data: Buffer) => void;
}

class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function cachePath(url: string, options: FetchOptions): string {
  const hash = createHash('sha256')
    .update(`${options.method ?? 'GET'} ${url}\n${options.body ?? ''}`)
    .digest('hex');
  return path.join(CACHE_DIR, 'http', hash.slice(0, 2), hash);
}

async function readCached(file: string, maxAgeDays: number | undefined): Promise<Buffer | null | undefined> {
  try {
    const info = await stat(file);
    if (maxAgeDays !== undefined && Date.now() - info.mtimeMs > maxAgeDays * 86_400_000) return undefined;
    const data = await readFile(file);
    return data.length === 0 ? null : data;
  } catch {
    return undefined;
  }
}

function retryable(error: unknown): boolean {
  return !(error instanceof HttpError) || error.status === 429 || error.status >= 500;
}

async function download(url: string, options: FetchOptions): Promise<Buffer | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        body: options.body,
        headers: { 'User-Agent': USER_AGENT, ...options.headers },
        signal: AbortSignal.timeout(180_000),
      });
      if (options.allowMissing && (response.status === 404 || response.status === 204)) return null;
      if (!response.ok) throw new HttpError(`HTTP ${response.status} for ${url}`, response.status);
      const data = Buffer.from(await response.arrayBuffer());
      return data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data) : data;
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !retryable(error)) throw error;
      const delay = 1000 * 2 ** attempt;
      log.warn(`retrying in ${delay / 1000} s: ${error instanceof Error ? error.message : String(error)}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/** HTTP request with an on-disk cache under .cache/http. Resolves to null for allowed missing resources. */
export async function cachedFetch(url: string, options: FetchOptions = {}): Promise<Buffer | null> {
  const file = cachePath(url, options);
  const cached = await readCached(file, cacheOnly ? undefined : options.maxAgeDays);
  if (cached !== undefined) return cached;
  if (cacheOnly) throw new Error(`not in .cache/ (--offline): ${url.slice(0, 200)}`);
  const data = await download(url, options);
  if (data) options.validate?.(data);
  await mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.tmp`;
  await writeFile(partial, data ?? Buffer.alloc(0));
  await rename(partial, file);
  return data;
}

export async function cachedJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const data = await cachedFetch(url, options);
  if (!data) throw new Error(`No data at ${url}`);
  return JSON.parse(data.toString('utf8')) as T;
}

/** Runs fn over items with at most `limit` in flight, preserving result order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
