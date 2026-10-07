import { isTileSourceId } from '#shared/basemaps.ts';
import { POI_CATEGORIES, type PoiCategory, type TripBundle } from '#shared/bundle.ts';

const isPoiCategory = (value: string): value is PoiCategory =>
  (POI_CATEGORIES as readonly string[]).includes(value);

/**
 * Drops what this version of the app cannot show, so an installed app keeps working with bundles built later.
 * Afterwards `imagery` is always set and every tile source and POI category is known.
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
      items: bundle.pois.items.map((poi) =>
        isPoiCategory(poi.category) ? poi : { ...poi, category: 'info' },
      ),
    },
  };
}
