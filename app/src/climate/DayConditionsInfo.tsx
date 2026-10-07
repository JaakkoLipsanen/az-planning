import { formatHours, formatTemperature, formatTemperatureRange } from '../lib/format.ts';
import type { Day } from '../plan/dayPlan.ts';
import { SKY_COLORS } from '../theme.ts';
import { useTripModel } from '../trip/TripContext.tsx';
import type { DayConditions, DayRide, DayWeather, DayWind } from './conditions.ts';
import type { DayForecast } from './forecast.ts';
import type { MoonNight } from './moon.ts';
import { formatDate, formatTime } from './time.ts';

import styles from './DayConditionsInfo.module.css';

const HOUR_MS = 3_600_000;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

type TimeText = (instant: number | null) => string;

function useTimeText(): TimeText {
  const { timeZone } = useTripModel();
  return (instant) => (instant === null ? '–' : formatTime(instant, timeZone));
}

function SkyBar({ weather }: { weather: DayWeather }) {
  const shares = [
    ['clear', weather.clear],
    ['partly cloudy', weather.partly],
    ['cloudy', weather.cloudy],
  ] as const;
  return (
    <span className={styles.sky}>
      {shares.map(([label, share], i) => (
        <i
          key={label}
          style={{ width: `${share}%`, background: SKY_COLORS[i] }}
          title={`${label} ${Math.round(share)}% of days`}
        />
      ))}
    </span>
  );
}

function Weather({ weather }: { weather: DayWeather }) {
  return (
    <>
      <div>
        Typical highs {formatTemperatureRange(...weather.highs)} · night {formatTemperature(weather.nightLow)}{' '}
        · rain {Math.round(weather.wet)}% ({weather.rain.toFixed(1)} mm)
      </div>
      <div className={styles.skyRow}>
        <SkyBar weather={weather} />
        <span>
          clear {Math.round(weather.clear)}% · partly {Math.round(weather.partly)}% · cloudy{' '}
          {Math.round(weather.cloudy)}%
        </span>
      </div>
    </>
  );
}

function forecastText(f: DayForecast): string {
  const temperatures = [f.high, f.low].filter((t) => t !== null).map((t) => formatTemperature(t));
  return [f.summary, temperatures.join(' / '), f.rain !== null && `rain ${Math.round(f.rain)} %`, f.wind]
    .filter(Boolean)
    .join(' · ');
}

function windText(w: DayWind): string {
  const from =
    w.from === null ? 'from varying directions' : `mostly from the ${COMPASS[Math.round(w.from / 45) % 8]}`;
  const along =
    Math.abs(w.tailKmh) < 1
      ? 'no steady head- or tailwind along the day'
      : `on average a ${Math.round(Math.abs(w.tailKmh))} km/h ${w.tailKmh > 0 ? 'tailwind' : 'headwind'} along the day`;
  const windy = w.windy >= 5 ? ` · ${Math.round(w.windy)} % of days reach 25 km/h` : '';
  return `Wind typically ${Math.round(w.kmh)} km/h near the ground, ${from}; ${along}${windy}`;
}

function moonText(m: MoonNight, time: TimeText): string {
  const lit = `${Math.round(m.fraction * 100)} % lit, ${m.waxing ? 'waxing' : 'waning'}`;
  let when: string;
  if (m.rises === null && m.sets === null)
    when = m.upAtStart ? 'up all night' : 'below the horizon all night';
  else if (m.upAtStart) when = `sets ${time(m.sets)}${m.rises !== null ? `, rises ${time(m.rises)}` : ''}`;
  else
    when = `rises ${time(m.rises)}${m.sets !== null && m.rises !== null && m.sets > m.rises ? `, sets ${time(m.sets)}` : ''}`;
  return `Moon ${lit}: ${when}`;
}

/** "ride 07:12–15:50" and how it relates to the light; `short` for the day cards. */
function RideText({
  ride,
  dusk,
  time,
  short = false,
}: {
  ride: DayRide;
  dusk: number | null;
  time: TimeText;
  short?: boolean;
}) {
  if (ride.darkKm !== null && dusk !== null) {
    return (
      <span className={styles.warn}>
        ride {time(ride.start)}–{time(ride.end)} · dark from km {Math.round(ride.darkKm)}
        {!short && ` (${formatHours((ride.end - dusk) / HOUR_MS)} after civil dusk ${time(dusk)})`}
      </span>
    );
  }
  return (
    <>
      ride {time(ride.start)}–{time(ride.end)}
      {dusk !== null && <> · dusk {time(dusk)}</>}
      {ride.startsInDark && <span className={styles.warn}> · starts before dawn</span>}
    </>
  );
}

/** The day's date, riding hours, forecast and typical weather in a few short lines. */
export function DayConditionsSummary({
  conditions,
  forecast,
}: {
  conditions: DayConditions;
  forecast: DayForecast | undefined;
}) {
  const time = useTimeText();
  const { ride, evening, weather } = conditions;
  return (
    <div className={styles.summary}>
      <div>
        <b>{formatDate(conditions.date)}</b>
        {ride && (
          <>
            {' '}
            · <RideText ride={ride} dusk={evening.dusk} time={time} short />
          </>
        )}
      </div>
      {forecast && <div className={styles.forecast}>Forecast: {forecastText(forecast)}</div>}
      {weather && <Weather weather={weather} />}
    </div>
  );
}

/** Sun, riding hours, forecast, typical weather, wind and moon for the day popup. */
export function DayConditionsDetails({
  day,
  conditions,
  forecast,
  breakPercent,
}: {
  day: Day;
  conditions: DayConditions;
  forecast: DayForecast | undefined;
  breakPercent: number;
}) {
  const { climate } = useTripModel();
  const time = useTimeText();
  const { morning, evening, ride, weather, moon } = conditions;
  return (
    <div className={styles.details}>
      <b>{formatDate(conditions.date)}</b>
      <div>
        Civil dawn {time(morning.dawn)} · sunrise {time(morning.sunrise)} · sunset {time(evening.sunset)} ·
        civil dusk {time(evening.dusk)}
      </div>
      {ride && (
        <div>
          <RideText ride={ride} dusk={evening.dusk} time={time} /> ({formatHours(day.hours)} moving +{' '}
          {breakPercent} % breaks)
        </div>
      )}
      {forecast && (
        <div className={styles.forecast}>
          Forecast: {forecastText(forecast)}{' '}
          <span className={styles.source}>
            (National Weather Service, fetched{' '}
            {formatDate(new Date(forecast.fetched).toISOString().slice(0, 10))} {time(forecast.fetched)})
          </span>
        </div>
      )}
      {weather && (
        <>
          <Weather weather={weather} />
          {(weather.coldNight !== null || weather.hotDay !== null) && (
            <div>
              {weather.coldNight !== null && (
                <>1 night in 10 is below {formatTemperature(weather.coldNight)}</>
              )}
              {weather.coldNight !== null && weather.hotDay !== null && ' · '}
              {weather.hotDay !== null && <>1 day in 10 tops {formatTemperature(weather.hotDay)}</>}
            </div>
          )}
          {weather.wind && <div>{windText(weather.wind)}</div>}
        </>
      )}
      {moon && <div>{moonText(moon, time)}</div>}
      {weather && (
        <div className={styles.source}>
          Typical for the date ({climate?.layer.years.join('–')}, adjusted for elevation), not a forecast.
        </div>
      )}
    </div>
  );
}
