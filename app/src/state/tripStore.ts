import { createContext, useContext } from 'react';
import { z } from 'zod';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { TileSourceId } from '#shared/basemaps.ts';
import { POI_CATEGORIES, type PoiCategory, type TripBundle } from '#shared/bundle.ts';
import type { Bounds, LngLat } from '#shared/geo.ts';

import { isIsoDate } from '../climate/time.ts';

export type ColorMode = 'surface' | 'section' | 'day';
export type ProfileMode = 'elevation' | 'temperature';
export type PoiGroup = PoiCategory | 'osm' | 'plan';

export const DETAIL_LAYERS = [
  'relief',
  'roadsMajor',
  'roadsMinor',
  'rail',
  'water',
  'places',
  'forests',
  'border',
  'tribal',
  'protected',
] as const;
export type DetailLayer = (typeof DETAIL_LAYERS)[number];

/** Choices that persist per trip; only the ones that differ from the trip's defaults are stored. */
export interface TripSettings {
  colorMode: ColorMode;
  days: number;
  basemap: TileSourceId;
  terrain3d: boolean;
  hiddenSections: string[];
  sources: string[];
  alternatives: string[];
  poiGroups: PoiGroup[];
  land: string[];
  details: Record<DetailLayer, boolean>;
  dayLabels: boolean;
  profileCollapsed: boolean;
  profileMode: ProfileMode;
  offlinePacks: string[];
  /** First day of the trip (YYYY-MM-DD), for dates, sun times and typical weather. */
  startDate: string | null;
  temperatureOverlay: boolean;
  /** Date and hour shown by the temperature overlay; the date defaults to the start date. */
  overlayDate: string | null;
  overlayHour: number;
}

export type HoverExtra =
  | { kind: 'line'; name: string; km: number; totalKm: number; ele: number | null }
  | { kind: 'land'; label: string; color: string }
  | { kind: 'temperature'; celsius: number; ele: number; hour: number };

/** What the pointer is over: a final-route profile sample and/or other lines and land nearby. */
export interface Hover {
  profileIndex: number | null;
  position: LngLat;
  extras: HoverExtra[];
  /** Only the position dot, for when a popup already shows the details. */
  dotOnly?: boolean;
}

export interface GpsPosition {
  lng: number;
  lat: number;
  accuracyM: number | null;
  km: number;
  offRouteM: number;
}

/** A camera move requested by UI outside the map (profile clicks, sidebar zoom buttons). */
export type CameraRequest =
  | { kind: 'center'; center: LngLat; minZoom: number }
  | { kind: 'bounds'; bounds: Bounds; maxZoom?: number; padding?: number; resetView?: boolean };

interface TripUi {
  /** The settings differ from the trip's defaults. */
  customized: boolean;
  selectedDay: number | null;
  sidebarOpen: boolean;
  hover: Hover | null;
  gps: GpsPosition | null;
  gpsError: string | null;
  camera: (CameraRequest & { id: number }) | null;
  /** Points of the distance measurement, or null when not measuring. */
  measure: LngLat[] | null;
}

type ListSetting = 'hiddenSections' | 'sources' | 'alternatives' | 'poiGroups' | 'land' | 'offlinePacks';

interface TripActions {
  update: (patch: Partial<TripSettings>) => void;
  toggleInList: (list: ListSetting, id: string, on: boolean) => void;
  setDetail: (layer: DetailLayer, on: boolean) => void;
  reset: () => void;
  selectDay: (day: number | null) => void;
  setSidebarOpen: (open: boolean) => void;
  setHover: (hover: Hover | null) => void;
  setGps: (gps: GpsPosition | null, gpsError?: string | null) => void;
  moveCamera: (request: CameraRequest) => void;
  setMeasure: (points: LngLat[] | null) => void;
}

export type TripState = TripSettings & TripUi & TripActions;
export type TripStore = StoreApi<TripState>;

/** Bump when a stored setting changes meaning or is renamed; settings saved under another version are dropped. */
const STORAGE_VERSION = 1;
const POI_GROUPS: readonly PoiGroup[] = [...POI_CATEGORIES, 'osm', 'plan'];

export function defaultSettings(bundle: TripBundle): TripSettings {
  return {
    colorMode: 'surface',
    days: bundle.plan?.defaultDays ?? 1,
    basemap: bundle.imagery?.default ?? 'terrain',
    terrain3d: false,
    hiddenSections: [],
    sources: [],
    alternatives: [],
    poiGroups: ['water', 'resupply', 'bike', 'camp', 'lodging', 'plan'],
    land: [],
    details: Object.fromEntries(DETAIL_LAYERS.map((layer) => [layer, true])) as Record<DetailLayer, boolean>,
    dayLabels: Boolean(bundle.plan),
    profileCollapsed: false,
    profileMode: 'elevation',
    offlinePacks: (bundle.offline?.packs ?? []).filter((p) => p.selected !== false).map((p) => p.id),
    startDate: bundle.plan?.startDate ?? null,
    temperatureOverlay: false,
    overlayDate: null,
    overlayHour: 6,
  };
}

/** The settings that differ from the defaults. */
export function settingsOverrides(settings: TripSettings, defaults: TripSettings): Partial<TripSettings> {
  return Object.fromEntries(
    (Object.keys(defaults) as (keyof TripSettings)[])
      .filter((key) => JSON.stringify(settings[key]) !== JSON.stringify(defaults[key]))
      .map((key) => [key, settings[key]]),
  );
}

