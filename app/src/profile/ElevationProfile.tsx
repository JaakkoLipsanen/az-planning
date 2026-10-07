import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { temperatureAlongRoute } from '../climate/conditions.ts';
import { TOUCH } from '../lib/device.ts';
import { formatGrade, formatHours, formatInt, formatTemperatureRange } from '../lib/format.ts';
import { dayProgress } from '../plan/dayPlan.ts';
import { useTripState, useTripStore } from '../state/tripStore.ts';
import { SURFACE_COLORS, SURFACE_INDICES, SURFACE_LABELS, TEMPERATURE_COLORS } from '../theme.ts';
import { usePlan, useTripModel } from '../trip/TripContext.tsx';
import {
  daysOfSamples,
  drawProfile,
  profileColors,
  sampleAtX,
  type ProfileColors,
  type TemperatureSeries,
} from './drawProfile.ts';

import styles from './ElevationProfile.module.css';

/** Theme colours for the canvas, re-read when the system colour scheme changes. */
function useProfileColors(): ProfileColors {
  const [colors, setColors] = useState(profileColors);
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => setColors(profileColors());
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return colors;
}

function useElementSize(element: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = element.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [element]);
  return size;
}

function HoverInfo({ index, temperature }: { index: number; temperature: TemperatureSeries | null }) {
  const model = useTripModel();
  const plan = usePlan();
  const { data } = model.profile;
  const km = data.km[index];
  const speed = model.profile.speedAt(index);
  const progress = model.bundle.plan ? dayProgress(model, plan, km) : null;
  return (
    <>
      <b>km {km.toFixed(1)}</b> · <b>{formatInt(data.ele[index])} m</b> · grade{' '}
      <b>{formatGrade(model.profile.gradeAt(index))}</b>
      {speed !== null && (
        <>
          {' '}
          · est. speed <b>~{speed >= 10 ? Math.round(speed) : speed.toFixed(1)} km/h</b>
        </>
      )}
      {progress && (
        <>
          {' · '}
          <b>
            Day {progress.day.number}: {progress.doneKm.toFixed(1)} / {progress.day.km.toFixed(1)} km,{' '}
            {formatHours(progress.hoursLeft)} remaining
          </b>
        </>
      )}
      {temperature && Number.isFinite(temperature.tMin[index]) && (
        <>
          {' · '}typical <b>{formatTemperatureRange(temperature.tMin[index], temperature.tMax[index])}</b>
        </>
      )}
      {' · '}
      {SURFACE_LABELS[data.surface[index]]}
      {progress && (
        <>
          {' · '}day {progress.day.number} of {plan.count}: {Math.round(progress.day.km)} km, +
          {formatInt(progress.day.climbM)} m, {formatHours(progress.day.hours)}
        </>
      )}
    </>
  );
}

