import { Fragment, useEffect } from 'react';

import { boundsOf } from '#shared/geo.ts';

import type { DayConditions } from '../climate/conditions.ts';
import { DayConditionsSummary } from '../climate/DayConditionsInfo.tsx';
import { formatDate } from '../climate/time.ts';
import { ActionButton } from '../components/ActionButton.tsx';
import { SurfaceBar, SurfaceShares } from '../components/SurfaceBar.tsx';
import { exportAllDaysGpx, exportRouteGpx } from '../gpx/exportGpx.ts';
import { formatHours, formatInt, shortLabel, truncate } from '../lib/format.ts';
import type { RestDay } from '../plan/calendar.ts';
import { onDay, usablePins, type Day, type Night } from '../plan/dayPlan.ts';
import { closedText, dayNotes } from '../plan/notes.ts';
import { longestWithin } from '../plan/supplies.ts';
import { useSupplies } from '../plan/useSupplies.ts';
import { useTripState } from '../state/tripStore.ts';
import { dayColor } from '../theme.ts';
import {
  useCalendar,
  useDayConditions,
  useDayForecast,
  usePlan,
  useTripModel,
} from '../trip/TripContext.tsx';

import styles from './Sidebar.module.css';

const BREAK_CHOICES = [0, 10, 15, 20, 25, 30, 40, 50, 75, 100];

interface DaySupply {
  waterPlaces: number;
  dryKm: number;
}

function DayCard({
  day,
  last,
  selected,
  longDayHours,
  conditions,
  supply,
  onSelect,
}: {
  day: Day;
  last: boolean;
  selected: boolean;
  longDayHours: number;
  conditions: DayConditions | undefined;
  supply: DaySupply;
  onSelect: () => void;
}) {
  const model = useTripModel();
  const forecast = useDayForecast(day.number);
  const night = day.night;
  const notes = dayNotes(model, day, conditions?.date ?? null);
  const closed = conditions ? closedText(notes.opening, conditions.date) : null;
  const to = last
    ? `Finish: ${model.bundle.plan?.finish ?? ''}`
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
      <div className={styles.dayTo}>
        → {to}
        {night?.pinned && <span className={styles.pinned}> · your stop</span>}
      </div>
      {conditions && (
        <div className={styles.dayMeta}>
          <DayConditionsSummary conditions={conditions} forecast={forecast} />
        </div>
      )}
      <div className={styles.dayMeta}>
        Water: {supply.waterPlaces} place{supply.waterPlaces === 1 ? '' : 's'}
        {supply.dryKm >= 1 && ` · longest without ${Math.round(supply.dryKm)} km`}
      </div>
      {day.resupply.length > 0 && (
        <div className={styles.dayMeta}>
          Resupply: {day.resupply.slice(0, 3).join(', ')}
          {day.resupply.length > 3 && ` +${day.resupply.length - 3}`}
        </div>
      )}
      {notes.notices.map((text) => (
        <div key={text} className={`${styles.dayMeta} ${styles.notice}`} title={text}>
          {text}
        </div>
      ))}
      {closed && (
        <div className={`${styles.dayMeta} ${styles.notice}`} title={closed}>
          {closed}
        </div>
      )}
    </button>
  );
}

function RestDayRow({ rest, night }: { rest: RestDay; night: Night | undefined }) {
  const toggleRestDay = useTripState((s) => s.toggleRestDay);
  return (
    <div className={styles.restDay} role="listitem">
      <span>
        <b>Rest day</b> · {formatDate(rest.date)}
        {night && ` · ${truncate(night.name, 48)}`}
      </span>
      <button type="button" onClick={() => toggleRestDay(rest.night)}>
        Remove
      </button>
    </div>
  );
}

