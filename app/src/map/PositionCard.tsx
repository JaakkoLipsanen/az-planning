import { formatHours, formatInt, truncate } from '../lib/format.ts';
import { dayProgress } from '../plan/dayPlan.ts';
import { useTripState } from '../state/tripStore.ts';
import { usePlan, useTripModel } from '../trip/TripContext.tsx';
import { useMap } from './MapContext.ts';

import styles from './PositionCard.module.css';

const OFF_ROUTE_WARNING_M = 250;

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
  const { day, doneKm, hoursLeft } = dayProgress(model, plan, gps.km);
  const next = day.night ? `Night ${day.number}: ${day.night.name}` : `Finish: ${bundle.plan?.finish ?? ''}`;
  const off =
    gps.offRouteM >= 1000 ? `${(gps.offRouteM / 1000).toFixed(1)} km` : `${Math.round(gps.offRouteM)} m`;
  return (
    <div
      className={styles.card}
      role="button"
      tabIndex={0}
      onClick={() => map.easeTo({ center: [gps.lng, gps.lat], zoom: Math.max(map.getZoom(), 13) })}
    >
      {close}
      {gps.offRouteM > OFF_ROUTE_WARNING_M && (
        <div className={styles.warn}>{off} off the route - nearest point below</div>
      )}
      <b>Route km {gps.km.toFixed(1)}</b> of {profile.totalKm.toFixed(0)} ·{' '}
      {formatInt(profile.interpolate('km', gps.km, 'ele'))} m
      {gps.accuracyM !== null && <span className={styles.meta}> · GPS ±{Math.round(gps.accuracyM)} m</span>}
      {bundle.plan ? (
        <>
          <div>
            <b>Day {day.number}</b> of {plan.count}: {doneKm.toFixed(1)} / {day.km.toFixed(1)} km ·{' '}
            {formatHours(hoursLeft)} remaining
          </div>
          <div className={styles.meta}>
            → {truncate(next, 70)} ({Math.max(0, day.endKm - gps.km).toFixed(1)} km)
          </div>
        </>
      ) : (
        <div className={styles.meta}>
          {formatHours(hoursLeft)} moving to the finish ({(profile.totalKm - gps.km).toFixed(1)} km)
        </div>
      )}
    </div>
  );
}
