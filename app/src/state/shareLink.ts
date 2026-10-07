import type { TripSettings } from './tripStore.ts';

const PREFIX = '#plan=';

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** A link to this trip that opens with these settings (only those that differ from the defaults). */
export function planLink(overrides: Partial<TripSettings>): string {
  return `${location.origin}${location.pathname}${PREFIX}${toBase64Url(JSON.stringify(overrides))}`;
}

/** The settings in the address, or undefined when it has none (or they cannot be read). */
export function linkedSettings(): unknown {
  if (typeof location === 'undefined' || !location.hash.startsWith(PREFIX)) return undefined;
  try {
    return JSON.parse(fromBase64Url(location.hash.slice(PREFIX.length))) as unknown;
  } catch {
    return undefined;
  }
}

/** Removes the settings from the address, so a reload shows the saved settings again. */
export function clearLinkedSettings(): void {
  if (location.hash.startsWith(PREFIX)) history.replaceState(null, '', location.pathname + location.search);
}