/** When riding starts each day and how long the breaks are, for the daily riding hours. */
function RideSettings() {
  const startTime = useTripState((s) => s.startTime);
  const breakPercent = useTripState((s) => s.breakPercent);
  const update = useTripState((s) => s.update);
  return (
    <>
      <div className={styles.rideRow}>
        <label>
          Start riding
          <input
            type="time"
            value={startTime ?? ''}
            aria-label="Start riding at (empty for sunrise)"
            onChange={(e) => update({ startTime: e.target.value || null })}
          />
        </label>
        <label>
          Breaks
          <select
            value={breakPercent}
            aria-label="Breaks as a share of the moving time"
            onChange={(e) => update({ breakPercent: Number(e.target.value) })}
          >
            {BREAK_CHOICES.map((v) => (
              <option key={v} value={v}>
                +{v} %
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className={styles.note}>
        {startTime ? '' : 'Days start at sunrise. '}Breaks are added to the moving time to estimate when each
        day ends.
      </p>
    </>
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
  const model = useTripModel();
  const { bundle, profile } = model;
  const plan = usePlan();
  const calendar = useCalendar();
  const conditions = useDayConditions();
  const supplies = useSupplies();
  const settings = bundle.plan;
  const days = useTripState((s) => s.days);
  const startDate = useTripState((s) => s.startDate);
  const pins = useTripState((s) => s.pinnedNights);
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
  const supplyOn = (day: Day): DaySupply => ({
    waterPlaces: new Set(
      supplies.waterStops.filter((s) => onDay(s.km, day.startKm, day.endKm)).map((s) => s.index),
    ).size,
    dryKm: longestWithin(supplies.water, day.startKm, day.endKm),
  });
  const longDays = plan.days.filter((d) => d.hours > settings.longDayHours).length;
  const fixed = usablePins(pins, plan.count, profile.totalKm).length;
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
      {pins.length > 0 && (
        <div className={styles.daysSummary}>
          {fixed} night{fixed === 1 ? '' : 's'} fixed by you
          {fixed < pins.length && ` (${pins.length - fixed} do not fit ${days} days)`} ·{' '}
          <button type="button" className={styles.link} onClick={() => update({ pinnedNights: [] })}>
            let the plan choose all
          </button>
        </div>
      )}
      <label className={styles.startRow}>
        <span>Start date</span>
        <input
          type="date"
          value={startDate ?? ''}
          onChange={(e) => update({ startDate: e.target.value || null })}
        />
      </label>
      {calendar ? (
        <>
          <div className={styles.daysSummary}>
            Finish <b>{formatDate(calendar.end)}</b>: {plan.count} riding days
            {calendar.rests.length > 0 &&
              ` + ${calendar.rests.length} rest day${calendar.rests.length > 1 ? 's' : ''}`}
          </div>
          <RideSettings />
        </>
      ) : (
        <p className={styles.note}>
          Pick a start date to see dates, daylight, riding hours and typical weather for every day.
        </p>
      )}
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
        {plan.days.map((day) => {
          const rest = calendar?.rests.find((r) => r.night === day.number);
          return (
            <Fragment key={day.number}>
              <DayCard
                day={day}
                last={day.number === plan.count}
                selected={day.number === selectedDay}
                longDayHours={settings.longDayHours}
                conditions={conditions?.[day.number - 1]}
                supply={supplyOn(day)}
                onSelect={() => choose(day)}
              />
              {rest && <RestDayRow rest={rest} night={day.night ?? undefined} />}
            </Fragment>
          );
        })}
      </div>
      <p className={styles.note}>
        Days are cut at equal moving time, then each night is moved to the nearest campground, lodging or
        hand-picked stop within ±15 % of a day (otherwise it is an own-choice spot; the popup shows the land
        owner). Fix a night or add a rest day from its popup on the map. {settings.note}
      </p>
      {startDate && (
        <p className={styles.note}>
          Light runs from civil dawn to civil dusk, when the sun is less than 6° below the horizon: usually
          enough to ride open ground without a lamp, though under trees, in canyons or under cloud it gets
          dark sooner. Weather is typical for the date, not a forecast; days within the next week also show
          the National Weather Service forecast.
        </p>
      )}
    </section>
  );
}
