import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { testBundle } from '../testing/testBundle.ts';
import { createTripStore, defaultSettings, sanitizeSettings, settingsOverrides } from './tripStore.ts';

const KEY = 'trip:test:settings';

class MemoryStorage {
  readonly items = new Map<string, string>();
  writes = 0;
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes++;
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.writes++;
    this.items.delete(key);
  }
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  Object.assign(globalThis, { localStorage: storage });
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('defaultSettings', () => {
  it('takes the trip defaults and skips packs that are not selected', () => {
    const defaults = defaultSettings(testBundle());
    expect(defaults.days).toBe(4);
    expect(defaults.basemap).toBe('usgs-topo');
    expect(defaults.offlinePacks).toEqual(['topo']);
    expect(defaults.dayLabels).toBe(true);
  });
});

describe('sanitizeSettings', () => {
  it('keeps valid values and drops what the trip no longer has', () => {
    const stored = {
      days: 40,
      basemap: 'mapbox',
      colorMode: 'day',
      hiddenSections: ['1', 'gone'],
      offlinePacks: ['detail', 'old-pack'],
      details: { relief: false, unknown: true },
      terrain3d: 'yes',
    };
    const out = sanitizeSettings(stored, testBundle());
    expect(out).toMatchObject({
      colorMode: 'day',
      hiddenSections: ['1'],
      offlinePacks: ['detail'],
    });
    expect(out.details?.relief).toBe(false);
    expect(out.details?.water).toBe(true);
    expect(out).not.toHaveProperty('days');
    expect(out).not.toHaveProperty('basemap');
    expect(out).not.toHaveProperty('terrain3d');
  });

  it('drops the day colouring for trips without a plan', () => {
    const { plan: _plan, ...bundle } = testBundle();
    expect(sanitizeSettings({ colorMode: 'day' }, bundle)).toEqual({});
  });

  it('ignores anything that is not an object', () => {
    expect(sanitizeSettings('nonsense', testBundle())).toEqual({});
    expect(sanitizeSettings(['days', 5], testBundle())).toEqual({});
  });

  it('drops values of the wrong type and keys the app no longer has', () => {
    const stored = {
      days: '6',
      poiGroups: 'water',
      details: [true],
      profileCollapsed: 1,
      removedSetting: true,
    };
    expect(sanitizeSettings(stored, testBundle())).toEqual({});
  });
});

describe('settingsOverrides', () => {
  it('lists only the settings that differ from the defaults', () => {
    const defaults = defaultSettings(testBundle());
    expect(settingsOverrides({ ...defaults, days: 5 }, defaults)).toEqual({ days: 5 });
    expect(settingsOverrides(defaults, defaults)).toEqual({});
  });
});

describe('createTripStore', () => {
  it('stores only overrides, and only when a setting changes', () => {
    const store = createTripStore(testBundle());
    store.getState().setHover({ profileIndex: 1, position: [0, 0], extras: [] });
    store.getState().moveCamera({ kind: 'center', center: [0, 0], minZoom: 10 });
    expect(storage.writes).toBe(0);

    store.getState().update({ days: 6 });
    expect(JSON.parse(storage.getItem(KEY) ?? '')).toEqual({ state: { days: 6 }, version: 1 });
    expect(store.getState().customized).toBe(true);

    store.getState().reset();
    expect(storage.getItem(KEY)).toBeNull();
    expect(store.getState().customized).toBe(false);
  });

  it('applies new trip defaults to settings the user never changed', () => {
    storage.setItem(KEY, JSON.stringify({ state: { days: 6 }, version: 1 }));
    const bundle = testBundle();
    if (bundle.plan) bundle.plan.defaultDays = 5;
    bundle.offline?.packs.push({
      id: 'new',
      label: 'New',
      source: 'terrain',
      tiles: [],
      tileCount: 0,
      estimatedBytes: 0,
    });
    const state = createTripStore(bundle).getState();
    expect(state.days).toBe(6);
    expect(state.offlinePacks).toEqual(['topo', 'new']);
  });

  it('ignores settings saved under another storage version', () => {
    storage.setItem(KEY, JSON.stringify({ state: { days: 6 }, version: 0 }));
    expect(createTripStore(testBundle()).getState().days).toBe(4);
    storage.setItem(KEY, JSON.stringify({ state: { days: 6 } }));
    expect(createTripStore(testBundle()).getState().days).toBe(4);
  });

  it('survives unreadable storage', () => {
    storage.setItem(KEY, '{not json');
    expect(createTripStore(testBundle()).getState().days).toBe(4);
  });

  it('reads settings saved by earlier versions of the app', () => {
    const old = { ...defaultSettings(testBundle()), customized: true, basemap: 'terrain' };
    storage.setItem(KEY, JSON.stringify({ state: old, version: 1 }));
    const state = createTripStore(testBundle()).getState();
    expect(state.basemap).toBe('terrain');
    expect(state.customized).toBe(true);
  });
});
