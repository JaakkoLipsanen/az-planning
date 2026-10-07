import { useStore } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';

export const MAPBOX_STYLES = [
  ['outdoors-v12', 'Mapbox Outdoors'],
  ['satellite-streets-v12', 'Mapbox Satellite Streets'],
  ['satellite-v9', 'Mapbox Satellite'],
  ['streets-v12', 'Mapbox Streets'],
] as const;

interface Preferences {
  mapboxToken: string;
  mapboxStyle: string;
  setMapbox: (token: string, style: string) => void;
}

/** Settings shared by all trips, kept in this browser only. */
export const preferencesStore = createStore<Preferences>()(
  persist(
    (set) => ({
      mapboxToken: '',
      mapboxStyle: 'outdoors-v12',
      setMapbox: (mapboxToken, mapboxStyle) => set({ mapboxToken, mapboxStyle }),
    }),
    { name: 'preferences', version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);

export function usePreferences<T>(selector: (state: Preferences) => T): T {
  return useStore(preferencesStore, selector);
}
