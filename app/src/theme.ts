import type { PoiCategory, SurfaceIndex, WaterKind } from '#shared/bundle.ts';

import type { PoiGroup } from './state/tripStore.ts';

export const SURFACE_INDICES: readonly SurfaceIndex[] = [0, 1, 2];

export const SURFACE_COLORS: Record<SurfaceIndex, string> = { 0: '#c4262e', 1: '#8d5a24', 2: '#2b2b2b' };
export const SURFACE_LABELS: Record<SurfaceIndex, string> = {
  0: 'Singletrack / trail',
  1: 'Unpaved road & 4x4 track',
  2: 'Paved',
};
export const SURFACE_SHORT: Record<SurfaceIndex, string> = { 0: 'trail', 1: 'dirt', 2: 'paved' };

export const CATEGORY_COLORS: Record<PoiCategory | 'plan', string> = {
  water: '#2e6f8e',
  resupply: '#d97b1a',
  bike: '#b5177a',
  camp: '#3f7d3a',
  lodging: '#7a4b2a',
  info: '#6f6a62',
  plan: '#1f5a2a',
};

export const POI_GROUPS: { id: PoiGroup; label: string; color: string }[] = [
  { id: 'water', label: 'Water (route files & notes)', color: CATEGORY_COLORS.water },
  { id: 'resupply', label: 'Resupply: shops, fuel, food', color: CATEGORY_COLORS.resupply },
  { id: 'bike', label: 'Bike shops', color: CATEGORY_COLORS.bike },
  { id: 'camp', label: 'Campgrounds & camp spots', color: CATEGORY_COLORS.camp },
  { id: 'lodging', label: 'Lodging', color: CATEGORY_COLORS.lodging },
  { id: 'info', label: 'Notes & trail info', color: CATEGORY_COLORS.info },
  { id: 'plan', label: 'Suggested overnights (day plan)', color: CATEGORY_COLORS.plan },
  { id: 'osm', label: 'OpenStreetMap points (unverified)', color: '#6f6357' },
];

export const CATEGORY_LABELS: Record<PoiCategory, string> = {
  water: 'Water',
  resupply: 'Resupply',
  bike: 'Bike shop',
  camp: 'Camping',
  lodging: 'Lodging',
  info: 'Note',
};

export const WATER_LABELS: Record<WaterKind, string> = {
  tap: 'tap',
  collector: 'rain collector',
  natural: 'natural source: may be dry, treat it',
};

export const TEMPERATURE_COLORS = {
  high: '#d9480f',
  low: '#1c7ed6',
  band: 'rgba(240, 140, 60, 0.22)',
  freezing: '#4dabf7',
};

/** Clear, partly cloudy and cloudy skies. */
export const SKY_COLORS = ['#7cc4ef', '#b9c3cc', '#6e7782'] as const;

export const DAY_COLORS = ['#d62839', '#1b8a5a', '#2d5bd7', '#e07b00', '#8e3bb5', '#0f8b9c'];
export const DAY_HIGHLIGHT = '#ffd21f';
export const DAY_HIGHLIGHT_STROKE = '#e0a800';
export const GPS_COLOR = '#1a73e8';

export function dayColor(day: number): string {
  return DAY_COLORS[(day - 1) % DAY_COLORS.length];
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
