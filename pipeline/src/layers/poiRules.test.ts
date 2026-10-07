import { describe, expect, it } from 'vitest';

import { classifyOsm, waypointClassifier } from './poiRules.ts';

describe('waypointClassifier', () => {
  const classify = waypointClassifier({});

  it.each([
    ['Patagonia Bikes', '', 'bike'],
    ['No bikes beyond this point', 'Wilderness boundary', 'info'],
    ['Horseshoe Campground', '$10 per night', 'camp'],
    ['Blue Barrel', 'Rain collector, water most of the year', 'water'],
    ['Stage Stop Inn', '', 'lodging'],
    ['Time Market', 'Food counter', 'resupply'],
    ['Trail junction', '', 'info'],
  ] as const)('%s -> %s', (name, description, expected) => {
    expect(classify(name, description)).toBe(expected);
  });

  it('matches whole words and plurals only', () => {
    expect(classify('Refuge', 'Grassland and riverbanks')).toBe('info');
    expect(classify('Viewpoint', 'Delicious views')).toBe('info');
    expect(classify('Twin Tanks', '')).toBe('water');
    expect(classify('Café Rio', '')).toBe('resupply');
    expect(classify('Group Camp:', 'Night before the start')).toBe('camp');
  });

  it('applies trip-specific keywords', () => {
    expect(classify('TerraSol', '')).toBe('info');
    expect(waypointClassifier({ camp: ['terrasol'] })('TerraSol', '')).toBe('camp');
  });
});

describe('classifyOsm', () => {
  it('keeps only essentials in dense areas', () => {
    expect(classifyOsm({ amenity: 'restaurant', name: 'Diner' }, false)?.category).toBe('resupply');
    expect(classifyOsm({ amenity: 'restaurant', name: 'Diner' }, true)).toBeNull();
    expect(classifyOsm({ shop: 'supermarket' }, true)).toMatchObject({
      category: 'resupply',
      name: 'Supermarket',
    });
    expect(classifyOsm({ tourism: 'camp_site', fee: 'yes' }, true)).toMatchObject({
      category: 'camp',
      name: 'Campground',
      description: 'fee: yes',
    });
  });

  it('labels water sources by type', () => {
    expect(classifyOsm({ natural: 'spring', name: 'Bog' }, false)?.name).toBe('Bog (spring)');
    expect(classifyOsm({ man_made: 'windpump' }, false)?.name).toBe('Windmill (windpump)');
    expect(classifyOsm({ natural: 'water' }, false)).toBeNull();
  });
});
