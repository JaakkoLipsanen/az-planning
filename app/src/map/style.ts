import type { FeatureCollection } from 'geojson';
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from 'maplibre-gl';

import { TILE_SOURCES } from '#shared/basemaps.ts';

import { climateBounds, overlayDate } from '../climate/overlay.ts';
import { temperatureTemplate } from '../climate/temperatureTiles.ts';
import { protocolTemplate } from '../offline/tileProtocol.ts';
import type { TripSettings } from '../state/tripStore.ts';
import { DAY_HIGHLIGHT } from '../theme.ts';
import type { TripModel } from '../trip/model.ts';
import type { DayFeatures } from './dayFeatures.ts';
import {
  basemapId,
  dayLabelIcon,
  dayLineColor,
  DEM_SOURCE,
  filters,
  LAYERS,
  routeColor,
  TERRAIN_SOURCE,
} from './layers.ts';

const FONT_REGULAR = ['noto-regular'];
const FONT_BOLD = ['noto-bold'];
const FONT_ITALIC = ['noto-italic'];
const LABEL_HALO = { 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 };
const MEASURE_COLOR = '#1b4f9c';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

const ELEVATION_TINT: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['elevation'],
  -1,
  '#cfe3ee',
  0,
  '#f0e2be',
  300,
  '#f0e2be',
  600,
  '#e8dbb2',
  900,
  '#dcd3a4',
  1200,
  '#cac896',
  1500,
  '#b8bd8d',
  1800,
  '#a7b28c',
  2200,
  '#a6b39b',
  2800,
  '#a0a69e',
  3800,
  '#ececec',
];

const visible = (on: boolean): 'visible' | 'none' => (on ? 'visible' : 'none');

const zoomInterpolate = (stops: number[]): ExpressionSpecification =>
  ['interpolate', ['linear'], ['zoom'], ...stops] as unknown as ExpressionSpecification;

function landColor(model: TripModel): ExpressionSpecification {
  const categories = model.bundle.land?.categories ?? [];
  if (categories.length === 0) return ['literal', '#cccccc'] as unknown as ExpressionSpecification;
  return [
    'match',
    ['get', 'category'],
    ...categories.flatMap((c) => [c.id, c.color]),
    '#cccccc',
  ] as unknown as ExpressionSpecification;
}

function placeLayer(
  id: string,
  filter: FilterSpecification,
  minzoom: number,
  font: string[],
  size: number,
  color = '#3b3129',
): LayerSpecification {
  return {
    id,
    type: 'symbol',
    source: 'places',
    minzoom,
    filter,
    layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': size, 'text-max-width': 8 },
    paint: { 'text-color': color, ...LABEL_HALO },
  };
}

function peakLayer(
  id: string,
  filter: FilterSpecification,
  minzoom: number,
  size: number,
): LayerSpecification {
  return {
    id,
    type: 'symbol',
    source: 'peaks',
    minzoom,
    filter,
    layout: {
      'icon-image': 'peak',
      'text-field': [
        'format',
        ['get', 'name'],
        {},
        '\n',
        {},
        ['concat', ['to-string', ['get', 'ele']], ' m'],
        { 'font-scale': 0.85 },
      ],
      'text-font': FONT_REGULAR,
      'text-size': size,
      'text-max-width': 9,
      'text-anchor': 'top',
      'text-offset': [0, 0.5],
    },
    paint: { 'text-color': '#5a4634', ...LABEL_HALO },
  };
}

function sources(
  model: TripModel,
  settings: TripSettings,
  days: DayFeatures,
): Record<string, SourceSpecification> {
  const dem: SourceSpecification = {
    type: 'raster-dem',
    tiles: [protocolTemplate('terrain')],
    tileSize: 256,
    encoding: 'terrarium',
    maxzoom: TILE_SOURCES.terrain.maxzoom,
    attribution: TILE_SOURCES.terrain.attribution,
  };
  const out: Record<string, SourceSpecification> = { [DEM_SOURCE]: dem, [TERRAIN_SOURCE]: { ...dem } };
  for (const id of model.bundle.imagery?.basemaps ?? []) {
    const source = TILE_SOURCES[id];
    if (source.kind !== 'raster') continue;
    out[basemapId(id)] = {
      type: 'raster',
      tiles: [protocolTemplate(id)],
      tileSize: source.tileSize,
      minzoom: source.minzoom,
      maxzoom: source.maxzoom,
      attribution: source.attribution,
    };
  }
  if (model.climate) {
    out[LAYERS.temperature] = {
      type: 'raster',
      tiles: [temperatureTemplate(overlayDate(settings), settings.overlayHour)],
      tileSize: 256,
      maxzoom: TILE_SOURCES.terrain.maxzoom,
      bounds: climateBounds(model.climate.layer),
    };
  }
  const g = model.geojson;
  const geojson = {
    'base-lines': g.basemapLines,
    'base-areas': g.basemapAreas,
    boundaries: g.boundaries,
    places: g.places,
    peaks: g.peaks,
    land: g.land,
    sections: g.sections,
    sources: g.sources,
    alternatives: g.alternatives,
    pois: g.pois,
    days: days.lines,
    'day-labels': days.labels,
    nights: days.nights,
    [LAYERS.measureLine]: EMPTY,
    [LAYERS.measurePoints]: EMPTY,
  };
  for (const [id, data] of Object.entries(geojson)) out[id] = { type: 'geojson', data };
  return out;
}

