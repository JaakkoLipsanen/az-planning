import { describe, expect, it } from 'vitest';

import type { TileSourceId } from '#shared/basemaps.ts';
import type { PoiCategory, TripBundle, WaterKind } from '#shared/bundle.ts';

import { testBundle } from '../testing/testBundle.ts';
import { normalizeBundle } from './normalize.ts';

/** Values a newer pipeline might write that this app does not know. */
const FUTURE_SOURCE = 'future' as TileSourceId;
const FUTURE_CATEGORY = 'ferry' as PoiCategory;
const FUTURE_WATER = 'well' as WaterKind;

describe('normalizeBundle', () => {
  it('drops tile sources this version of the app does not know', () => {
    const bundle = testBundle();
    bundle.imagery = {
      basemaps: [FUTURE_SOURCE, 'usgs-topo'],
      default: FUTURE_SOURCE,
    };
    bundle.offline?.packs.push({
      ...bundle.offline.packs[0],
      id: 'f',
      source: FUTURE_SOURCE,
    });
    const out = normalizeBundle(bundle);
    expect(out.imagery).toMatchObject({ basemaps: ['usgs-topo'], default: 'usgs-topo' });
    expect(out.offline?.packs.map((p) => p.id)).toEqual(['topo', 'detail']);
  });

  it('falls back to terrain when a trip lists no usable basemap', () => {
    const { imagery: _imagery, ...bundle }: TripBundle = testBundle();
    expect(normalizeBundle(bundle).imagery).toEqual({ basemaps: ['terrain'], default: 'terrain' });
  });

  it('shows unknown point categories as notes', () => {
    const bundle = testBundle([
      { name: 'Ferry', category: FUTURE_CATEGORY, lat: 30, lng: -110, source: 'x' },
    ]);
    expect(normalizeBundle(bundle).pois?.items[0].category).toBe('info');
  });

  it('forgets unknown kinds of water', () => {
    const bundle = testBundle([
      { name: 'Well', category: 'water', water: FUTURE_WATER, lat: 30, lng: -110, source: 'x' },
      { name: 'Tap', category: 'water', water: 'tap', lat: 30, lng: -110, source: 'x' },
    ]);
    expect(normalizeBundle(bundle).pois?.items.map((p) => p.water)).toEqual([undefined, 'tap']);
  });
});
