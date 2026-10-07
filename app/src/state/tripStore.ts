import { createContext, useContext } from 'react';
import { z } from 'zod';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { TileSourceId } from '#shared/basemaps.ts';
import { POI_CATEGORIES, type PoiCategory, type TripBundle } from '#shared/bundle.ts';
import type { Bounds, LngLat } from '#shared/geo.ts';

import { isIsoDate } from '../climate/time.ts';
import { linkedSettings } from './shareLink.ts';

export type ColorMode = 'surface' | 'section' | 'day' | 'grade';
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

/** A night the user fixed at a route km; the plan splits the days around it. */
export interface PinnedNight {
  night: number;
  km: number;
}

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
  pinnedNights: PinnedNight[];
  /** Nights followed by a day off. */
  restDays: number[];
  /** Local time (HH:MM) the riding starts every day; null for sunrise. */
  startTime: string | null;
  /** Breaks as a share of the moving time, %. */
  breakPercent: number;
  /** The water and resupply analysis counts natural sources (creeks, springs, tanks) and OpenStreetMap points. */
  waterNatural: boolean;
  waterOsm: boolean;
  /** The elevation profile shows only the selected day. */
  profileDayZoom: boolean;
  temperatureOverlay: boolean;
  /** Date and hour shown by the temperature overlay; the date defaults to the start date. */
  overlayDate: string | null;
  overlayHour: number;
  overlayOpacity: number;
}

export type HoverExtra =
  | { kind: 'line'; id: string; name: string; km: number; totalKm: number; ele: number | null }
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
  /** When the position was measured (ms). */
  at: number;
  accuracyM: number | null;
  km: number;
  offRouteM: number;
}

/** A popup requested by UI outside the map, such as search results. */
export type FocusTarget = { kind: 'poi'; index: number } | { kind: 'night'; index: number };

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
  focus: (FocusTarget & { id: number }) | null;
  /** Points of the distance measurement, or null when not measuring. */
  measure: LngLat[] | null;
  /** The settings before a shared link replaced them, until the user keeps or undoes the change. */
  linkUndo: Partial<TripSettings> | null;
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
  focusOn: (target: FocusTarget) => void;
  setMeasure: (points: LngLat[] | null) => void;
  pinNight: (night: number, km: number | null) => void;
  toggleRestDay: (night: number) => void;
  /** Restores the settings from before the shared link (true) or keeps the link's (false). */
  closeLink: (undo: boolean) => void;
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
    pinnedNights: [],
    restDays: [],
    startTime: null,
    breakPercent: 25,
    waterNatural: false,
    waterOsm: true,
    profileDayZoom: true,
    temperatureOverlay: false,
    overlayDate: null,
    overlayHour: 6,
    overlayOpacity: 0.6,
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
  const totalKm = bundle.profile.km.at(-1) ?? 0;
  const pinnedNights = z.array(z.object({ night: z.int().min(1), km: z.number().min(0).max(totalKm) }));
  const shape = {
    colorMode: lenient(
      oneOf<ColorMode>(plan ? ['surface', 'section', 'day', 'grade'] : ['surface', 'section', 'grade']),
    ),
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
    pinnedNights: lenient(plan ? pinnedNights : z.never()),
    restDays: lenient(plan ? z.array(z.int().min(1)) : z.never()),
    startTime: lenient(clockTime.nullable()),
    breakPercent: lenient(z.int().min(0).max(200)),
    waterNatural: lenient(z.boolean()),
    waterOsm: lenient(z.boolean()),
    profileDayZoom: lenient(z.boolean()),
    temperatureOverlay: lenient(z.boolean()),
    overlayDate: lenient(isoDate.nullable()),
    overlayHour: lenient(z.int().min(0).max(23)),
    overlayOpacity: lenient(z.number().min(0.1).max(1)),
  } satisfies { [K in keyof TripSettings]: z.ZodType<TripSettings[K] | undefined> };
  return z.object(shape).partial().catch({});
}

/** Keeps the stored values that are valid for this (possibly rebuilt) trip and this version of the app. */
export function sanitizeSettings(stored: unknown, bundle: TripBundle): Partial<TripSettings> {
  const settings = settingsSchema(bundle).parse(stored);
  return Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined));
}

const isoDate = z.custom<string>(isIsoDate);
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

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

/** Pins that the new one would contradict (an earlier night further along, or the reverse) are dropped. */
function withPin(pins: readonly PinnedNight[], night: number, km: number | null): PinnedNight[] {
  const others = pins.filter(
    (p) => p.night !== night && (km === null || (p.night < night ? p.km < km : p.km > km)),
  );
  return km === null ? others : [...others, { night, km }].toSorted((a, b) => a.night - b.night);
}

export function createTripStore(bundle: TripBundle): TripStore {
  const key = `trip:${bundle.slug}:settings`;
  const defaults = defaultSettings(bundle);
  const stored = sanitizeSettings(readStored(key), bundle);
  const linked = linkedSettings();
  const initial = { ...defaults, ...(linked === undefined ? stored : sanitizeSettings(linked, bundle)) };
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
      sidebarOpen: linked !== undefined,
      hover: null,
      gps: null,
      gpsError: null,
      camera: null,
      focus: null,
      measure: null,
      linkUndo: linked === undefined ? null : stored,
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
      focusOn: (target) => set((s) => ({ focus: { ...target, id: (s.focus?.id ?? 0) + 1 } })),
      setMeasure: (measure) => set({ measure }),
      pinNight: (night, km) => applySettings({ pinnedNights: withPin(get().pinnedNights, night, km) }),
      toggleRestDay: (night) => {
        const { restDays } = get();
        applySettings({
          restDays: restDays.includes(night)
            ? restDays.filter((n) => n !== night)
            : [...restDays, night].toSorted((a, b) => a - b),
        });
      },
      closeLink: (undo) => {
        const previous = get().linkUndo;
        set({ linkUndo: null });
        applySettings(undo && previous ? { ...defaults, ...previous } : {});
      },
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