function basemapLayers(model: TripModel, settings: TripSettings): LayerSpecification[] {
  return (model.bundle.imagery?.basemaps ?? [])
    .filter((id) => TILE_SOURCES[id].kind === 'raster')
    .map((id) => ({
      id: basemapId(id),
      type: 'raster',
      source: basemapId(id),
      layout: { visibility: settings.basemap === id ? 'visible' : 'none' },
      paint: { 'raster-fade-duration': 150 },
    }));
}

/** The whole map style; later setting changes are applied by useMapSync. */
export function buildStyle(
  model: TripModel,
  settings: TripSettings,
  days: DayFeatures,
  selectedDay: number | null,
): StyleSpecification {
  const routeWidth = zoomInterpolate([7, 2.2, 12, 3.5, 16, 5]);
  const layers: LayerSpecification[] = [
    { id: 'background', type: 'background', paint: { 'background-color': '#e6dcc3' } },
    {
      id: LAYERS.reliefColor,
      type: 'color-relief',
      source: DEM_SOURCE,
      paint: { 'color-relief-color': ELEVATION_TINT },
    },
    {
      id: LAYERS.reliefShade,
      type: 'hillshade',
      source: DEM_SOURCE,
      paint: {
        'hillshade-method': 'multidirectional',
        'hillshade-illumination-direction': [315, 45],
        'hillshade-illumination-altitude': [40, 55],
        'hillshade-shadow-color': ['rgba(52, 40, 28, 0.6)', 'rgba(52, 40, 28, 0.35)'],
        'hillshade-highlight-color': ['rgba(255, 255, 255, 0.35)', 'rgba(255, 255, 255, 0.2)'],
        'hillshade-exaggeration': 0.55,
      },
    },
    ...basemapLayers(model, settings),
    ...(model.climate
      ? [
          {
            id: LAYERS.temperature,
            type: 'raster',
            source: LAYERS.temperature,
            layout: { visibility: visible(settings.temperatureOverlay) },
            paint: { 'raster-opacity': 0.6, 'raster-fade-duration': 0 },
          } satisfies LayerSpecification,
        ]
      : []),
    {
      id: LAYERS.landFill,
      type: 'fill',
      source: 'land',
      filter: filters.land(settings.land),
      paint: { 'fill-color': landColor(model), 'fill-opacity': zoomInterpolate([8, 0.4, 13, 0.28]) },
    },
    {
      id: LAYERS.landLine,
      type: 'line',
      source: 'land',
      minzoom: 10,
      filter: filters.land(settings.land),
      paint: {
        'line-color': landColor(model),
        'line-width': zoomInterpolate([10, 0.6, 14, 1.4]),
        'line-opacity': 0.9,
      },
    },
    {
      id: LAYERS.lakes,
      type: 'fill',
      source: 'base-areas',
      filter: ['==', ['get', 'kind'], 'lake'],
      paint: { 'fill-color': '#8fc0dc', 'fill-opacity': 0.8, 'fill-outline-color': '#4f8fb3' },
    },
    {
      id: LAYERS.forests,
      type: 'fill',
      source: 'base-areas',
      filter: ['==', ['get', 'kind'], 'forest'],
      paint: { 'fill-color': '#5d8a4a', 'fill-opacity': 0.07 },
    },
    {
      id: LAYERS.forestsLine,
      type: 'line',
      source: 'base-areas',
      filter: ['==', ['get', 'kind'], 'forest'],
      paint: { 'line-color': '#5d8a4a', 'line-width': 0.8, 'line-opacity': 0.5, 'line-dasharray': [3, 4] },
    },
    {
      id: LAYERS.wilderness,
      type: 'fill',
      source: 'base-areas',
      filter: ['==', ['get', 'kind'], 'wilderness'],
      paint: { 'fill-color': '#2f7a3a', 'fill-opacity': 0.1 },
    },
    {
      id: LAYERS.wildernessLine,
      type: 'line',
      source: 'base-areas',
      filter: ['==', ['get', 'kind'], 'wilderness'],
      paint: {
        'line-color': '#2f7a3a',
        'line-width': 1.4,
        'line-opacity': 0.9,
        'line-dasharray': [1.5, 3.5],
      },
    },
    {
      id: LAYERS.parks,
      type: 'fill',
      source: 'base-areas',
      filter: ['==', ['get', 'kind'], 'park'],
      paint: { 'fill-color': '#1f6a2a', 'fill-opacity': 0.08 },
    },
    {
      id: LAYERS.parksLine,
      type: 'line',
      source: 'base-areas',
      filter: ['==', ['get', 'kind'], 'park'],
      paint: { 'line-color': '#1f6a2a', 'line-width': 1.6, 'line-opacity': 0.9, 'line-dasharray': [4, 2] },
    },
    {
      id: LAYERS.rivers,
      type: 'line',
      source: 'base-lines',
      filter: ['==', ['get', 'kind'], 'river'],
      paint: {
        'line-color': '#4f8fb3',
        'line-width': zoomInterpolate([7, 0.8, 12, 1.6]),
        'line-opacity': 0.8,
      },
    },
    {
      id: LAYERS.roadsMinor,
      type: 'line',
      source: 'base-lines',
      minzoom: 9,
      filter: ['==', ['get', 'kind'], 'minor'],
      paint: {
        'line-color': '#9c8468',
        'line-width': zoomInterpolate([9, 0.8, 13, 1.6]),
        'line-opacity': 0.75,
      },
    },
    {
      id: LAYERS.roadsMajor,
      type: 'line',
      source: 'base-lines',
      filter: ['==', ['get', 'kind'], 'major'],
      paint: {
        'line-color': '#8a6a4a',
        'line-width': zoomInterpolate([7, 1.2, 12, 2.4]),
        'line-opacity': 0.8,
      },
    },
    {
      id: LAYERS.rail,
      type: 'line',
      source: 'base-lines',
      filter: ['==', ['get', 'kind'], 'rail'],
      paint: { 'line-color': '#6d6460', 'line-width': 1, 'line-opacity': 0.7, 'line-dasharray': [5, 4] },
    },
    {
      id: LAYERS.border,
      type: 'line',
      source: 'boundaries',
      filter: ['==', ['get', 'kind'], 'border'],
      paint: { 'line-color': '#b02020', 'line-width': 2.5, 'line-dasharray': [3, 1.5] },
    },
    {
      id: LAYERS.tribal,
      type: 'line',
      source: 'boundaries',
      filter: ['==', ['get', 'kind'], 'tribal'],
      paint: { 'line-color': '#8a3fa0', 'line-width': 1.4, 'line-dasharray': [1.5, 3.5] },
    },
    {
      id: LAYERS.sources,
      type: 'line',
      source: 'sources',
      filter: filters.lines(settings.sources),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': zoomInterpolate([7, 1.6, 13, 3]),
        'line-opacity': 0.6,
      },
    },
    {
      id: LAYERS.alternativesOption,
      type: 'line',
      source: 'alternatives',
      filter: filters.alternatives(settings.alternatives, 'option'),
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': zoomInterpolate([7, 2, 13, 3.5]),
        'line-dasharray': [2, 2],
        'line-opacity': 0.9,
      },
    },
    {
      id: LAYERS.alternativesSkipped,
      type: 'line',
      source: 'alternatives',
      filter: filters.alternatives(settings.alternatives, 'skipped'),
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': zoomInterpolate([7, 2, 13, 3.5]),
        'line-dasharray': [0.7, 2.2],
        'line-opacity': 0.9,
      },
    },
    {
      id: LAYERS.daySelected,
      type: 'line',
      source: 'days',
      filter: filters.selectedDay(selectedDay),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': DAY_HIGHLIGHT,
        'line-width': zoomInterpolate([7, 11, 12, 18, 16, 24]),
        'line-opacity': 0.7,
        'line-blur': 1.5,
      },
    },
    {
      id: LAYERS.routeCasing,
      type: 'line',
      source: 'sections',
      filter: filters.sections(settings.hiddenSections),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': zoomInterpolate([7, 4.5, 12, 7, 16, 9]),
        'line-opacity': 0.85,
      },
    },
    {
      id: LAYERS.route,
      type: 'line',
      source: 'sections',
      filter: filters.sections(settings.hiddenSections),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': routeColor(settings.colorMode), 'line-width': routeWidth, 'line-opacity': 0.95 },
    },
    {
      id: LAYERS.dayLines,
      type: 'line',
      source: 'days',
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        visibility: visible(settings.colorMode === 'day'),
      },
      paint: {
        'line-color': dayLineColor(),
        'line-width': zoomInterpolate([7, 2.6, 12, 3.8, 16, 5.2]),
        'line-opacity': 0.95,
      },
    },
    placeLayer(LAYERS.placeAreas, ['==', ['get', 'kind'], 'area'], 9, FONT_ITALIC, 11, '#4a5f3f'),
    placeLayer(
      LAYERS.placeHamletsSmall,
      ['all', ['==', ['get', 'kind'], 'hamlet'], ['>=', ['get', 'rank'], 13]],
      12,
      FONT_REGULAR,
      11,
    ),
    placeLayer(
      LAYERS.placeHamlets,
      ['all', ['==', ['get', 'kind'], 'hamlet'], ['<', ['get', 'rank'], 13]],
      11,
      FONT_REGULAR,
      11.5,
    ),
    placeLayer(LAYERS.placeVillages, ['==', ['get', 'kind'], 'village'], 10, FONT_REGULAR, 12.5),
    placeLayer(LAYERS.placeTowns, ['==', ['get', 'kind'], 'town'], 9, FONT_BOLD, 13),
    placeLayer(
      LAYERS.placeCities,
      ['all', ['==', ['get', 'kind'], 'city'], ['!', ['get', 'major']]],
      8,
      FONT_BOLD,
      14.5,
    ),
    placeLayer(
      LAYERS.placeMajor,
      ['all', ['==', ['get', 'kind'], 'city'], ['get', 'major']],
      0,
      FONT_BOLD,
      16,
    ),
    peakLayer(LAYERS.peaksMinor, ['>=', ['get', 'rank'], 3], 13, 11),
    peakLayer(LAYERS.peaksMid, ['==', ['get', 'rank'], 2], 12, 11),
    peakLayer(LAYERS.peaksMajor, ['<=', ['get', 'rank'], 1], 11, 11.5),
    {
      id: LAYERS.dayLabels,
      type: 'symbol',
      source: 'day-labels',
      minzoom: 7.6,
      layout: {
        visibility: visible(settings.dayLabels && Boolean(model.bundle.plan)),
        'icon-image': dayLabelIcon(selectedDay),
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [3, 7, 3, 7],
        'text-field': [
          'format',
          ['get', 'title'],
          { 'text-font': ['literal', FONT_BOLD], 'font-scale': 1.1 },
          ['get', 'stats'],
          {},
          ['get', 'time'],
          {
            'text-color': ['case', ['get', 'long'], '#c0392b', '#2b2420'],
            'text-font': ['case', ['get', 'long'], ['literal', FONT_BOLD], ['literal', FONT_REGULAR]],
          },
          '\n',
          {},
          ['get', 'trail'],
          { 'text-color': '#c4262e' },
          '   ',
          {},
          ['get', 'dirt'],
          { 'text-color': '#8d5a24' },
          '   ',
          {},
          ['get', 'paved'],
          { 'text-color': '#3a3a3a' },
        ],
        'text-font': FONT_REGULAR,
        'text-size': 11,
        'text-line-height': 1.3,
        'text-justify': 'auto',
        'text-variable-anchor': ['left', 'right', 'bottom-left', 'top-left', 'bottom-right', 'top-right'],
        'text-radial-offset': 1.2,
        'text-max-width': 40,
        'text-padding': 6,
        'symbol-sort-key': ['get', 'day'],
      },
      paint: { 'text-color': '#2b2420' },
    },
    {
      id: LAYERS.pois,
      type: 'symbol',
      source: 'pois',
      minzoom: 9,
      filter: filters.pois(settings.poiGroups),
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': zoomInterpolate([9, 0.9, 13, 1.1]),
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
    {
      id: LAYERS.nights,
      type: 'symbol',
      source: 'nights',
      layout: {
        visibility: visible(settings.poiGroups.includes('plan')),
        'icon-image': 'night',
        'icon-allow-overlap': true,
        'text-field': ['get', 'label'],
        'text-font': FONT_BOLD,
        'text-size': 12.5,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#ffffff' },
    },
    {
      id: LAYERS.measureLine,
      type: 'line',
      source: LAYERS.measureLine,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': MEASURE_COLOR, 'line-width': 2.5, 'line-dasharray': [2, 1.5] },
    },
    {
      id: LAYERS.measurePoints,
      type: 'circle',
      source: LAYERS.measurePoints,
      filter: ['==', ['get', 'kind'], 'point'],
      paint: {
        'circle-radius': 8,
        'circle-color': MEASURE_COLOR,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    },
    {
      id: LAYERS.measureLabels,
      type: 'symbol',
      source: LAYERS.measurePoints,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': FONT_BOLD,
        'text-size': ['match', ['get', 'kind'], 'point', 11, 12.5],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': ['match', ['get', 'kind'], 'point', '#ffffff', MEASURE_COLOR],
        'text-halo-color': ['match', ['get', 'kind'], 'point', 'rgba(0,0,0,0)', '#ffffff'],
        'text-halo-width': 2,
      },
    },
  ];
  return {
    version: 8,
    glyphs: `${location.origin}/fonts/{fontstack}/{range}.pbf`,
    sources: sources(model, settings, days),
    layers,
  };
}
