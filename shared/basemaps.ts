export interface TileSource {
  kind: 'raster' | 'dem';
  label: string;
  title: string;
  /** Template with {z}/{x}/{y}; Mapbox also takes {style} and {token}. */
  url: string;
  tileSize: 256 | 512;
  /** The zoom range the app requests; the map scales the highest zoom up beyond it. */
  minzoom: number;
  maxzoom: number;
  attribution: string;
  /** The provider's terms allow storing tiles in bulk for offline use. */
  offline: boolean;
  /** The tiles carry their own place names, so the overlay's labels are hidden on top of them. */
  hasLabels: boolean;
  averageTileBytes: number;
}

/** Map tile providers by id; trips choose from these in `imagery` and `offline` of trip.yaml. */
const SOURCES = {
  'usgs-topo': {
    kind: 'raster',
    label: 'Topo',
    title: 'USGS topo maps (The National Map)',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    tileSize: 256,
    minzoom: 8,
    maxzoom: 16,
    attribution: 'Topo: USGS The National Map',
    offline: true,
    hasLabels: true,
    averageTileBytes: 26_000,
  },
  'usgs-imagery': {
    kind: 'raster',
    label: 'Satellite',
    title: 'USGS / NAIP aerial imagery (The National Map)',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    tileSize: 256,
    minzoom: 8,
    maxzoom: 16,
    attribution: 'Imagery: USGS The National Map',
    offline: true,
    hasLabels: false,
    averageTileBytes: 24_000,
  },
  opentopomap: {
    kind: 'raster',
    label: 'OpenTopoMap',
    title: 'OpenTopoMap, worldwide (online only, CC-BY-SA)',
    url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
    tileSize: 256,
    minzoom: 0,
    maxzoom: 17,
    attribution: 'OpenTopoMap (CC-BY-SA)',
    offline: false,
    hasLabels: true,
    averageTileBytes: 40_000,
  },
  'esri-imagery': {
    kind: 'raster',
    label: 'Esri imagery',
    title: 'Esri World Imagery, worldwide (online only)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    tileSize: 256,
    minzoom: 0,
    maxzoom: 19,
    attribution: 'Imagery: Esri, Maxar, Earthstar Geographics',
    offline: false,
    hasLabels: false,
    averageTileBytes: 30_000,
  },
  mapbox: {
    kind: 'raster',
    label: 'Mapbox',
    title: 'Mapbox styles with your own access token (online only)',
    url: 'https://api.mapbox.com/styles/v1/mapbox/{style}/tiles/512/{z}/{x}/{y}@2x?access_token={token}',
    tileSize: 512,
    minzoom: 0,
    maxzoom: 22,
    attribution: '© Mapbox © OpenStreetMap',
    offline: false,
    hasLabels: true,
    averageTileBytes: 60_000,
  },
  terrain: {
    kind: 'dem',
    label: 'Terrain',
    title: 'Shaded relief and elevation tint, worldwide (Terrarium elevation tiles, AWS Open Data)',
    url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    tileSize: 256,
    minzoom: 0,
    maxzoom: 12,
    attribution: 'Terrain: Mapzen / AWS Open Data',
    offline: true,
    hasLabels: false,
    averageTileBytes: 70_000,
  },
} satisfies Record<string, TileSource>;

export type TileSourceId = keyof typeof SOURCES;

export const TILE_SOURCES: Record<TileSourceId, TileSource> = SOURCES;

export function isTileSourceId(id: string): id is TileSourceId {
  return Object.hasOwn(TILE_SOURCES, id);
}

export function tileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}
