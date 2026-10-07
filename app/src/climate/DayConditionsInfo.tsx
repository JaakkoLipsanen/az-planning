import { formatHours, formatTemperature, formatTemperatureRange } from '../lib/format.ts';
import type { Day } from '../plan/dayPlan.ts';
import { SKY_COLORS } from '../theme.ts';
import { useTripModel } from '../trip/TripContext.tsx';
import type { DayConditions, DayWeather } from './conditions.ts';
import { formatDate, formatTime } from './time.ts';

import styles from './DayConditionsInfo.module.css';

const HOUR_MS = 3_600_000;

/** Hours between civil dawn at the start and civil dusk at the end; null in polar day or night. */
function lightHours(c: DayConditions): number | null {
  return c.morning.dawn !== null && c.evening.dusk !== null
    ? (c.evening.dusk - c.morning.dawn) / HOUR_MS
    : null;
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
        Highs {formatTemperatureRange(...weather.highs)} · night {formatTemperature(weather.nightLow)} · rain{' '}
        {Math.round(weather.wet)}% ({weather.rain.toFixed(1)} mm)
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

/** The day's date, light and typical weather in two or three short lines. */
export function DayConditionsSummary({ day, conditions }: { day: Day; conditions: DayConditions }) {
  const { timeZone } = useTripModel();
  const time = (instant: number | null): string => (instant === null ? '–' : formatTime(instant, timeZone));
  const light = lightHours(conditions);
  return (
    <div className={styles.summary}>
      <div>
        <b>{formatDate(conditions.date)}</b> · light {time(conditions.morning.dawn)}–
        {time(conditions.evening.dusk)}
        {light !== null && day.hours > light && (
          <span className={styles.warn}> · more riding than light</span>
        )}
      </div>
      {conditions.weather && <Weather weather={conditions.weather} />}
    </div>
  );
}

/** Full sun times and typical weather for the day popup. */
export function DayConditionsDetails({ day, conditions }: { day: Day; conditions: DayConditions }) {
  const { timeZone, climate } = useTripModel();
  const time = (instant: number | null): string => (instant === null ? '–' : formatTime(instant, timeZone));
  const light = lightHours(conditions);
  const { morning, evening, weather } = conditions;
  return (
    <div className={styles.details}>
      <b>{formatDate(conditions.date)}</b>
      <div>
        Civil dawn {time(morning.dawn)} · sunrise {time(morning.sunrise)} · sunset {time(evening.sunset)} ·
        civil dusk {time(evening.dusk)}
      </div>
      {light !== null && (
        <div className={day.hours > light ? styles.warn : undefined}>
          {formatHours(light)} of usable light for {formatHours(day.hours)} of riding
        </div>
      )}
      {weather && (
        <>
          <Weather weather={weather} />
          <div className={styles.source}>
            Typical for the date ({climate?.layer.years.join('–')} averages, adjusted for elevation), not a
            forecast.
          </div>
        </>
      )}
    </div>
  );
}
