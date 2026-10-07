import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { TOUCH } from '../lib/device.ts';
import { formatGrade, formatHours, formatInt } from '../lib/format.ts';
import { dayProgress } from '../plan/dayPlan.ts';
import { useTripState, useTripStore } from '../state/tripStore.ts';
import { SURFACE_COLORS, SURFACE_INDICES, SURFACE_LABELS } from '../theme.ts';
import { usePlan, useTripModel } from '../trip/TripContext.tsx';
import { daysOfSamples, drawProfile, profileColors, sampleAtX, type ProfileColors } from './drawProfile.ts';

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

function HoverInfo({ index }: { index: number }) {
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
  const update = useTripState((s) => s.update);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width, height } = useElementSize(canvas);
  const colors = useProfileColors();
  const dayOfSample = useMemo(() => daysOfSamples(model.profile, plan), [model, plan]);
  const hoverIndex = hover?.profileIndex ?? null;

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
      });
    }
  }, [model, plan, colorMode, dayOfSample, selectedDay, hoverIndex, gpsKm, width, height, colors, collapsed]);

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

  const hint = TOUCH
    ? 'Elevation profile of the final route. Drag along it to locate, tap to zoom there.'
    : 'Elevation profile of the final route. Hover to locate, click to zoom there.';
  return (
    <div className={`${styles.wrap} ${collapsed ? styles.collapsed : ''}`}>
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
      <div className={styles.info}>{hoverIndex !== null ? <HoverInfo index={hoverIndex} /> : hint}</div>
      {colorMode === 'surface' && hoverIndex === null && width > 560 && !collapsed && (
        <div className={styles.legend}>
          {SURFACE_INDICES.map((s) => (
            <span key={s}>
              <i style={{ background: s === 2 ? colors.paved : SURFACE_COLORS[s] }} />
              {SURFACE_LABELS[s]}
            </span>
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
