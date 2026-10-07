import type { TileSourceId } from './basemaps.ts';
import type { Bounds } from './geo.ts';
import type { TileRun } from './tiles.ts';

/** Bump on breaking changes to TripBundle; the app refuses bundles it does not know. */
export const BUNDLE_SCHEMA_VERSION = 1;

export const SURFACES = ['single', 'unpaved', 'paved'] as const;
export type Surface = (typeof SURFACES)[number];
/** Index into SURFACES. */
export type SurfaceIndex = 0 | 1 | 2;

export const POI_CATEGORIES = ['water', 'resupply', 'bike', 'camp', 'lodging', 'info'] as const;
export type PoiCategory = (typeof POI_CATEGORIES)[number];

/** Piped water, a rain collector or cistern, or a natural source (creek, spring, tank) that may be dry. */
export const WATER_KINDS = ['tap', 'collector', 'natural'] as const;
export type WaterKind = (typeof WATER_KINDS)[number];

/** Everything the app knows about a trip, written by the pipeline to trips/<slug>/dist/trip.json. */
export interface TripBundle {
  schemaVersion: number;
  slug: string;
  /** Content hash; changes whenever anything in the bundle changes. */
  version: string;
  title: string;
  shortName: string;
  subtitle?: string;
  description?: string;
  attribution?: string;
  /** IANA time zone of the trip area (e.g. America/Phoenix), for dates and sun times. */
  timezone?: string;
  /** Bounds of the final route. */
  bounds: Bounds;
  /** The area covered by the basemap overlay and the land data. */
  region: Bounds;
  stats: TripStats;
  kinds: Record<string, SectionKind>;
  sections: Section[];
  profile: Profile;
  surfaceTotalsKm?: Record<Surface, number>;
  sources?: TrackLine[];
  alternatives?: AlternativeGroup[];
  pois?: PoiLayer;
  plan?: PlanSettings;
  land?: LandLayer;
  basemap?: BasemapOverlay;
  imagery?: ImagerySettings;
  offline?: OfflineSettings;
  climate?: ClimateLayer;
  /** Notes that apply to parts of the route on some dates, such as seasonal closures. */
  notices?: Notice[];
  /** Things to arrange before the trip: permits, fees, road status. */
  checklist?: ChecklistItem[];
  files?: TripFiles;
}

export interface TripStats {
  distanceKm: number;
  climbM: number;
  movingHours: number;
}

export interface SectionKind {
  label: string;
  color: string;
}

/** A piece of the final route, drawn as one line per surface run. */
export interface Section {
  id: string;
  name: string;
  kind: string;
  km: number;
  climbM: number;
  movingHours: number;
  parts: SectionPart[];
}

export interface SectionPart {
  surface: SurfaceIndex;
  /** Encoded polyline. */
  line: string;
}

/** Final-route samples about every 100 m, stored column-wise. */
export interface Profile {
  km: number[];
  ele: number[];
  lat: number[];
  lng: number[];
  /** Index into TripBundle.sections. */
  section: number[];
  surface: SurfaceIndex[];
  /** Cumulative climb in metres. */
  climbM: number[];
  /** Cumulative moving time in hours. */
  hours: number[];
}

export interface TrackLine {
  id: string;
  name: string;
  color: string;
  km: number;
  climbM: number;
  /** Encoded polyline. */
  line: string;
  /** Encoded integer elevations (m), one per polyline vertex. */
  elevations?: string;
  note?: string;
}

export interface Alternative extends TrackLine {
  /** 'skipped': a published section the route leaves out; 'option': a link that was not chosen. */
  style: 'option' | 'skipped';
}

export interface AlternativeGroup {
  name: string;
  items: Alternative[];
}

export interface Poi {
  name: string;
  category: PoiCategory;
  lat: number;
  lng: number;
  description?: string;
  source: string;
  /** Unverified OpenStreetMap point near the route. */
  osm?: boolean;
  /** Route km of the nearest route point, when the point is close to the route. */
  km?: number;
  /** Route km of every pass, when the route goes by more than once. */
  kms?: number[];
  /** Distance to the nearest route point. */
  offRouteM?: number;
  /** What kind of water a water point has, when known. */
  water?: WaterKind;
  /** Opening hours in OpenStreetMap syntax. */
  hours?: string;
}

export interface PoiLayer {
  items: Poi[];
  note?: string;
  link?: { label: string; url: string };
}

