import type { Map as MapLibreMap } from 'maplibre-gl';
import { createContext, useContext } from 'react';

export const MapContext = createContext<MapLibreMap | null>(null);

/** The map instance; only available to children rendered after the style has loaded. */
export function useMap(): MapLibreMap {
  const map = useContext(MapContext);
  if (!map) throw new Error('useMap outside a loaded MapView');
  return map;
}
