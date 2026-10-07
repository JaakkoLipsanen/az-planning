import { useMemo } from 'react';

import type { LandCategory, Poi, SurfaceIndex } from '#shared/bundle.ts';

import { DayConditionsDetails } from '../climate/DayConditionsInfo.tsx';
import type { PointTemperature } from '../climate/overlay.ts';
import { formatDate } from '../climate/time.ts';
import { ActionButton } from '../components/ActionButton.tsx';
import { Dot, SurfaceBar, SurfaceShares } from '../components/SurfaceBar.tsx';
import { exportDayGpx } from '../gpx/exportGpx.ts';
import {
  formatGrade,
  formatHours,
  formatInt,
  formatTemperature,
  shortLabel,
  truncate,
} from '../lib/format.ts';
import { landOnDay, onDay, type Day, type DayPlan, type Night } from '../plan/dayPlan.ts';
import { dayNotes, weekdayOf } from '../plan/notes.ts';
import { WEEKDAY_NAMES } from '../plan/openingHours.ts';
import { longestWithin } from '../plan/supplies.ts';
import { useSupplies } from '../plan/useSupplies.ts';
import { useTripState } from '../state/tripStore.ts';
import { CATEGORY_COLORS, CATEGORY_LABELS, SURFACE_LABELS, WATER_LABELS } from '../theme.ts';
import { poiKms, type RouteStop, type TripModel } from '../trip/model.ts';
import { useDayConditions, useDayForecast } from '../trip/TripContext.tsx';

import styles from './MapContent.module.css';

export type Selection =
  | { kind: 'poi'; index: number }
  | { kind: 'day'; day: number }
  | { kind: 'night'; index: number }
  | { kind: 'section'; section: number; profileIndex: number | null; surface: SurfaceIndex | null }
  | { kind: 'line'; id: string }
  | { kind: 'land' }
  | { kind: 'temperature' };

/** Off-route distances shorter than this are not worth mentioning. */
const NEAR_ROUTE_M = 200;

function poiMeta(p: Poi): string {
  const kms = poiKms(p);
  const off =
    p.offRouteM !== undefined && p.offRouteM >= NEAR_ROUTE_M
      ? `${(p.offRouteM / 1000).toFixed(1)} km off route`
      : '';
  const where =
    kms.length > 0 ? ` · route km ${kms.join(' and ')}${off ? `, ${off}` : ''}` : off ? ` · ${off}` : '';
  const water = p.water ? ` (${WATER_LABELS[p.water]})` : '';
  return `${CATEGORY_LABELS[p.category]}${water}${where} · ${p.source}`;
}

/** A plan with more than one day, so there are nights to move. */
const hasPlan = (plan: DayPlan): boolean => plan.nights.length > 0;

/** The night nearest to a route km, which "sleep here" moves. */
function nearestNight(plan: DayPlan, km: number): Night | null {
  return plan.nights.reduce<Night | null>(
    (best, n) => (!best || Math.abs(n.km - km) < Math.abs(best.km - km) ? n : best),
    null,
  );
}

function SleepHere({ plan, km, label }: { plan: DayPlan; km: number; label: string }) {
  const pinNight = useTripState((s) => s.pinNight);
  const night = nearestNight(plan, km);
  if (!night) return null;
  return (
    <button
      type="button"
      className={styles.button}
      title={`Moves night ${night.number} here; the days around it are split again`}
      onClick={() => pinNight(night.number, km)}
    >
      {label} (night {night.number})
    </button>
  );
}

function dayStatsLine(day: Day): string {
  return `${Math.round(day.km)} km · +${formatInt(day.climbM)} m · ${formatHours(day.hours)} moving · trail ${day.surfacePct[0]}% / dirt ${day.surfacePct[1]}% / paved ${day.surfacePct[2]}%`;
}

function LandLine({ land }: { land: LandCategory }) {
  return (
    <div className={styles.meta}>
      <Dot color={land.color} square />
      Land: {land.label}
    </div>
  );
}

