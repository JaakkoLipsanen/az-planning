import type { ExpressionSpecification, FilterSpecification } from 'maplibre-gl';

import type { TileSourceId } from '#shared/basemaps.ts';

import type { ColorMode, DetailLayer, PoiGroup } from '../state/tripStore.ts';
import { DAY_COLORS, SURFACE_COLORS } from '../theme.ts';

export const LAYERS = {
  reliefColor: 'relief-color',
  reliefShade: 'relief-shade',
  temperature: 'temperature',
  landFill: 'land-fill',
  landLine: 'land-line',
  lakes: 'lakes',
  forests: 'forests',
  forestsLine: 'forests-line',
  wilderness: 'wilderness',
  wildernessLine: 'wilderness-line',
  parks: 'parks',
  parksLine: 'parks-line',
  rivers: 'rivers',
  roadsMinor: 'roads-minor',
  roadsMajor: 'roads-major',
  rail: 'rail',
  border: 'border',
  tribal: 'tribal',
  sources: 'sources',
  alternativesOption: 'alternatives-option',
  alternativesSkipped: 'alternatives-skipped',
  daySelected: 'day-selected',
  routeCasing: 'route-casing',
  route: 'route',
  dayLines: 'day-lines',
  placeAreas: 'place-areas',
  placeHamletsSmall: 'place-hamlets-small',
  placeHamlets: 'place-hamlets',
  placeVillages: 'place-villages',
  placeTowns: 'place-towns',
  placeCities: 'place-cities',
  placeMajor: 'place-major',
  peaksMinor: 'peaks-minor',
  peaksMid: 'peaks-mid',
  peaksMajor: 'peaks-major',
  dayLabels: 'day-labels',
  pois: 'pois',
  nights: 'nights',
  measureLine: 'measure-line',
  measurePoints: 'measure-points',
  measureLabels: 'measure-labels',
} as const;

export const PLACE_LAYERS = [
  LAYERS.placeAreas,
  LAYERS.placeHamletsSmall,
  LAYERS.placeHamlets,
  LAYERS.placeVillages,
  LAYERS.placeTowns,
  LAYERS.placeCities,
  LAYERS.placeMajor,
  LAYERS.peaksMinor,
  LAYERS.peaksMid,
  LAYERS.peaksMajor,
];

/** Vector basemap layers hidden from zoom 11 when raster imagery shows the same things. */
export const OVERLAY_BASE_LAYERS = [
  LAYERS.lakes,
  LAYERS.forests,
  LAYERS.forestsLine,
  LAYERS.rivers,
  LAYERS.roadsMinor,
  LAYERS.roadsMajor,
  LAYERS.rail,
];

export const DETAIL_LAYER_IDS: Record<DetailLayer, string[]> = {
  relief: [LAYERS.reliefColor, LAYERS.reliefShade],
  roadsMajor: [LAYERS.roadsMajor],
  roadsMinor: [LAYERS.roadsMinor],
  rail: [LAYERS.rail],
  water: [LAYERS.rivers, LAYERS.lakes],
  places: PLACE_LAYERS,
  forests: [LAYERS.forests, LAYERS.forestsLine],
  border: [LAYERS.border],
  tribal: [LAYERS.tribal],
  protected: [LAYERS.wilderness, LAYERS.wildernessLine, LAYERS.parks, LAYERS.parksLine],
};

export const POINT_LAYERS = [LAYERS.pois, LAYERS.nights, LAYERS.dayLabels];
export const OTHER_LINE_LAYERS = [LAYERS.sources, LAYERS.alternativesOption, LAYERS.alternativesSkipped];

export const DEM_SOURCE = 'dem';
/** 3D terrain reads its own copy of the DEM source; MapLibre renders sharper relief when they are separate. */
export const TERRAIN_SOURCE = 'terrain';

export function basemapId(source: TileSourceId): string {
  return `basemap-${source}`;
}

export const filters = {
  sections: (hidden: readonly string[]): FilterSpecification => [
    '!',
    ['in', ['get', 'id'], ['literal', hidden]],
  ],
  lines: (visible: readonly string[]): FilterSpecification => ['in', ['get', 'id'], ['literal', visible]],
  alternatives: (visible: readonly string[], style: 'option' | 'skipped'): FilterSpecification => [
    'all',
    ['==', ['get', 'style'], style],
    ['in', ['get', 'id'], ['literal', visible]],
  ],
  pois: (groups: readonly PoiGroup[]): FilterSpecification => ['in', ['get', 'group'], ['literal', groups]],
  land: (categories: readonly string[]): FilterSpecification => [
    'in',
    ['get', 'category'],
    ['literal', categories],
  ],
  selectedDay: (day: number | null): FilterSpecification => ['==', ['get', 'day'], day ?? -1],
};

export function routeColor(mode: ColorMode): ExpressionSpecification {
  if (mode !== 'surface') return ['get', 'color'];
  return [
    'match',
    ['get', 'surface'],
    0,
    SURFACE_COLORS[0],
    1,
    SURFACE_COLORS[1],
    2,
    SURFACE_COLORS[2],
    ['get', 'color'],
  ];
}

export function dayLineColor(): ExpressionSpecification {
  return [
    'match',
    ['%', ['-', ['get', 'day'], 1], DAY_COLORS.length],
    ...DAY_COLORS.flatMap((c, i) => [i, c]),
    '#888888',
  ] as unknown as ExpressionSpecification;
}

export function dayLabelIcon(selected: number | null): ExpressionSpecification {
  return ['case', ['==', ['get', 'day'], selected ?? -1], 'pill-selected', 'pill'];
}
