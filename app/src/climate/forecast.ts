import { useEffect, useState } from 'react';
import { z } from 'zod';

import type { DayPlan } from '../plan/dayPlan.ts';
import { addDays, todayIn } from './time.ts';

/** The US National Weather Service: free, no key, United States only. */
const API = 'https://api.weather.gov';
const FORECAST_DAYS = 7;
const REFRESH_MS = 60 * 60_000;
const TIMEOUT_MS = 10_000;
const STORE_PREFIX = 'nws:';

export interface DayForecast {
  summary: string;
  /** °C */
  high: number | null;
  low: number | null;
  /** Chance of precipitation by day, %. */
  rain: number | null;
  wind: string | null;
  /** When the forecast was fetched (ms). */
  fetched: number;
}

const periodSchema = z.object({
  startTime: z.string(),
  isDaytime: z.boolean(),
  temperature: z.number().nullable(),
  probabilityOfPrecipitation: z.object({ value: z.number().nullable() }).nullish(),
  windSpeed: z.string().nullish(),
  windDirection: z.string().nullish(),
  shortForecast: z.string(),
});
type Period = z.infer<typeof periodSchema>;

const storedForecast = z.object({ fetched: z.number(), periods: z.array(periodSchema) });
type StoredForecast = z.infer<typeof storedForecast>;

function readStore<T>(key: string, schema: z.ZodType<T>): T | null {
  try {
    return schema.safeParse(JSON.parse(localStorage.getItem(STORE_PREFIX + key) ?? 'null')).data ?? null;
  } catch {
    return null;
  }
}

function writeStore(key: string, value: unknown): void {
  try {
    localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Without storage the forecast is fetched again next time.
  }
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: 'application/geo+json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** The forecast URL of the grid cell at a point; '' where the service has no forecast (outside the US). */
async function forecastUrl(lat: number, lng: number): Promise<string | null> {
  const key = `points:${lat.toFixed(3)},${lng.toFixed(3)}`;
  const known = readStore(key, z.string());
  if (known !== null) return known;
  const body = await getJson(`${API}/points/${lat.toFixed(4)},${lng.toFixed(4)}`);
  const url = z.object({ properties: z.object({ forecast: z.string() }) }).safeParse(body).data;
  const result = url ? `${url.properties.forecast}?units=si` : '';
  if (body === null || url) writeStore(key, result);
  return result;
}

const requests = new Map<string, Promise<StoredForecast | null>>();

/** Twelve-hour periods for a grid cell: a fresh stored copy, else the service, else any stored copy. */
function periods(url: string): Promise<StoredForecast | null> {
  const stored = readStore(url, storedForecast);
  if (stored && Date.now() - stored.fetched < REFRESH_MS) return Promise.resolve(stored);
  let request = requests.get(url);
  if (!request) {
    request = getJson(url)
      .then((body) => {
        const parsed = z.object({ properties: z.object({ periods: z.array(periodSchema) }) }).safeParse(body);
        if (!parsed.success) return stored;
        const fresh = { fetched: Date.now(), periods: parsed.data.properties.periods };
        writeStore(url, fresh);
        return fresh;
      })
      .catch(() => stored)
      .finally(() => requests.delete(url));
    requests.set(url, request);
  }
  return request;
}

const localDate = (p: Period): string => p.startTime.slice(0, 10);

function windText(p: Period | undefined): string | null {
  if (!p?.windSpeed) return null;
  return `${p.windDirection ? `${p.windDirection} ` : ''}${p.windSpeed.replace(' to ', '–')}`;
}

async function dayForecast(
  date: string,
  daytime: { lat: number; lng: number },
  night: { lat: number; lng: number } | null,
): Promise<DayForecast | null> {
  const dayUrl = await forecastUrl(daytime.lat, daytime.lng);
  if (!dayUrl) return null;
  const nightUrl = night ? await forecastUrl(night.lat, night.lng) : null;
  const [day, evening] = await Promise.all([periods(dayUrl), nightUrl ? periods(nightUrl) : null]);
  const light = day?.periods.find((p) => p.isDaytime && localDate(p) === date);
  const dark = (evening ?? day)?.periods.find((p) => !p.isDaytime && localDate(p) === date);
  if (!light && !dark) return null;
  return {
    summary: (light ?? dark)?.shortForecast ?? '',
    high: light?.temperature ?? null,
    low: dark?.temperature ?? null,
    rain: light?.probabilityOfPrecipitation?.value ?? dark?.probabilityOfPrecipitation?.value ?? null,
    wind: windText(light ?? dark),
    fetched: Math.min(day?.fetched ?? Infinity, evening?.fetched ?? Infinity),
  };
}

const NONE = new Map<number, DayForecast>();

/** The forecast for the planned days within the next week (by day number); empty elsewhere or offline. */
export function useForecasts(
  plan: DayPlan,
  dates: readonly string[] | null,
  timeZone: string,
): Map<number, DayForecast> {
  const key = dates ? `${dates.join()}|${plan.days.map((d) => d.endKm).join()}` : '';
  const [state, setState] = useState({ key: '', forecasts: NONE });
  useEffect(() => {
    if (!dates) return;
    const today = todayIn(timeZone);
    const last = addDays(today, FORECAST_DAYS - 1);
    const days = plan.days.filter((d) => dates[d.number - 1] >= today && dates[d.number - 1] <= last);
    if (days.length === 0) return;
    let cancelled = false;
    void Promise.all(
      days.map(async (d) => {
        const [lng, lat] = d.mid;
        const forecast = await dayForecast(dates[d.number - 1], { lat, lng }, d.night).catch(() => null);
        return [d.number, forecast] as const;
      }),
    ).then((results) => {
      if (cancelled) return;
      const forecasts = new Map(results.filter((r): r is [number, DayForecast] => r[1] !== null));
      setState({ key, forecasts });
    });
    return () => {
      cancelled = true;
    };
  }, [plan, dates, timeZone, key]);
  return state.key === key ? state.forecasts : NONE;
}
