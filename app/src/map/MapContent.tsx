import type { LandCategory, Poi, SurfaceIndex } from '#shared/bundle.ts';

import { ActionButton } from '../components/ActionButton.tsx';
import { Dot, SurfaceBar, SurfaceShares } from '../components/SurfaceBar.tsx';
import { exportDayGpx } from '../gpx/exportGpx.ts';
import { formatGrade, formatHours, formatInt, shortLabel, truncate } from '../lib/format.ts';
import type { Day, DayPlan, Night } from '../plan/dayPlan.ts';
import { CATEGORY_COLORS, CATEGORY_LABELS, SURFACE_LABELS } from '../theme.ts';
import type { TripModel } from '../trip/model.ts';

import styles from './MapContent.module.css';

export type Selection =
  | { kind: 'poi'; index: number }
  | { kind: 'day'; day: number }
  | { kind: 'night'; index: number }
  | { kind: 'section'; section: number; profileIndex: number | null; surface: SurfaceIndex | null }
  | { kind: 'line'; id: string }
  | { kind: 'land' };

function poiMeta(p: Poi): string {
  const where =
    p.km !== undefined
      ? ` · route km ${p.km}`
      : p.offRouteM !== undefined
        ? ` · ${(p.offRouteM / 1000).toFixed(1)} km off route`
        : '';
  return `${CATEGORY_LABELS[p.category]}${where} · ${p.source}`;
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

function PoiPopup({ poi }: { poi: Poi }) {
  return (
    <>
      <h3 className={styles.title}>{poi.name}</h3>
      <div className={styles.meta}>
        <Dot color={CATEGORY_COLORS[poi.category]} />
        {poiMeta(poi)}
      </div>
      {poi.description && <p className={styles.text}>{poi.description}</p>}
    </>
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
      {day.waterPoints > 0 && (
        <p className={styles.meta}>
          {day.waterPoints} water point{day.waterPoints > 1 ? 's' : ''} listed in the route files.
        </p>
      )}
      <div className={styles.actions}>
        <ActionButton primary run={() => exportDayGpx(model, plan, day)}>
          Download day {day.number} GPX
        </ActionButton>
      </div>
    </>
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
        {night.snapped
          ? 'Moved to the nearest campground / lodging / hand-picked stop to an even split of moving time.'
          : 'Even split of moving time; nothing to snap to nearby.'}
      </p>
    </>
  );
}

function SectionPopup({
  model,
  selection,
}: {
  model: TripModel;
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

export function PopupBody({
  model,
  plan,
  selection,
  land,
}: {
  model: TripModel;
  plan: DayPlan;
  selection: Selection;
  land: LandCategory | null;
}) {
  const longDayHours = model.bundle.plan?.longDayHours ?? Infinity;
  const body = (() => {
    switch (selection.kind) {
      case 'poi':
        return <PoiPopup poi={model.pois[selection.index]} />;
      case 'day': {
        const day = plan.days[selection.day - 1];
        return day ? <DayPopup model={model} plan={plan} day={day} longDayHours={longDayHours} /> : null;
      }
      case 'night': {
        const night = plan.nights[selection.index];
        return night ? <NightPopup night={night} plan={plan} /> : null;
      }
      case 'section':
        return <SectionPopup model={model} selection={selection} />;
      case 'line':
        return <LinePopup model={model} id={selection.id} />;
      case 'land':
        return null;
    }
  })();
  const showLand =
    land && (selection.kind === 'land' || selection.kind === 'section' || selection.kind === 'line');
  return (
    <div className={styles.popup}>
      {body}
      {showLand && <LandLine land={land} />}
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
