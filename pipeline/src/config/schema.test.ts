import { describe, expect, it } from 'vitest';

import { tripConfigSchema } from './schema.ts';

const minimal = {
  title: 'Test',
  shortName: 'Test',
  tracks: { a: { file: 'tracks/a.gpx' } },
  kinds: { trail: { label: 'Trail', color: '#aa0000', surface: 'single' } },
  sections: [{ id: 1, name: 'All', kind: 'trail', track: 'a' }],
};

const errors = (config: object): string[] => {
  const result = tripConfigSchema.safeParse(config);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('tripConfigSchema', () => {
  it('fills defaults for a minimal trip', () => {
    const config = tripConfigSchema.parse(minimal);
    expect(config.speed.pavedKmh).toBe(20);
    expect(config.gpx.creator).toBe('trip-planner');
    expect(config.sections[0]).toMatchObject({ id: '1', parts: [{ track: 'a', reverse: false }] });
  });

  it('rejects a default day count outside the range', () => {
    const plan = { days: { min: 5, max: 10, default: 12 }, longDayHours: 7, start: 'A', finish: 'B' };
    expect(errors({ ...minimal, plan })).toEqual(['plan.days: expected min <= default <= max']);
  });

  it('rejects bounds in the wrong order', () => {
    expect(errors({ ...minimal, region: [32, -111, 33, -110] })).toEqual([
      'region: expected [west, south, east, north]',
    ]);
  });

  it('rejects offline packs with zoom levels the source does not serve', () => {
    const pack = { id: 'topo', label: 'Topo', source: 'usgs-topo', radiusKm: { 6: 100 } };
    expect(errors({ ...minimal, offline: { packs: [pack] } })).toEqual([
      'offline.packs.0: radiusKm has zoom levels the tile source does not serve',
    ]);
  });

  it('rejects offline packs of sources that do not allow it', () => {
    const pack = { id: 'otm', label: 'OTM', source: 'opentopomap', radiusKm: { 10: 5 } };
    expect(errors({ ...minimal, offline: { packs: [pack] } })[0]).toMatch(/does not allow offline storage/);
  });
});
