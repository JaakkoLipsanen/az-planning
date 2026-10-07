import { useMemo } from 'react';

import { formatTemperature } from '../lib/format.ts';
import { useTripState } from '../state/tripStore.ts';
import { useTripModel } from '../trip/TripContext.tsx';
import { overlayDate } from './overlay.ts';
import { routeTemperatureStats } from './routeStats.ts';
import { TEMPERATURE_RAMP, temperatureGradient } from './temperatureTiles.ts';

import styles from './TemperatureControl.module.css';

const TICKS = [-20, -10, 0, 10, 20, 30, 40];
const [LOW, HIGH] = [TEMPERATURE_RAMP[0][0], TEMPERATURE_RAMP[TEMPERATURE_RAMP.length - 1][0]];

/** Temperatures along the whole route at the overlay's date and hour; the extremes jump to their place. */
function RouteStats({ date, hour }: { date: string; hour: number }) {
  const model = useTripModel();
  const moveCamera = useTripState((s) => s.moveCamera);
  const stats = useMemo(() => routeTemperatureStats(model, date, hour), [model, date, hour]);
  if (!stats) return null;
  const show = (km: number): void =>
    moveCamera({ kind: 'center', center: model.profile.lngLatAtKm(km), minZoom: 11 });
  const values: [label: string, celsius: number, km?: number][] = [
    ['min', stats.min, stats.minKm],
    ['10 %', stats.p10],
    ['avg', stats.mean],
    ['90 %', stats.p90],
    ['max', stats.max, stats.maxKm],
  ];
  return (
    <div className={styles.stats}>
      <div className={styles.statsTitle}>Along the whole route</div>
      <div className={styles.statsGrid} data-testid="route-temperature">
        {values.map(([label, celsius, km]) =>
          km === undefined ? (
            <div key={label}>
              <span>{label}</span>
              <b>{formatTemperature(celsius)}</b>
            </div>
          ) : (
            <button
              key={label}
              type="button"
              title={`Show km ${Math.round(km)} on the map`}
              onClick={() => show(km)}
            >
              <span>{label}</span>
              <b>{formatTemperature(celsius)}</b>
              <small>km {Math.round(km)}</small>
            </button>
          ),
        )}
      </div>
      {stats.freezing > 0 && (
        <div className={styles.note}>
          {Math.max(1, Math.round(stats.freezing * 100))} % of the route below freezing
        </div>
      )}
    </div>
  );
}

/** Date, hour and legend of the temperature overlay, shown while it is on. */
export function TemperatureControl() {
  const model = useTripModel();
  const { climate } = model;
  const on = useTripState((s) => s.temperatureOverlay);
  const date = useTripState((s) => overlayDate(s, model.timeZone));
  const hour = useTripState((s) => s.overlayHour);
  const opacity = useTripState((s) => s.overlayOpacity);
  const update = useTripState((s) => s.update);
  if (!on || !climate) return null;
  return (
    <div className={styles.card} role="group" aria-label="Temperature overlay">
      <div className={styles.row}>
        <b>Typical temperature</b>
        <input
          type="date"
          value={date}
          aria-label="Date"
          onChange={(e) => update({ overlayDate: e.target.value || null })}
        />
        <button
          type="button"
          className={styles.close}
          aria-label="Hide the temperature overlay"
          onClick={() => update({ temperatureOverlay: false })}
        >
          ×
        </button>
      </div>
      <label className={styles.row}>
        <input
          type="range"
          min={0}
          max={23}
          step={1}
          value={hour}
          aria-label="Hour"
          onChange={(e) => update({ overlayHour: Number(e.target.value) })}
        />
        <span className={styles.hour}>{String(hour).padStart(2, '0')}:00</span>
      </label>
      <label className={styles.row}>
        <span className={styles.label}>Opacity</span>
        <input
          type="range"
          min={0.2}
          max={1}
          step={0.1}
          value={opacity}
          aria-label="Overlay opacity"
          onChange={(e) => update({ overlayOpacity: Number(e.target.value) })}
        />
        <span className={styles.hour}>{Math.round(opacity * 100)} %</span>
      </label>
      <div className={styles.scale} style={{ background: temperatureGradient() }} />
      <div className={styles.ticks}>
        {TICKS.map((t) => (
          <span key={t} style={{ left: `${((t - LOW) / (HIGH - LOW)) * 100}%` }}>
            {t < 0 ? `−${-t}` : t}
          </span>
        ))}
      </div>
      <RouteStats date={date} hour={hour} />
      <div className={styles.note}>
        °C, {climate.layer.years.join('–')} averages adjusted for elevation; nights in valleys are often
        colder.
      </div>
    </div>
  );
}
