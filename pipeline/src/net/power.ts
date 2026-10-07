import { cachedJson } from './http.ts';

const ENDPOINT = 'https://power.larc.nasa.gov/api/temporal/daily/point';
const FILL = -999;

/** NASA POWER serves MERRA-2 temperatures and precipitation on this grid; cells are centred on multiples of it. */
export const POWER_CELL = { lng: 0.625, lat: 0.5 };

export interface PowerDay {
  /** YYYYMMDD */
  date: string;
  tMin: number;
  tMax: number;
  /** mm per day */
  rain: number;
  /** Mean cloud amount, % */
  cloud: number;
  /** Mean and highest wind speed and the mean eastward and northward wind at 2 m, m/s */
  wind: number;
  windMax: number;
  windU: number;
  windV: number;
}

export interface PowerSeries {
  /** Mean elevation of the grid cell in metres, which the temperatures refer to. */
  elevation: number;
  days: PowerDay[];
}

const PARAMETERS = {
  tMin: 'T2M_MIN',
  tMax: 'T2M_MAX',
  rain: 'PRECTOTCORR',
  cloud: 'CLOUD_AMT',
  wind: 'WS2M',
  windMax: 'WS2M_MAX',
  windU: 'U2M',
  windV: 'V2M',
} as const satisfies Record<Exclude<keyof PowerDay, 'date'>, string>;

type PowerParameter = (typeof PARAMETERS)[keyof typeof PARAMETERS];

interface PowerResponse {
  geometry: { coordinates: [number, number, number] };
  properties: { parameter: Record<PowerParameter, Record<string, number>> };
}

function rejectErrors(data: Buffer): void {
  const body = JSON.parse(data.toString('utf8')) as Partial<PowerResponse> & { messages?: string[] };
  if (!body.properties?.parameter) throw new Error(`NASA POWER: ${JSON.stringify(body.messages ?? body)}`);
}

/** Daily temperature, precipitation, cloud cover and wind of one POWER grid cell for whole years. */
export async function powerDaily(
  lat: number,
  lng: number,
  [first, last]: [number, number],
): Promise<PowerSeries> {
  const params = new URLSearchParams({
    parameters: Object.values(PARAMETERS).join(','),
    community: 'RE',
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    start: `${first}0101`,
    end: `${last}1231`,
    format: 'JSON',
  });
  const body = await cachedJson<PowerResponse>(`${ENDPOINT}?${params.toString()}`, {
    validate: rejectErrors,
  });
  const p = body.properties.parameter;
  const days = Object.keys(p.T2M_MIN).flatMap((date): PowerDay[] => {
    const values = Object.entries(PARAMETERS).map(([key, name]) => [key, p[name][date]] as const);
    if (values.some(([, v]) => v === FILL || v === undefined)) return [];
    return [{ date, ...(Object.fromEntries(values) as Omit<PowerDay, 'date'>) }];
  });
  return { elevation: body.geometry.coordinates[2], days };
}
