import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const TRIPS_DIR = path.join(REPO_ROOT, 'trips');
export const CACHE_DIR = path.join(REPO_ROOT, '.cache');

export function tripDir(slug: string): string {
  return path.join(TRIPS_DIR, slug);
}

export function tripDistDir(slug: string): string {
  return path.join(tripDir(slug), 'dist');
}
