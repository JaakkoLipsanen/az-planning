import { isTileSourceId } from '#shared/basemaps.ts';
import {
  POI_CATEGORIES,
  WATER_KINDS,
  type Poi,
  type PoiCategory,
  type TripBundle,
  type WaterKind,
} from '#shared/bundle.ts';

const isPoiCategory = (value: string): value is PoiCategory =>
  (POI_CATEGORIES as readonly string[]).includes(value);
const isWaterKind = (value: string): value is WaterKind => (WATER_KINDS as readonly string[]).includes(value);

function knownPoi(poi: Poi): Poi {
  const category = isPoiCategory(poi.category) ? poi.category : 'info';
  const water = poi.water && isWaterKind(poi.water) ? poi.water : undefined;
  return category === poi.category && water === poi.water ? poi : { ...poi, category, water };
}

/**
 * Drops what this version of the app cannot show, so an installed app keeps working with bundles built later.
 * Afterwards `imagery` is always set and every tile source, POI category and water kind is known.
 */
export function normalizeBundle(bundle: TripBundle): TripBundle {
  const basemaps = (bundle.imagery?.basemaps ?? []).filter(isTileSourceId);
  const imagery =
    basemaps.length > 0
      ? {
          ...bundle.imagery,
          basemaps,
          default: basemaps.find((id) => id === bundle.imagery?.default) ?? basemaps[0],
        }
      : { basemaps: ['terrain' as const], default: 'terrain' as const };
  return {
    ...bundle,
    imagery,
    offline: bundle.offline && {
      ...bundle.offline,
      packs: bundle.offline.packs.filter((pack) => isTileSourceId(pack.source)),
    },
    pois: bundle.pois && {
      ...bundle.pois,
      items: bundle.pois.items.map(knownPoi),
    },
  };
}