export function ElevationProfile() {
  const model = useTripModel();
  const plan = usePlan();
  const store = useTripStore();
  const colorMode = useTripState((s) => s.colorMode);
  const selectedDay = useTripState((s) => s.selectedDay);
  const hover = useTripState((s) => s.hover);
  const gpsKm = useTripState((s) => s.gps?.km ?? null);
  const collapsed = useTripState((s) => s.profileCollapsed);
  const mode = useTripState((s) => s.profileMode);
  const startDate = useTripState((s) => s.startDate);
  const update = useTripState((s) => s.update);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width, height } = useElementSize(canvas);
  const colors = useProfileColors();
  const dayOfSample = useMemo(() => daysOfSamples(model.profile, plan), [model, plan]);
  const hoverIndex = hover?.profileIndex ?? null;
  const canShowTemperature = Boolean(model.climate && model.bundle.plan);
  const temperature = useMemo(
    () => (canShowTemperature && startDate ? temperatureAlongRoute(model, dayOfSample, startDate) : null),
    [model, dayOfSample, startDate, canShowTemperature],
  );
  const showTemperature = mode === 'temperature' && temperature !== null;

  useEffect(() => {
    if (canvas.current && !collapsed) {
      drawProfile(canvas.current, {
        width,
        height,
        colors,
        bundle: model.bundle,
        profile: model.profile,
        plan,
        colorMode,
        dayOfSample,
        selectedDay,
        hoverIndex,
        gpsKm,
        temperature: showTemperature ? temperature : null,
      });
    }
  }, [
    model,
    plan,
    colorMode,
    dayOfSample,
    selectedDay,
    hoverIndex,
    gpsKm,
    width,
    height,
    colors,
    collapsed,
    showTemperature,
    temperature,
  ]);

  const hoverAt = (clientX: number): number | null => {
    const el = canvas.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const index = sampleAtX(model.profile, clientX - rect.left, rect.width);
    store.getState().setHover({ profileIndex: index, position: model.profile.lngLatAt(index), extras: [] });
    return index;
  };

  const onClick = (clientX: number): void => {
    const index = hoverAt(clientX);
    if (index === null) return;
    const { selectDay, moveCamera } = store.getState();
    if (model.bundle.plan) selectDay(dayOfSample[index]);
    moveCamera({ kind: 'center', center: model.profile.lngLatAt(index), minZoom: 12 });
  };

  const what =
    mode === 'temperature' ? 'Typical daily low and high on the planned dates' : 'Elevation profile';
  const hint =
    mode === 'temperature' && !startDate
      ? 'Pick a start date in the Day plan panel to see temperatures along the route.'
      : `${what} of the final route. ${TOUCH ? 'Drag along it to locate, tap to zoom there.' : 'Hover to locate, click to zoom there.'}`;
  return (
    <div
      className={`${styles.wrap} ${collapsed ? styles.collapsed : ''} ${canShowTemperature ? styles.withModes : ''}`}
    >
      <canvas
        ref={canvas}
        className={styles.canvas}
        data-testid="elevation-profile"
        onMouseMove={(e) => hoverAt(e.clientX)}
        onMouseLeave={() => store.getState().setHover(null)}
        onClick={(e) => onClick(e.clientX)}
        onTouchStart={(e) => hoverAt(e.touches[0].clientX)}
        onTouchMove={(e) => hoverAt(e.touches[0].clientX)}
      />
      <div className={styles.info}>
        {hoverIndex !== null ? <HoverInfo index={hoverIndex} temperature={temperature} /> : hint}
      </div>
      {showTemperature && hoverIndex === null && width > 560 && !collapsed && (
        <div className={styles.legend}>
          <span>
            <i style={{ background: TEMPERATURE_COLORS.high }} />
            Typical high
          </span>
          <span>
            <i style={{ background: TEMPERATURE_COLORS.low }} />
            Typical low
          </span>
        </div>
      )}
      {!showTemperature && colorMode === 'surface' && hoverIndex === null && width > 560 && !collapsed && (
        <div className={styles.legend}>
          {SURFACE_INDICES.map((s) => (
            <span key={s}>
              <i style={{ background: s === 2 ? colors.paved : SURFACE_COLORS[s] }} />
              {SURFACE_LABELS[s]}
            </span>
          ))}
        </div>
      )}
      {canShowTemperature && !collapsed && (
        <div className={styles.modes} role="radiogroup" aria-label="Profile shows">
          {(
            [
              ['elevation', 'm', 'Elevation'],
              ['temperature', '°C', 'Typical temperature'],
            ] as const
          ).map(([value, label, title]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              title={title}
              className={mode === value ? styles.modeOn : undefined}
              onClick={() => update({ profileMode: value })}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className={styles.toggle}
        aria-label={`${collapsed ? 'Expand' : 'Collapse'} the elevation profile`}
        title="Collapse / expand the elevation profile"
        onClick={() => update({ profileCollapsed: !collapsed })}
      >
        {collapsed ? '▴' : '▾'}
      </button>
    </div>
  );
}