/** A valid value, or undefined so that the setting falls back to its default without discarding the others. */
const lenient = <T>(schema: z.ZodType<T>): z.ZodType<T | undefined> => schema.optional().catch(undefined);

function oneOf<T extends string>(allowed: readonly T[]): z.ZodType<T> {
  return z.custom<T>((value) => allowed.includes(value as T));
}

/** The stored ids this trip still has; ids of removed sections, packs etc. are dropped. */
function knownIds<T extends string>(allowed: readonly T[]): z.ZodType<T[]> {
  return z.array(z.unknown()).transform((ids) => ids.filter((id): id is T => allowed.includes(id as T)));
}

/** One schema per setting (TypeScript requires each), checked against this trip. */
function settingsSchema(bundle: TripBundle) {
  const { plan } = bundle;
  const defaults = defaultSettings(bundle);
  const details = z
    .object(Object.fromEntries(DETAIL_LAYERS.map((l) => [l, z.boolean().catch(defaults.details[l])])))
    .transform((value) => value as Record<DetailLayer, boolean>);
  const shape = {
    colorMode: lenient(oneOf<ColorMode>(plan ? ['surface', 'section', 'day'] : ['surface', 'section'])),
    days: lenient(plan ? z.int().min(plan.minDays).max(plan.maxDays) : z.never()),
    basemap: lenient(oneOf(bundle.imagery?.basemaps ?? [])),
    terrain3d: lenient(z.boolean()),
    hiddenSections: lenient(knownIds(bundle.sections.map((x) => x.id))),
    sources: lenient(knownIds((bundle.sources ?? []).map((x) => x.id))),
    alternatives: lenient(knownIds((bundle.alternatives ?? []).flatMap((g) => g.items.map((x) => x.id)))),
    poiGroups: lenient(knownIds(POI_GROUPS)),
    land: lenient(knownIds((bundle.land?.categories ?? []).map((x) => x.id))),
    details: lenient(details),
    dayLabels: lenient(z.boolean()),
    profileCollapsed: lenient(z.boolean()),
    profileMode: lenient(oneOf<ProfileMode>(bundle.climate ? ['elevation', 'temperature'] : ['elevation'])),
    offlinePacks: lenient(knownIds((bundle.offline?.packs ?? []).map((x) => x.id))),
    startDate: lenient(isoDate.nullable()),
    temperatureOverlay: lenient(z.boolean()),
    overlayDate: lenient(isoDate.nullable()),
    overlayHour: lenient(z.int().min(0).max(23)),
  } satisfies { [K in keyof TripSettings]: z.ZodType<TripSettings[K] | undefined> };
  return z.object(shape).partial().catch({});
}

/** Keeps the stored values that are valid for this (possibly rebuilt) trip and this version of the app. */
export function sanitizeSettings(stored: unknown, bundle: TripBundle): Partial<TripSettings> {
  const settings = settingsSchema(bundle).parse(stored);
  return Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined));
}

const isoDate = z.custom<string>(isIsoDate);

const savedSettings = z.object({ state: z.unknown(), version: z.literal(STORAGE_VERSION) });

/** Settings saved under another STORAGE_VERSION are ignored. */
function readStored(key: string): unknown {
  try {
    return savedSettings.safeParse(JSON.parse(localStorage.getItem(key) ?? 'null')).data?.state;
  } catch {
    return undefined;
  }
}

function writeStored(key: string, overrides: Partial<TripSettings>): void {
  try {
    if (Object.keys(overrides).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ state: overrides, version: STORAGE_VERSION }));
  } catch {
    // Storage can be full or blocked; the settings then last for this visit only.
  }
}

export function createTripStore(bundle: TripBundle): TripStore {
  const key = `trip:${bundle.slug}:settings`;
  const defaults = defaultSettings(bundle);
  const initial = { ...defaults, ...sanitizeSettings(readStored(key), bundle) };
  return createStore<TripState>()((set, get) => {
    const applySettings = (patch: Partial<TripSettings>): void => {
      const overrides = settingsOverrides({ ...get(), ...patch }, defaults);
      writeStored(key, overrides);
      set({ ...patch, customized: Object.keys(overrides).length > 0 });
    };
    return {
      ...initial,
      customized: Object.keys(settingsOverrides(initial, defaults)).length > 0,
      selectedDay: null,
      sidebarOpen: false,
      hover: null,
      gps: null,
      gpsError: null,
      camera: null,
      measure: null,
      update: applySettings,
      toggleInList: (list, id, on) => {
        const current: readonly string[] = get()[list];
        if (current.includes(id) === on) return;
        applySettings({ [list]: on ? [...current, id] : current.filter((x) => x !== id) });
      },
      setDetail: (layer, on) => applySettings({ details: { ...get().details, [layer]: on } }),
      reset: () => {
        applySettings(defaults);
        set({ selectedDay: null });
      },
      selectDay: (selectedDay) => set({ selectedDay }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setHover: (hover) => set({ hover }),
      setGps: (gps, gpsError = null) => set({ gps, gpsError }),
      moveCamera: (request) => set((s) => ({ camera: { ...request, id: (s.camera?.id ?? 0) + 1 } })),
      setMeasure: (measure) => set({ measure }),
    };
  });
}

export const TripStoreContext = createContext<TripStore | null>(null);

export function useTripState<T>(selector: (state: TripState) => T): T {
  const store = useContext(TripStoreContext);
  if (!store) throw new Error('useTripState outside a trip');
  return useStore(store, selector);
}

export function useTripStore(): TripStore {
  const store = useContext(TripStoreContext);
  if (!store) throw new Error('useTripStore outside a trip');
  return store;
}
