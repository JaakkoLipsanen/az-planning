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
}

export interface PowerSeries {
  /** Mean elevation of the grid cell in metres, which the temperatures refer to. */
  elevation: number;
  days: PowerDay[];
}

interface PowerResponse {
  geometry: { coordinates: [number, number, number] };
  properties: {
    parameter: Record<'T2M_MIN' | 'T2M_MAX' | 'PRECTOTCORR' | 'CLOUD_AMT', Record<string, number>>;
  };
}

function rejectErrors(data: Buffer): void {
  const body = JSON.parse(data.toString('utf8')) as Partial<PowerResponse> & { messages?: string[] };
  if (!body.properties?.parameter) throw new Error(`NASA POWER: ${JSON.stringify(body.messages ?? body)}`);
}

/** Daily temperature, precipitation and cloud cover of one POWER grid cell for whole years. */
export async function powerDaily(
  lat: number,
  lng: number,
  [first, last]: [number, number],
): Promise<PowerSeries> {
  const params = new URLSearchParams({
    parameters: 'T2M_MIN,T2M_MAX,PRECTOTCORR,CLOUD_AMT',
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
    const day = {
      date,
      tMin: p.T2M_MIN[date],
      tMax: p.T2M_MAX[date],
      rain: p.PRECTOTCORR[date],
      cloud: p.CLOUD_AMT[date],
    };
    return Object.values(day).includes(FILL) ? [] : [day];
  });
  return { elevation: body.geometry.coordinates[2], days };
}
