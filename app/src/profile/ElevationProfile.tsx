import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

import { temperatureAlongRoute } from '../climate/conditions.ts';
import { TOUCH } from '../lib/device.ts';
import { formatGrade, formatHours, formatInt, formatTemperatureRange } from '../lib/format.ts';
import { dayProgress } from '../plan/dayPlan.ts';
import { useSupplies } from '../plan/useSupplies.ts';
import { useTripState, useTripStore } from '../state/tripStore.ts';
import {
  CATEGORY_COLORS,
  SURFACE_COLORS,
  SURFACE_INDICES,
  SURFACE_LABELS,
  TEMPERATURE_COLORS,
} from '../theme.ts';
import { GRADE_CLASSES } from '../trip/grade.ts';
import { useCalendar, usePlan, useTripModel } from '../trip/TripContext.tsx';
import {
  daysOfSamples,
  drawProfile,
  profileColors,
  sampleAtX,
  type ProfileColors,
  type ProfileMark,
  type TemperatureSeries,
} from './drawProfile.ts';

import styles from './ElevationProfile.module.css';

/** Keyboard steps along the profile, km (Shift for the larger one). */
const KEY_STEP_KM = 1;
const KEY_STEP_LARGE_KM = 10;
/** Room on each side of a zoomed-in day, as a share of its length. */
const DAY_MARGIN = 0.04;

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
  const calendar = useCalendar();
  const update = useTripState((s) => s.update);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width, height } = useElementSize(canvas);
  const colors = useProfileColors();
  const dayOfSample = useMemo(() => daysOfSamples(model.profile, plan), [model, plan]);
  const hoverIndex = hover?.profileIndex ?? null;
  const canShowTemperature = Boolean(model.climate && model.bundle.plan);
  const temperature = useMemo(
    () => (canShowTemperature && calendar ? temperatureAlongRoute(model, dayOfSample, calendar.dates) : null),
    [model, dayOfSample, calendar, canShowTemperature],
  );
  const showTemperature = mode === 'temperature' && temperature !== null;
  const dayZoom = useTripState((s) => s.profileDayZoom);
  const zoomedDay = dayZoom && selectedDay !== null ? plan.days[selectedDay - 1] : undefined;
  const range = useMemo((): [number, number] => {
    if (!zoomedDay) return [0, model.profile.totalKm];
    const margin = zoomedDay.km * DAY_MARGIN;
    return [
      Math.max(0, zoomedDay.startKm - margin),
      Math.min(model.profile.totalKm, zoomedDay.endKm + margin),
    ];
  }, [zoomedDay, model]);
  const supplies = useSupplies();
  const marks = useMemo(
    (): ProfileMark[] => [
      ...supplies.waterStops
        .filter((s) => s.poi.category === 'water')
        .map((s) => ({ km: s.km, color: CATEGORY_COLORS.water })),
      ...supplies.foodStops.map((s) => ({ km: s.km, color: CATEGORY_COLORS.resupply })),
    ],
    [supplies],
  );

  useEffect(() => {
    if (canvas.current && !collapsed) {
      drawProfile(canvas.current, {
        width,
        height,
        colors,
        bundle: model.bundle,
        profile: model.profile,
        plan,
        range,
        colorMode,
        dayOfSample,
        grades: model.grades,
        marks,
        selectedDay,
        hoverIndex,
        gpsKm,
        temperature: showTemperature ? temperature : null,
      });
    }
  }, [
    model,
    plan,
    range,
    marks,
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
    const index = sampleAtX(model.profile, clientX - rect.left, rect.width, range);
    hoverIndexAt(index);
    return index;
  };
  const hoverIndexAt = (index: number): void => {
    store.getState().setHover({ profileIndex: index, position: model.profile.lngLatAt(index), extras: [] });
  };

  const showOnMap = (index: number): void => {
    const { selectDay, moveCamera } = store.getState();
    if (model.bundle.plan && !zoomedDay) selectDay(dayOfSample[index]);
    moveCamera({ kind: 'center', center: model.profile.lngLatAt(index), minZoom: 12 });
  };
  const onClick = (clientX: number): void => {
    const index = hoverAt(clientX);
    if (index !== null) showOnMap(index);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    const km = model.profile.data.km;
    const current = hoverIndex ?? model.profile.indexAt('km', range[0]);
    const step = e.shiftKey ? KEY_STEP_LARGE_KM : KEY_STEP_KM;
    const moves: Record<string, () => number> = {
      ArrowRight: () => model.profile.indexAt('km', Math.min(range[1], km[current] + step)),
      ArrowLeft: () => model.profile.indexAt('km', Math.max(range[0], km[current] - step)),
      Home: () => model.profile.indexAt('km', range[0]),
      End: () => model.profile.indexAt('km', range[1]),
    };
    if (moves[e.key]) {
      e.preventDefault();
      hoverIndexAt(moves[e.key]());
    } else if (e.key === 'Enter' && hoverIndex !== null) {
      showOnMap(hoverIndex);
    } else if (e.key === 'Escape') {
      store.getState().setHover(null);
    }
  };

  const what =
    mode === 'temperature' ? 'Typical daily low and high on the planned dates' : 'Elevation profile';
  const hint =
    mode === 'temperature' && !startDate
      ? 'Pick a start date in the Day plan panel to see temperatures along the route.'
      : `${what} of the final route. ${TOUCH ? 'Drag along it to locate, tap to zoom there.' : 'Hover to locate, click to zoom there.'}`;
  return (
    <div
      className={`${styles.wrap} ${collapsed ? styles.collapsed : ''} ${canShowTemperature ? styles.withModes : ''} ${selectedDay !== null ? styles.withZoom : ''}`}
    >
      <canvas
        ref={canvas}
        className={styles.canvas}
        data-testid="elevation-profile"
        tabIndex={0}
        aria-label={`${what}. Arrow keys move along the route (Shift for 10 km), Enter shows the point on the map.`}
        onKeyDown={onKeyDown}
        onBlur={() => store.getState().setHover(null)}
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
      {!showTemperature && colorMode === 'grade' && hoverIndex === null && width > 560 && !collapsed && (
        <div className={styles.legend}>
          {GRADE_CLASSES.map((c) => (
            <span key={c.label}>
              <i style={{ background: c.color }} />
              {c.label}
            </span>
          ))}
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
      {selectedDay !== null && !collapsed && (
        <button
          type="button"
          className={styles.zoom}
          aria-label={
            dayZoom ? 'Show the whole route in the profile' : `Show only day ${selectedDay} in the profile`
          }
          onClick={() => update({ profileDayZoom: !dayZoom })}
          data-testid="profile-zoom"
        >
          {dayZoom ? 'All days' : `Day ${selectedDay}`}
        </button>
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
