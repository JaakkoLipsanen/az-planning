import type { PoiCategory } from '#shared/bundle.ts';

import type { PoiConfig } from '../config/schema.ts';

/** Generic English keywords; place names and local chains belong in trip.yaml `pois.keywords`. */
const KEYWORDS: Record<Exclude<PoiCategory, 'bike'>, string[]> = {
  info: ['no camping', 'no wild camping'],
  camp: ['campground', 'dispersed camping', 'camping', 'camp', 'campsite', 'state park'],
  water: [
    'water',
    'spring',
    'tank',
    'creek',
    'river',
    'collector',
    'spigot',
    'fountain',
    'h20',
    'picnic area',
  ],
  lodging: ['inn', 'motel', 'hotel', 'b&b', 'lodge', 'home stay'],
  resupply: [
    'market',
    'supermarket',
    'store',
    'grocery',
    'bakery',
    'bread',
    'gas',
    'restaurant',
    'cafe',
    'café',
    'diner',
    'pizza',
    'brewery',
    'bar',
    'grill',
    'taco',
    'deli',
    'coffee',
    'convenience',
    'kitchen',
    'resupply',
    'marina',
    'shopping',
    'food',
    'lunch',
    'breakfast',
  ],
};
const CATEGORY_ORDER = ['info', 'camp', 'water', 'lodging', 'resupply'] as const;
const BIKE = /\b(bike shop|bikes?|bicycles?|cycles?|cyclery|rideshop)\b/;
const NO_BIKES = /\b(no bikes?|bikes? (are )?(not|prohibited))\b/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole words or phrases, also in the plural; "river" does not match "riverbank". */
function keywordPattern(words: readonly string[]): RegExp {
  const alternatives = words.map((w) => escapeRegExp(w.trim().toLowerCase())).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?:s|es)?(?![\\p{L}\\p{N}])`, 'u');
}

export type WaypointClassifier = (name: string, description: string) => PoiCategory;

/** Keyword classification of waypoint names and descriptions written by route authors. */
export function waypointClassifier(extra: PoiConfig['keywords']): WaypointClassifier {
  const patterns = CATEGORY_ORDER.map(
    (category) => [category, keywordPattern([...KEYWORDS[category], ...(extra[category] ?? [])])] as const,
  );
  return (name, description) => {
    const text = `${name} ${description}`.toLowerCase();
    if (BIKE.test(text) && !NO_BIKES.test(text)) return 'bike';
    return patterns.find(([, pattern]) => pattern.test(text))?.[0] ?? 'info';
  };
}

export interface OsmPoi {
  category: PoiCategory;
  name: string;
  description: string;
}

function tagList(tags: Record<string, string>, keys: string[]): string {
  return keys
    .filter((k) => tags[k] !== undefined)
    .map((k) => `${k}: ${tags[k]}`)
    .join(', ');
}

/** Rules for OpenStreetMap tags; in dense areas only bike shops, supermarkets, camps and water count. */
export function classifyOsm(tags: Record<string, string>, dense: boolean): OsmPoi | null {
  const { shop, amenity, tourism, natural, man_made: manMade, name = '' } = tags;
  const food = ['restaurant', 'cafe', 'fast_food', 'bar', 'pub'];
  const hours = tagList(tags, ['opening_hours']);
  if (shop === 'bicycle')
    return {
      category: 'bike',
      name: name || 'Bike shop',
      description: tagList(tags, ['opening_hours', 'phone', 'website']),
    };
  if (shop === 'supermarket')
    return { category: 'resupply', name: name || 'Supermarket', description: `Supermarket. ${hours}` };
  if (!dense && shop && ['convenience', 'general', 'greengrocer', 'deli', 'bakery'].includes(shop)) {
    return {
      category: 'resupply',
      name: name || shop[0].toUpperCase() + shop.slice(1),
      description: `${shop}. ${hours}`,
    };
  }
  if (!dense && (shop === 'outdoor' || shop === 'sports'))
    return { category: 'resupply', name: name || shop, description: `${shop} shop. ${hours}` };
  if (!dense && amenity === 'fuel') {
    return {
      category: 'resupply',
      name: `${name || 'Gas station'} (fuel station)`,
      description: tagList(tags, ['brand', 'opening_hours']),
    };
  }
  if (!dense && amenity && food.includes(amenity)) {
    return {
      category: 'resupply',
      name: name || amenity,
      description: `${amenity}. ${tagList(tags, ['cuisine', 'opening_hours'])}`,
    };
  }
  if (!dense && tourism && ['hotel', 'motel', 'guest_house', 'hostel'].includes(tourism)) {
    return {
      category: 'lodging',
      name: name || tourism,
      description: `${tourism}. ${tagList(tags, ['phone', 'website'])}`,
    };
  }
  if (tourism === 'camp_site' || tourism === 'caravan_site') {
    return {
      category: 'camp',
      name: name || (tourism === 'camp_site' ? 'Campground' : 'RV park'),
      description: tagList(tags, [
        'operator',
        'fee',
        'drinking_water',
        'toilets',
        'reservation',
        'backcountry',
        'tents',
        'description',
      ]),
    };
  }
  if (amenity === 'drinking_water' || amenity === 'water_point' || manMade === 'water_tap') {
    return {
      category: 'water',
      name: name || 'Drinking water',
      description: amenity ? `OSM: ${amenity.replace('_', ' ')}` : 'OSM: water tap',
    };
  }
  if (natural === 'spring') {
    return {
      category: 'water',
      name: `${name || 'Spring'} (spring)`,
      description: `OSM-mapped spring. Reliability unknown - often seasonal; treat all water. ${tagList(tags, ['description', 'seasonal', 'intermittent'])}`,
    };
  }
  if (manMade === 'water_well' || manMade === 'windpump') {
    return {
      category: 'water',
      name: `${name || (manMade === 'water_well' ? 'Well' : 'Windmill')} (${manMade.replace('_', ' ')})`,
      description: `OSM-mapped well/windmill. May be dry or fenced; treat all water. ${tagList(tags, ['description', 'pump'])}`,
    };
  }
  if (!dense && manMade === 'storage_tank' && tags.content === 'water' && name) {
    return {
      category: 'water',
      name: `${name} (water tank)`,
      description:
        'OSM-mapped water storage tank (often stock water or a private supply - access not guaranteed).',
    };
  }
  if (natural === 'water' && name) {
    return {
      category: 'water',
      name: `${name} (pond)`,
      description: `OSM-mapped pond or stock tank. Often seasonal and shared with cattle; filter and treat. ${tagList(tags, ['water', 'intermittent', 'seasonal'])}`,
    };
  }
  if (tags.waterway === 'dam' && name)
    return {
      category: 'water',
      name: `${name} (dam)`,
      description: 'OSM-mapped dam or stock tank. Often seasonal; treat all water.',
    };
  return null;
}

/** Overpass query for the features classifyOsm knows, within radiusM of a line of [lat, lon] points. */
export function osmQuery(line: readonly [lat: number, lon: number][], radiusM: number): string {
  const around = `(around:${radiusM},${line.map(([lat, lon]) => `${lat.toFixed(4)},${lon.toFixed(4)}`).join(',')})`;
  return [
    '[out:json][timeout:300];(',
    `node["shop"~"^(bicycle|supermarket|convenience|general|greengrocer|deli|bakery|outdoor|sports)$"]${around};`,
    `way["shop"~"^(bicycle|supermarket|convenience|general|outdoor)$"]${around};`,
    `node["amenity"~"^(fuel|drinking_water|water_point|cafe|restaurant|fast_food|bar|pub)$"]${around};`,
    `way["amenity"~"^(fuel|restaurant|cafe)$"]${around};`,
    `nwr["tourism"~"^(camp_site|caravan_site|hotel|motel|guest_house|hostel)$"]${around};`,
    `nwr["natural"="spring"]${around};`,
    `nwr["man_made"~"^(water_tap|water_well|storage_tank|windpump)$"]${around};`,
    `nwr["natural"="water"]["name"~"Tank|Spring|Well|Pond",i]${around};`,
    `nwr["waterway"="dam"]["name"~"Tank",i]${around};`,
    ');out center tags;',
  ].join('');
}
