import type { GeoJSONSource, Map as MapLibreMap, RasterTileSource } from 'maplibre-gl';
import { useEffect, useRef } from 'react';

import { TILE_SOURCES } from '#shared/basemaps.ts';

import { isNarrow } from '../lib/device.ts';
import { mapboxTemplate } from '../offline/tileProtocol.ts';
import { usePreferences } from '../state/preferences.ts';
import { DETAIL_LAYERS, useTripState } from '../state/tripStore.ts';
import { usePlan, useTripModel } from '../trip/TripContext.tsx';
import { dayFeatures } from './dayFeatures.ts';
import {
  basemapId,
  DETAIL_LAYER_IDS,
  dayLabelIcon,
  filters,
  LAYERS,
  OVERLAY_BASE_LAYERS,
  PLACE_LAYERS,
  routeColor,
  TERRAIN_SOURCE,
} from './layers.ts';
import { useMap } from './MapContext.ts';

const TERRAIN_EXAGGERATION = 1.35;
/** Zoom from which raster basemaps replace the vector overlay's roads, water and (on map styles) labels. */
const OVERLAY_HANDOVER_ZOOM = 11;

function setVisible(map: MapLibreMap, ids: readonly string[], on: boolean): void {
  for (const id of ids)
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
}

function useFilters(map: MapLibreMap): void {
  const hiddenSections = useTripState((s) => s.hiddenSections);
  const sources = useTripState((s) => s.sources);
  const alternatives = useTripState((s) => s.alternatives);
  const poiGroups = useTripState((s) => s.poiGroups);
  const land = useTripState((s) => s.land);

  useEffect(() => {
    map.setFilter(LAYERS.route, filters.sections(hiddenSections));
    map.setFilter(LAYERS.routeCasing, filters.sections(hiddenSections));
  }, [map, hiddenSections]);
  useEffect(() => {
    map.setFilter(LAYERS.sources, filters.lines(sources));
  }, [map, sources]);
  useEffect(() => {
    map.setFilter(LAYERS.alternativesOption, filters.alternatives(alternatives, 'option'));
    map.setFilter(LAYERS.alternativesSkipped, filters.alternatives(alternatives, 'skipped'));
  }, [map, alternatives]);
  useEffect(() => {
    map.setFilter(LAYERS.pois, filters.pois(poiGroups));
    setVisible(map, [LAYERS.nights], poiGroups.includes('plan'));
  }, [map, poiGroups]);
  useEffect(() => {
    map.setFilter(LAYERS.landFill, filters.land(land));
    map.setFilter(LAYERS.landLine, filters.land(land));
  }, [map, land]);
}

function useBasemap(map: MapLibreMap): void {
  const model = useTripModel();
  const basemap = useTripState((s) => s.basemap);
  const mapboxToken = usePreferences((s) => s.mapboxToken);
  const mapboxStyle = usePreferences((s) => s.mapboxStyle);

  useEffect(() => {
    for (const id of model.bundle.imagery?.basemaps ?? []) setVisible(map, [basemapId(id)], id === basemap);
    const source = TILE_SOURCES[basemap];
    const raster = source.kind === 'raster';
    const handover = raster ? OVERLAY_HANDOVER_ZOOM : 24;
    for (const id of OVERLAY_BASE_LAYERS) map.setLayerZoomRange(id, map.getLayer(id)?.minzoom ?? 0, handover);
    for (const id of [LAYERS.wilderness, LAYERS.parks]) map.setLayerZoomRange(id, 0, handover);
    for (const id of PLACE_LAYERS)
      map.setLayerZoomRange(id, map.getLayer(id)?.minzoom ?? 0, source.hasLabels ? handover : 24);
    const imagery = raster && !source.hasLabels;
    for (const id of [LAYERS.border, LAYERS.tribal, LAYERS.wildernessLine, LAYERS.parksLine]) {
      map.setPaintProperty(id, 'line-opacity', imagery ? 0.75 : 0.9);
    }
  }, [map, model, basemap]);

  useEffect(() => {
    const source = map.getSource<RasterTileSource>(basemapId('mapbox'));
    source?.setTiles([mapboxTemplate(mapboxStyle, mapboxToken)]);
  }, [map, mapboxToken, mapboxStyle]);
}

function useTerrain(map: MapLibreMap): void {
  const terrain3d = useTripState((s) => s.terrain3d);
  const first = useRef(true);
  useEffect(() => {
    map.setTerrain(terrain3d ? { source: TERRAIN_SOURCE, exaggeration: TERRAIN_EXAGGERATION } : null);
    if (first.current) {
      first.current = false;
      return;
    }
    if (terrain3d && map.getPitch() < 20) map.easeTo({ pitch: 55, duration: 800 });
    if (!terrain3d && map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 600 });
  }, [map, terrain3d]);
}

function useDayPlan(map: MapLibreMap): void {
  const model = useTripModel();
  const plan = usePlan();
  const selectedDay = useTripState((s) => s.selectedDay);
  const dayLabels = useTripState((s) => s.dayLabels);
  const colorMode = useTripState((s) => s.colorMode);

  useEffect(() => {
    const features = dayFeatures(plan, model.bundle.plan?.longDayHours ?? Infinity);
    void map.getSource<GeoJSONSource>('days')?.setData(features.lines);
    void map.getSource<GeoJSONSource>('day-labels')?.setData(features.labels);
    void map.getSource<GeoJSONSource>('nights')?.setData(features.nights);
  }, [map, model, plan]);
  useEffect(() => {
    map.setFilter(LAYERS.daySelected, filters.selectedDay(selectedDay));
    map.setLayoutProperty(LAYERS.dayLabels, 'icon-image', dayLabelIcon(selectedDay));
  }, [map, selectedDay]);
  const showLabels = dayLabels && Boolean(model.bundle.plan);
  useEffect(() => setVisible(map, [LAYERS.dayLabels], showLabels), [map, showLabels]);
  useEffect(() => {
    map.setPaintProperty(LAYERS.route, 'line-color', routeColor(colorMode));
    setVisible(map, [LAYERS.dayLines], colorMode === 'day');
  }, [map, colorMode]);
}

function useCamera(map: MapLibreMap): void {
  const camera = useTripState((s) => s.camera);
  useEffect(() => {
    if (!camera) return;
    if (camera.kind === 'center') {
      map.easeTo({ center: camera.center, zoom: Math.max(map.getZoom(), camera.minZoom), duration: 600 });
      return;
    }
    const [w, s, e, n] = camera.bounds;
    const padding = camera.padding ?? (isNarrow() ? 40 : 60);
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      {
        padding,
        duration: 700,
        ...(camera.maxZoom === undefined ? {} : { maxZoom: camera.maxZoom }),
        ...(camera.resetView ? { pitch: 0, bearing: 0 } : {}),
      },
    );
  }, [map, camera]);
}

function useDetails(map: MapLibreMap): void {
  const details = useTripState((s) => s.details);
  useEffect(() => {
    for (const layer of DETAIL_LAYERS) setVisible(map, DETAIL_LAYER_IDS[layer], details[layer]);
  }, [map, details]);
}

export function useMapSync(): void {
  const map = useMap();
  useFilters(map);
  useBasemap(map);
  useTerrain(map);
  useDayPlan(map);
  useDetails(map);
  useCamera(map);
}
