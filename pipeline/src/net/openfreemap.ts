import { VectorTile } from '@mapbox/vector-tile';
import type { Feature } from 'geojson';
import { PbfReader } from 'pbf';

import { tileUrl } from '#shared/basemaps.ts';
import type { TileId } from '#shared/tiles.ts';

import { log } from '../log.ts';
import { cachedFetch, cachedJson, mapLimit } from './http.ts';

const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';

let template: Promise<string> | undefined;

/** OpenMapTiles-schema vector tiles from OpenFreeMap; the planet build is pinned for 30 days by the cache. */
function tileTemplate(): Promise<string> {
  template ??= cachedJson<{ tiles?: string[] }>(TILEJSON_URL, { maxAgeDays: 30 }).then((tilejson) => {
    const url = tilejson.tiles?.[0];
    if (!url) throw new Error(`no tile URL in ${TILEJSON_URL}`);
    log.info(`OpenFreeMap tiles: ${url}`);
    return url;
  });
  return template;
}

export type TileFeature = Feature & { layer: string };

export async function loadVectorTiles(
  tiles: readonly TileId[],
  layers: readonly string[],
): Promise<TileFeature[][]> {
  const url = await tileTemplate();
  return mapLimit(tiles, 8, async ({ z, x, y }) => {
    const data = await cachedFetch(tileUrl(url, z, x, y), { allowMissing: true });
    if (!data || data.length === 0) return [];
    const tile = new VectorTile(new PbfReader(data));
    const out: TileFeature[] = [];
    for (const name of layers) {
      const layer = tile.layers[name];
      if (!layer) continue;
      for (let i = 0; i < layer.length; i++)
        out.push({ ...layer.feature(i).toGeoJSON(x, y, z), layer: name });
    }
    return out;
  });
}
