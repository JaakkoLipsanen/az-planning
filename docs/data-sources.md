# Data sources

Where the online data comes from, how the pipeline uses it, and how to query it by hand when planning. Pipeline requests are cached in `.cache/http/`; ad-hoc queries are best saved under `.cache/` too (git-ignored).

## OpenStreetMap via Overpass

Used for POIs along the route and tribal land boundaries. Endpoint `https://overpass-api.de/api/interpreter` (POST `data=<query>`). The server answers 406 without a descriptive `User-Agent` and 429 when queried too often, so send one and leave a few seconds between queries. Query builder and docs: <https://overpass-turbo.eu>.

Features near a point or in a box:

```bash
curl -s -A 'trip-planner (personal trip planning)' https://overpass-api.de/api/interpreter --data-urlencode 'data=[out:json][timeout:60];
nwr["amenity"="drinking_water"](around:3000,32.4448,-110.7605);out center tags;' | jq '.elements[] | {id, tags}'
```

Along the whole route: `around` also takes a polyline (`around:R,lat1,lon1,lat2,lon2,...`). Build it from the bundle's profile, keeping every 20th sample (~2 km) to keep the query small:

```bash
LINE=$(jq -r '[.profile.lat, .profile.lng] | transpose | [.[range(0; length; 20)]] | map("\(.[0]),\(.[1])") | join(",")' trips/az-grand-tour/dist/trip.json)
curl -s -A 'trip-planner (personal trip planning)' https://overpass-api.de/api/interpreter --data-urlencode "data=[out:json][timeout:180];node[\"natural\"=\"spring\"](around:2000,$LINE);out tags;" > .cache/springs.json
```

To find where results fall on the route, run `pnpm trip nearest <slug> <track> <lat,lon>`, or compare against `profile.km` in `trip.json`.

## OpenStreetMap via OpenFreeMap vector tiles

Used for surface classification (z14 `transportation` layer) and the basemap overlay (z11: roads, water, parks, places, peaks). OpenMapTiles schema, documented at <https://openmaptiles.org/schema/>. The current tile URL comes from the TileJSON at `https://tiles.openfreemap.org/planet` (the planet build changes regularly). Decode tiles with `@mapbox/vector-tile` as in `pipeline/src/net/openfreemap.ts`.

## BRouter routing

Used to create connectors. Public server, GPX output that can go straight into `tracks/connectors/`:

```bash
curl -s 'https://brouter.de/brouter?lonlats=-110.9741,33.1059|-110.9058,33.0589&profile=gravel&alternativeidx=0&format=gpx' \
  -o trips/az-grand-tour/tracks/connectors/new-link.gpx
```

`lonlats` is longitude first, separated by `|`; add via points in between. Useful profiles: `gravel`, `trekking`, `mtb`, `fastbike`, `shortest` (list: <https://brouter.de/brouter/profiles2/>). The interactive planner at <https://brouter.de/brouter-web/> exports the same GPX.

## Elevation: Terrarium tiles

`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (AWS Open Data, worldwide, up to z15). Elevation in metres is `R * 256 + G + B / 256 - 32768`. The pipeline samples z12 for points without elevation, and the app uses the same tiles for hillshade, elevation tint and 3D terrain, up to z12 (the catalog's `maxzoom`; MapLibre scales them up beyond that), so terrain packs stop at z12.

## Land ownership: BLM Surface Management Agency

US only. ArcGIS REST service `https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/1/query`, queried as GeoJSON for the trip's `region` (see `pipeline/src/layers/land.ts` for the parameters). The `ADMIN_AGENCY_CODE` field maps to the overlay categories. The service returns at most 2,000 features per query; the build fails if a region needs more, rather than silently dropping land.

## Map tiles in the app

The catalog is `shared/basemaps.ts`:

| Source             | URL template                                                                                      | Offline packs                             |
| ------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| USGS topo          | `https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}`        | yes (public domain)                       |
| USGS imagery       | `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}` | yes                                       |
| Terrarium DEM      | see above                                                                                         | yes                                       |
| OpenTopoMap        | `https://tile.opentopomap.org/{z}/{x}/{y}.png`                                                    | no, bulk downloads are against its policy |
| Esri World Imagery | `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`   | no                                        |
| Mapbox             | user's own token                                                                                  | no                                        |

Note the `{y}/{x}` order in the ArcGIS URLs. All of these send `Access-Control-Allow-Origin: *`, which the app needs to read tiles in the browser.
