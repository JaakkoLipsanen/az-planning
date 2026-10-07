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

## Typical weather: NASA POWER

Worldwide daily weather since the 1980s from NASA's POWER project: temperature, precipitation and wind from the MERRA-2 reanalysis, cloud cover from CERES satellite data. Free, no key. The pipeline fetches 20 years for every grid cell near the route (cells are 0.625° of longitude by 0.5° of latitude, about 55 km) and stores weekly values: mean daily low and high, the 10th percentile of the lows and 90th of the highs, share of wet days (≥ 1 mm), mean precipitation, shares of clear (< 25 % cloud) and cloudy (> 75 %) days, and the wind at 2 m: mean speed, mean eastward and northward wind (the prevailing direction, and the head- or tailwind along a day) and the share of days when it reaches 25 km/h.

```bash
curl -s 'https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M_MIN,T2M_MAX,PRECTOTCORR,CLOUD_AMT,WS2M,WS2M_MAX,U2M,V2M&community=RE&longitude=-110.625&latitude=32.5&start=20050101&end=20241231&format=JSON' \
  | jq '.geometry.coordinates, (.properties.parameter.T2M_MAX | to_entries[:3])'
```

The third coordinate in the response is the cell's mean elevation; temperatures refer to it. The app moves them to any elevation, which matters in the mountains: the cell around Mt Lemmon averages 1,178 m, Summerhaven is at 2,400 m. Highs drop 6.5 °C per km and lows 3 °C per km. Against the 1991-2020 December normals of 61 NOAA stations within reach of the route, the highs are within 0.8 °C on average (0.6 °C warm). The lows are within 2.4 °C, about 2 °C warm on average: clear winter nights pool cold air in basins (Nogales 6 N, Cascabel and Catalina State Park are 5-7 °C colder than the model), while ridges stay warmer than 6.5 °C per km would make them (Mt Lemmon was 4 °C too cold with it, hence the smaller rate for lows). Plan for colder nights at camps in valley bottoms. Daily mean wind at 2 m includes calm nights, so daytime gusts are stronger than the typical speed. Reanalysis rain falls on more days than gauges record.

NOAA's station normals, for checks like this one (stations from `access/services/search/v1/data?dataset=normals-monthly-1991-2020&bbox=N,W,S,E`):

```bash
curl -s 'https://www.ncei.noaa.gov/access/services/data/v1?dataset=normals-monthly-1991-2020&dataTypes=MLY-TMAX-NORMAL,MLY-TMIN-NORMAL&stations=USW00023160&format=json&units=metric' | jq '.[11]'
```

## Weather forecast: National Weather Service

For planned days within the next week the app shows the forecast from `api.weather.gov` (US only, free, no key, CORS allowed): `/points/{lat},{lon}` gives the forecast URL of the grid cell (stored on the device for good), and that URL with `?units=si` gives twelve-hour periods in °C and km/h (stored for an hour, and kept for offline use). The day's period comes from the middle of the day's route and the night's from the night stop.

## Land ownership: BLM Surface Management Agency

US only. ArcGIS REST service `https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/1/query`, queried as GeoJSON for the trip's `region` (see `pipeline/src/layers/land.ts` for the parameters). The `ADMIN_AGENCY_CODE` field maps to the overlay categories. The service returns at most 2,000 features per query; larger regions are read in pages of 1,000 (`orderByFields=OBJECTID&resultOffset=…&resultRecordCount=…`).

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