export interface PlanSettings {
  minDays: number;
  maxDays: number;
  defaultDays: number;
  longDayHours: number;
  start: string;
  finish: string;
  /** Suggested first day (YYYY-MM-DD); the app lets the user change it. */
  startDate?: string;
  note?: string;
  /** Hand-picked overnight stops; preferred when the plan snaps nights to stops. */
  overnights: PlanStop[];
}

export interface PlanStop {
  name: string;
  lat: number;
  lng: number;
  km: number;
}

export interface LandLayer {
  source: string;
  note?: string;
  categories: LandCategory[];
  features: LandFeature[];
}

export interface LandCategory {
  id: string;
  label: string;
  color: string;
  areaKm2: number;
}

export interface LandFeature {
  category: string;
  /** Encoded polylines: the outer ring first, then holes. */
  rings: string[];
}

/** Light vector basemap drawn under and over the imagery; each line or polygon is an encoded polyline. */
export interface BasemapOverlay {
  roadsMajor: string[];
  roadsMinor: string[];
  rail: string[];
  rivers: string[];
  lakes: string[];
  forests: string[];
  wilderness: string[];
  parks: string[];
  border: string[];
  tribal: string[];
  places: Place[];
  peaks: Peak[];
}

export type PlaceKind = 'city' | 'town' | 'village' | 'hamlet' | 'area';

export interface Place {
  name: string;
  kind: PlaceKind;
  lat: number;
  lng: number;
  rank: number;
  major?: boolean;
}

export interface Peak {
  name: string;
  lat: number;
  lng: number;
  ele: number;
  rank: number;
}

export interface ImagerySettings {
  basemaps: TileSourceId[];
  default: TileSourceId;
  /** Where the basemap picker takes its preview tiles from. */
  thumbnail?: { lat: number; lng: number };
}

export interface OfflineSettings {
  packs: OfflinePack[];
}

export interface OfflinePack {
  id: string;
  label: string;
  source: TileSourceId;
  tiles: TileRun[];
  tileCount: number;
  estimatedBytes: number;
  /** False when the pack is not ticked for download by default. */
  selected?: boolean;
}

/** Typical weather on a grid around the route, by week of the year (see shared/climate.ts). */
export interface ClimateLayer {
  source: string;
  years: [first: number, last: number];
  /** Grid spacing in degrees; cells are centred on multiples of it. */
  cellSize: { lng: number; lat: number };
  /** A day counts as wet from this much precipitation. */
  wetDayMm: number;
  /** Daily mean cloud cover (%) below which a day counts as clear and above which as cloudy. */
  cloud: { clearBelow: number; cloudyAbove: number };
  cells: ClimateCell[];
}

/** One grid cell: 52 weekly values per series, each encoded with encodeIntegers. */
export interface ClimateCell {
  lat: number;
  lng: number;
  /** Mean elevation of the cell in metres, which its temperatures refer to. */
  ele: number;
  /** Mean daily low and high, °C x 10. */
  tMin: string;
  tMax: string;
  /** Share of wet days, %. */
  wet: string;
  /** Mean precipitation, mm per day x 10. */
  rain: string;
  /** Share of clear and of cloudy days, %; the rest are partly cloudy. */
  clear: string;
  cloudy: string;
  /** 10th percentile of the daily lows and 90th of the highs, °C x 10. */
  tMinP10?: string;
  tMaxP90?: string;
  /** Mean wind speed at 2 m and the mean eastward and northward wind, km/h x 10. */
  wind?: string;
  windU?: string;
  windV?: string;
  /** Share of days when the wind reaches 25 km/h, %. */
  windy?: string;
}

export interface Notice {
  text: string;
  /** Route km ranges the notice applies to. */
  kms: [from: number, to: number][];
  /** Months (1-12) and weekdays (0 = Sunday) it applies on; any day when missing. */
  months?: number[];
  weekdays?: number[];
  /** First and last date it applies on (YYYY-MM-DD), inclusive. */
  from?: string;
  to?: string;
}

export interface ChecklistItem {
  text: string;
  link?: { label: string; url: string };
}

export interface TripFiles {
  gpxFull?: string;
  gpxSections?: string;
}

/** trips/index.json, generated at build time from all bundles. */
export interface TripIndex {
  trips: TripSummary[];
}

export interface TripSummary {
  slug: string;
  title: string;
  subtitle?: string;
  stats: TripStats;
}
