import { useMemo } from 'react';

import { sunTimes } from '../climate/sun.ts';
import { formatTime, todayIn } from '../climate/time.ts';
import { formatHours, formatInt, truncate } from '../lib/format.ts';
import { dayProgress } from '../plan/dayPlan.ts';
import { tonight } from '../plan/progress.ts';
import { nextStop } from '../plan/supplies.ts';
import { useSupplies } from '../plan/useSupplies.ts';
import { useTripState, type GpsPosition } from '../state/tripStore.ts';
import type { RouteStop } from '../trip/model.ts';
import { useCalendar, usePlan, useTripModel } from '../trip/TripContext.tsx';
import { useMap } from './MapContext.ts';

import styles from './PositionCard.module.css';

const OFF_ROUTE_WARNING_M = 250;
const HOUR_MS = 3_600_000;

function NextStops({ km }: { km: number }) {
  const model = useTripModel();
  const supplies = useSupplies();
  const camps = useMemo(
    () =>
      model.stops.filter(
        (s) =>
          (s.poi.category === 'camp' || s.poi.category === 'lodging') && (supplies.options.osm || !s.poi.osm),
      ),
    [model, supplies.options.osm],
  );
  const rows: [label: string, stop: RouteStop | null][] = [
    ['Water', nextStop(supplies.waterStops, km)],
    ['Resupply', nextStop(supplies.foodStops, km)],
    ['Camp / bed', nextStop(camps, km)],
  ];
  return (
    <div className={styles.next}>
      {rows.map(([label, stop]) =>
        stop ? (
          <div key={label}>
            {label}: <b>{Math.max(0, stop.km - km).toFixed(1)} km</b> (
            {formatHours(Math.max(0, model.profile.hoursAtKm(stop.km) - model.profile.hoursAtKm(km)))}) ·{' '}
            {truncate(stop.poi.name, 34)}
          </div>
        ) : (
          <div key={label} className={styles.meta}>
            {label}: none before the finish
          </div>
        ),
      )}
    </div>
  );
}

/** Tonight's stop: how far, when you get there at the planned pace with breaks, and how that fits the light. */
function Tonight({ gps }: { gps: GpsPosition }) {
  const model = useTripModel();
  const plan = usePlan();
  const calendar = useCalendar();
  const breakPercent = useTripState((s) => s.breakPercent);
  const pinNight = useTripState((s) => s.pinNight);
  const today = todayIn(model.timeZone);
  const night = tonight(plan, calendar, today, gps.km);
  const { day, doneKm, hoursLeft } = dayProgress(model, plan, gps.km);
  const target = night && night.km > gps.km ? night : null;
  const hoursToStop = target
    ? model.profile.hoursAtKm(target.km) - model.profile.hoursAtKm(gps.km)
    : hoursLeft;
  const arrive = gps.at + hoursToStop * (1 + breakPercent / 100) * HOUR_MS;
  const stop = target ?? day.night;
  const dusk = stop ? sunTimes(today, stop.lat, stop.lng).dusk : null;
  const late = dusk !== null && arrive > dusk;
  const name = stop ? `Night ${stop.number}: ${stop.name}` : `Finish: ${model.bundle.plan?.finish ?? ''}`;
  return (
    <>
      <div>
        <b>Day {day.number}</b> of {plan.count}: {doneKm.toFixed(1)} / {day.km.toFixed(1)} km
      </div>
      <div className={styles.meta}>
        → {truncate(name, 60)} ({Math.max(0, (stop?.km ?? model.profile.totalKm) - gps.km).toFixed(1)} km)
      </div>
      <div className={late ? styles.warn : styles.meta}>
        ~{formatHours(hoursToStop)} moving, arrive ~{formatTime(arrive, model.timeZone)}
        {dusk !== null && ` · dusk ${formatTime(dusk, model.timeZone)}`}
      </div>
      {night && (
        <button
          type="button"
          className={styles.action}
          title={`Moves night ${night.number} to this km; the days after it are split again`}
          onClick={(e) => {
            e.stopPropagation();
            pinNight(night.number, gps.km);
          }}
        >
          Sleep here tonight (night {night.number})
        </button>
      )}
    </>
  );
}

export function PositionCard() {
  const map = useMap();
  const model = useTripModel();
  const { profile, bundle } = model;
  const plan = usePlan();
  const gps = useTripState((s) => s.gps);
  const gpsError = useTripState((s) => s.gpsError);
  const setGps = useTripState((s) => s.setGps);
  if (!gps && !gpsError) return null;

  const close = (
    <button
      type="button"
      className={styles.close}
      aria-label="Hide"
      onClick={(e) => {
        e.stopPropagation();
        setGps(null);
      }}
    >
      ×
    </button>
  );
  if (!gps) {
    return (
      <div className={styles.card}>
        {close}
        <span className={styles.warn}>{gpsError}</span>
      </div>
    );
  }
  const off =
    gps.offRouteM >= 1000 ? `${(gps.offRouteM / 1000).toFixed(1)} km` : `${Math.round(gps.offRouteM)} m`;
  const center = (): void => {
    map.easeTo({ center: [gps.lng, gps.lat], zoom: Math.max(map.getZoom(), 13) });
  };
  return (
    <div
      className={styles.card}
      role="button"
      tabIndex={0}
      aria-label="Your position on the route; activate to centre the map on it"
      onClick={center}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        center();
      }}
      data-testid="position-card"
    >
      {close}
      {gps.offRouteM > OFF_ROUTE_WARNING_M && (
        <div className={styles.warn}>{off} off the route - nearest point below</div>
      )}
      <b>Route km {gps.km.toFixed(1)}</b> of {profile.totalKm.toFixed(0)} ·{' '}
      {formatInt(profile.interpolate('km', gps.km, 'ele'))} m
      {gps.accuracyM !== null && <span className={styles.meta}> · GPS ±{Math.round(gps.accuracyM)} m</span>}
      {bundle.plan && plan.count > 1 ? (
        <Tonight gps={gps} />
      ) : (
        <div className={styles.meta}>
          {formatHours(profile.hoursAtKm(profile.totalKm) - profile.hoursAtKm(gps.km))} moving to the finish (
          {(profile.totalKm - gps.km).toFixed(1)} km)
        </div>
      )}
      {bundle.pois && <NextStops km={gps.km} />}
    </div>
  );
}