function PoiPopup({ poi, plan }: { poi: Poi; plan: DayPlan }) {
  const kms = poiKms(poi);
  return (
    <>
      <h3 className={styles.title}>{poi.name}</h3>
      <div className={styles.meta}>
        <Dot color={CATEGORY_COLORS[poi.category]} />
        {poiMeta(poi)}
      </div>
      {poi.description && <p className={styles.text}>{poi.description}</p>}
      {poi.hours && <p className={styles.meta}>Opening hours: {poi.hours}</p>}
      {hasPlan(plan) && kms.length > 0 && (
        <div className={styles.actions}>
          {kms.map((km) => (
            <SleepHere
              key={km}
              plan={plan}
              km={km}
              label={kms.length > 1 ? `Sleep here at km ${Math.round(km)}` : 'Sleep here'}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** Water places on a day with their kind, each once. */
function WaterList({ stops }: { stops: RouteStop[] }) {
  const seen = new Set<number>();
  const unique = stops.filter((s) => !seen.has(s.index) && seen.add(s.index));
  if (unique.length === 0) return null;
  return (
    <ul className={styles.list}>
      {unique.map(({ km, index, poi }) => (
        <li key={index}>
          km {Math.round(km)}: {truncate(poi.name, 44)}
          {poi.category === 'water' ? (poi.water ? ` (${WATER_LABELS[poi.water]})` : '') : ' (shop)'}
          {poi.osm ? ' · OSM' : ''}
        </li>
      ))}
    </ul>
  );
}

function DayPopup({
  model,
  plan,
  day,
  longDayHours,
}: {
  model: TripModel;
  plan: DayPlan;
  day: Day;
  longDayHours: number;
}) {
  const land = day.night?.land;
  const conditions = useDayConditions()?.[day.number - 1];
  const forecast = useDayForecast(day.number);
  const breakPercent = useTripState((s) => s.breakPercent);
  const supplies = useSupplies();
  const notes = dayNotes(model, day, conditions?.date ?? null);
  const shares = useMemo(() => landOnDay(model, day.startKm, day.endKm), [model, day]);
  const water = supplies.waterStops.filter((s) => onDay(s.km, day.startKm, day.endKm));
  const dryKm = longestWithin(supplies.water, day.startKm, day.endKm);
  return (
    <>
      <h3 className={styles.title}>
        Day {day.number} of {plan.count}
      </h3>
      <div className={styles.meta}>
        Route km {day.startKm.toFixed(1)} → {day.endKm.toFixed(1)}
      </div>
      <div className={styles.stats}>
        <b>{Math.round(day.km)} km</b> · <b>+{formatInt(day.climbM)} m</b> · <b>{formatHours(day.hours)}</b>{' '}
        moving
        {day.hours > longDayHours && <span className={styles.warn}> long day</span>}
      </div>
      <SurfaceBar day={day} />
      <div className={styles.meta}>
        <SurfaceShares day={day} /> · {formatInt(day.lowM)}–{formatInt(day.highM)} m
      </div>
      {conditions && (
        <div className={styles.meta}>
          <DayConditionsDetails
            day={day}
            conditions={conditions}
            forecast={forecast}
            breakPercent={breakPercent}
          />
        </div>
      )}
      {notes.notices.map((text) => (
        <p key={text} className={`${styles.meta} ${styles.warn}`}>
          {text}
        </p>
      ))}
      <p className={styles.text}>
        <b>From:</b> {day.from}
        <br />
        <b>To:</b> {day.to}
        {land && <span className={styles.meta}> ({shortLabel(land.label)})</span>}
      </p>
      <p className={styles.meta}>
        {day.resupply.length > 0
          ? `Resupply on the way: ${day.resupply.slice(0, 6).join(', ')}${day.resupply.length > 6 ? ' …' : ''}`
          : 'No resupply points on this day (from the route files).'}
      </p>
      <details className={styles.more}>
        <summary>
          Water: {new Set(water.map((s) => s.index)).size} places
          {dryKm >= 1 && `, longest without ${Math.round(dryKm)} km`}
        </summary>
        <WaterList stops={water} />
      </details>
      {conditions && notes.opening.length > 0 && (
        <details className={styles.more}>
          <summary>Opening hours on {WEEKDAY_NAMES[weekdayOf(conditions.date)]}</summary>
          <ul className={styles.list}>
            {notes.opening.map((o) => (
              <li key={`${o.name}|${o.km}`} className={o.hours === null ? styles.warn : undefined}>
                km {Math.round(o.km)}: {truncate(o.name, 40)} {o.hours ?? 'closed'}
              </li>
            ))}
          </ul>
        </details>
      )}
      {shares.length > 0 && (
        <details className={styles.more}>
          <summary>
            Land: {shortLabel(shares[0].category.label)} {Math.round(shares[0].km)} km
            {shares.length > 1 ? ', …' : ''}
          </summary>
          <ul className={styles.list}>
            {shares.map((s) => (
              <li key={s.category.id}>
                <Dot color={s.category.color} square />
                {s.category.label}: {s.km.toFixed(1)} km
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className={styles.actions}>
        <ActionButton primary run={() => exportDayGpx(model, plan, day)}>
          Download day {day.number} GPX
        </ActionButton>
      </div>
    </>
  );
}

function NightActions({ night }: { night: Night }) {
  const pinNight = useTripState((s) => s.pinNight);
  const restDays = useTripState((s) => s.restDays);
  const toggleRestDay = useTripState((s) => s.toggleRestDay);
  const resting = restDays.includes(night.number);
  return (
    <div className={styles.actions}>
      <button
        type="button"
        className={styles.button}
        onClick={() => pinNight(night.number, night.pinned ? null : night.km)}
      >
        {night.pinned ? 'Let the plan choose' : 'Keep this stop'}
      </button>
      <button
        type="button"
        className={styles.button}
        onClick={() => {
          if (!resting && !night.pinned) pinNight(night.number, night.km);
          toggleRestDay(night.number);
        }}
      >
        {resting ? 'Remove the rest day' : 'Rest day here'}
      </button>
    </div>
  );
}

function NightPopup({ night, plan }: { night: Night; plan: DayPlan }) {
  return (
    <>
      <h3 className={styles.title}>
        Night {night.number}: {night.name}
      </h3>
      <div className={styles.meta}>
        End of day {night.number} of {plan.count} · route km {night.km.toFixed(1)}
        {night.land && ` · land: ${night.land.label}`}
      </div>
      {night.description && <p className={styles.text}>{night.description}</p>}
      <p className={styles.meta}>
        {night.pinned
          ? 'Fixed by you; the days before and after it are split separately.'
          : night.snapped
            ? 'Moved to the nearest campground / lodging / hand-picked stop to an even split of moving time.'
            : 'Even split of moving time; nothing to snap to nearby.'}
      </p>
      <NightActions night={night} />
    </>
  );
}

function SectionPopup({
  model,
  plan,
  selection,
}: {
  model: TripModel;
  plan: DayPlan;
  selection: Extract<Selection, { kind: 'section' }>;
}) {
  const section = model.bundle.sections[selection.section];
  const { profile } = model;
  const i = selection.profileIndex;
  return (
    <>
      <h3 className={styles.title}>{section.name}</h3>
      <div className={styles.meta}>
        Final route section {section.id} · {section.km} km · +{formatInt(section.climbM)} m · ~
        {formatHours(section.movingHours)}
      </div>
      {i !== null && (
        <div className={styles.meta}>
          Here: <b>km {profile.data.km[i].toFixed(1)}</b> · {formatInt(profile.data.ele[i])} m · grade{' '}
          {formatGrade(profile.gradeAt(i))}
        </div>
      )}
      {selection.surface !== null && (
        <div className={styles.meta}>Surface here: {SURFACE_LABELS[selection.surface]} (OpenStreetMap)</div>
      )}
      {i !== null && hasPlan(plan) && (
        <div className={styles.actions}>
          <SleepHere plan={plan} km={profile.data.km[i]} label="End a day here" />
        </div>
      )}
    </>
  );
}

function LinePopup({ model, id }: { model: TripModel; id: string }) {
  const line = model.lines.get(id);
  if (!line) return null;
  return (
    <>
      <h3 className={styles.title}>{line.track.name}</h3>
      <div className={styles.meta}>
        {line.kind === 'source' ? 'Source route (complete track)' : 'Alternative considered'} ·{' '}
        {line.track.km} km · +{formatInt(line.track.climbM)} m
      </div>
      {line.track.note && <p className={styles.text}>{line.track.note}</p>}
    </>
  );
}

function TemperatureLine({ temperature }: { temperature: PointTemperature }) {
  return (
    <div className={styles.meta}>
      Typical <b>{formatTemperature(temperature.celsius)}</b> at {String(temperature.hour).padStart(2, '0')}
      :00 on {formatDate(temperature.date)} · {formatInt(temperature.ele)} m
    </div>
  );
}

export function PopupBody({
  model,
  plan,
  selection,
  land,
  temperature,
}: {
  model: TripModel;
  plan: DayPlan;
  selection: Selection;
  land: LandCategory | null;
  temperature?: PointTemperature;
}) {
  const longDayHours = model.bundle.plan?.longDayHours ?? Infinity;
  const body = (() => {
    switch (selection.kind) {
      case 'poi':
        return <PoiPopup poi={model.pois[selection.index]} plan={plan} />;
      case 'day': {
        const day = plan.days[selection.day - 1];
        return day ? <DayPopup model={model} plan={plan} day={day} longDayHours={longDayHours} /> : null;
      }
      case 'night': {
        const night = plan.nights[selection.index];
        return night ? <NightPopup night={night} plan={plan} /> : null;
      }
      case 'section':
        return <SectionPopup model={model} plan={plan} selection={selection} />;
      case 'line':
        return <LinePopup model={model} id={selection.id} />;
      case 'land':
      case 'temperature':
        return null;
    }
  })();
  const showLand =
    land && (selection.kind === 'land' || selection.kind === 'section' || selection.kind === 'line');
  return (
    <div className={styles.popup}>
      {body}
      {showLand && <LandLine land={land} />}
      {temperature && <TemperatureLine temperature={temperature} />}
    </div>
  );
}

export function PointTooltip({
  model,
  plan,
  selection,
}: {
  model: TripModel;
  plan: DayPlan;
  selection: Selection;
}) {
  if (selection.kind === 'poi') {
    const poi = model.pois[selection.index];
    return (
      <>
        <b className={styles.tipTitle}>{poi.name}</b>
        <div className={styles.tipMeta}>{poiMeta(poi)}</div>
        {poi.description && <div>{truncate(poi.description, 220)}</div>}
      </>
    );
  }
  if (selection.kind === 'day') {
    const day = plan.days[selection.day - 1];
    if (!day) return null;
    return (
      <>
        <b className={styles.tipTitle}>
          Day {day.number} of {plan.count}
        </b>
        <div className={styles.tipMeta}>{dayStatsLine(day)}</div>
        <div>Click for the day&apos;s details and to highlight it.</div>
      </>
    );
  }
  if (selection.kind === 'night') {
    const night = plan.nights[selection.index];
    if (!night) return null;
    return (
      <>
        <b className={styles.tipTitle}>
          Night {night.number}: {night.name}
        </b>
        <div className={styles.tipMeta}>
          End of day {night.number} · route km {night.km.toFixed(1)}
          {night.land && ` · ${shortLabel(night.land.label)}`}
        </div>
        {night.description && <div>{truncate(night.description, 200)}</div>}
      </>
    );
  }
  return null;
}
