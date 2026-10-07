import { useEffect } from 'react';

import { boundsOf } from '#shared/geo.ts';

import { ActionButton } from '../components/ActionButton.tsx';
import { SurfaceBar, SurfaceShares } from '../components/SurfaceBar.tsx';
import { exportAllDaysGpx, exportRouteGpx } from '../gpx/exportGpx.ts';
import { formatHours, formatInt, shortLabel } from '../lib/format.ts';
import type { Day } from '../plan/dayPlan.ts';
import { useTripState } from '../state/tripStore.ts';
import { dayColor } from '../theme.ts';
import { usePlan, useTripModel } from '../trip/TripContext.tsx';

import styles from './Sidebar.module.css';

function DayCard({
  day,
  last,
  selected,
  longDayHours,
  onSelect,
}: {
  day: Day;
  last: boolean;
  selected: boolean;
  longDayHours: number;
  onSelect: () => void;
}) {
  const { bundle } = useTripModel();
  const night = day.night;
  const to = last
    ? `Finish: ${bundle.plan?.finish ?? ''}`
    : night?.snapped
      ? night.name
      : `Own choice near km ${night?.km.toFixed(0)}${night?.land ? ` · ${shortLabel(night.land.label)}` : ''}`;
  return (
    <button
      type="button"
      className={`${styles.dayCard} ${selected ? styles.daySelected : ''}`}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className={styles.dayTop}>
        <span className={styles.dayNumber}>
          <i style={{ background: dayColor(day.number) }} />
          Day {day.number}
        </span>
        <span className={styles.detail}>
          km {day.startKm.toFixed(0)}–{day.endKm.toFixed(0)}
        </span>
      </div>
      <div className={styles.dayStats}>
        <b>{Math.round(day.km)} km</b> · <b>+{formatInt(day.climbM)} m</b> ·{' '}
        <b className={day.hours > longDayHours ? styles.warn : ''}>{formatHours(day.hours)}</b>
      </div>
      <SurfaceBar day={day} />
      <div className={styles.dayMeta}>
        <SurfaceShares day={day} />
      </div>
      <div className={styles.dayTo}>→ {to}</div>
      {day.resupply.length > 0 && (
        <div className={styles.dayMeta}>
          Resupply: {day.resupply.slice(0, 3).join(', ')}
          {day.resupply.length > 3 && ` +${day.resupply.length - 3}`}
        </div>
      )}
    </button>
  );
}

function GpxExport() {
  const model = useTripModel();
  const plan = usePlan();
  if (!model.bundle.files?.gpxFull) return null;
  return (
    <div className={styles.gpx}>
      <div className={styles.sub}>Export GPX</div>
      <div className={styles.buttons}>
        <ActionButton
          title="One track, one segment, all waypoints - best for GPS units"
          run={() => exportRouteGpx(model, 'full')}
        >
          Whole route
        </ActionButton>
        {model.bundle.files.gpxSections && (
          <ActionButton title="One named track per section" run={() => exportRouteGpx(model, 'sections')}>
            By section
          </ActionButton>
        )}
        <ActionButton
          title="One GPX per day of the plan, with that day's waypoints and the night stops"
          run={() => exportAllDaysGpx(model, plan)}
        >
          Each day ({plan.count} files)
        </ActionButton>
      </div>
      <p className={styles.note}>
        Day files follow the day plan: the day&apos;s track (original GPX points), the night stops and the
        waypoints from the route files along that day.
      </p>
    </div>
  );
}

export function DayPlanPanel() {
  const { bundle, profile } = useTripModel();
  const plan = usePlan();
  const settings = bundle.plan;
  const days = useTripState((s) => s.days);
  const dayLabels = useTripState((s) => s.dayLabels);
  const selectedDay = useTripState((s) => s.selectedDay);
  const update = useTripState((s) => s.update);
  const selectDay = useTripState((s) => s.selectDay);
  const moveCamera = useTripState((s) => s.moveCamera);
  const setSidebarOpen = useTripState((s) => s.setSidebarOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') selectDay(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectDay]);

  if (!settings) return null;
  const setDays = (value: number): void => {
    const next = Math.max(settings.minDays, Math.min(settings.maxDays, Math.round(value)));
    if (next !== days) update({ days: next });
    if (selectedDay !== null && selectedDay > next) selectDay(null);
  };
  const choose = (day: Day): void => {
    if (selectedDay === day.number) {
      selectDay(null);
      return;
    }
    selectDay(day.number);
    if (day.coords.length > 0) moveCamera({ kind: 'bounds', bounds: boundsOf(day.coords), maxZoom: 13 });
    setSidebarOpen(false);
  };
  const longDays = plan.days.filter((d) => d.hours > settings.longDayHours).length;
  return (
    <section className={styles.group} id="day-plan">
      <h2 className={styles.groupTitle}>Day plan</h2>
      <div className={styles.daysRow}>
        <button
          type="button"
          className={styles.step}
          aria-label="One day fewer"
          onClick={() => setDays(days - 1)}
        >
          −
        </button>
        <input
          type="range"
          min={settings.minDays}
          max={settings.maxDays}
          step={1}
          value={days}
          aria-label="Number of riding days"
          onChange={(e) => setDays(Number(e.target.value))}
        />
        <button
          type="button"
          className={styles.step}
          aria-label="One day more"
          onClick={() => setDays(days + 1)}
        >
          +
        </button>
        <span className={styles.daysValue}>
          <b>{days}</b> days
        </span>
      </div>
      <div className={styles.daysSummary}>
        ~<b>{formatHours(plan.hoursPerDay)}</b> moving per day on average ·{' '}
        {Math.round(profile.totalKm / days)} km and +{formatInt(profile.totalClimbM / days)} m per day
        {longDays > 0 && (
          <span className={styles.warn}>
            {' '}
            · {longDays} day{longDays > 1 ? 's' : ''} over {settings.longDayHours} h
          </span>
        )}
      </div>
      <label className={styles.item}>
        <input
          type="checkbox"
          checked={dayLabels}
          onChange={(e) => update({ dayLabels: e.target.checked })}
        />
        <span className={`${styles.swatch} ${styles.block}`} style={{ background: '#ffffff' }} />
        <span className={styles.name}>Day labels on the map (from zoom 8)</span>
      </label>
      <GpxExport />
      <div className={styles.dayList} role="list">
        {plan.days.map((day) => (
          <DayCard
            key={day.number}
            day={day}
            last={day.number === plan.count}
            selected={day.number === selectedDay}
            longDayHours={settings.longDayHours}
            onSelect={() => choose(day)}
          />
        ))}
      </div>
      <p className={styles.note}>
        Days are cut at equal moving time, then each night is moved to the nearest campground, lodging or
        hand-picked stop within ±15 % of a day (otherwise it is an own-choice spot; the popup shows the land
        owner). {settings.note}
      </p>
    </section>
  );
}
