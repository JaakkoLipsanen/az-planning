import { useEffect } from 'react';

import { TOUCH } from '../lib/device.ts';
import { formatHours, formatInt } from '../lib/format.ts';
import { useTripState } from '../state/tripStore.ts';
import { useTripModel } from '../trip/TripContext.tsx';
import { formatKm, measure } from './measure.ts';

import styles from './MeasurePanel.module.css';

/** Distances between the points clicked while measuring, straight and along the final route. */
export function MeasurePanel() {
  const model = useTripModel();
  const points = useTripState((s) => s.measure);
  const setMeasure = useTripState((s) => s.setMeasure);
  const gps = useTripState((s) => s.gps);

  useEffect(() => {
    if (!points) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMeasure(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [points, setMeasure]);

  if (!points) return null;
  const { segments, totalKm } = measure(model, points);
  const alongRoute = segments.length > 0 && segments.every((s) => s.routeKm !== null);
  const sum = (pick: (s: (typeof segments)[number]) => number | null): number =>
    segments.reduce((total, s) => total + (pick(s) ?? 0), 0);
  const routeTotal = alongRoute ? sum((s) => s.routeKm) : null;
  return (
    <div className={styles.card} role="group" aria-label="Distance measurement">
      <div className={styles.head}>
        <b>Measure</b>
        <span className={styles.total} data-testid="measure-total">
          {segments.length > 0 ? formatKm(totalKm) : ''}
          {routeTotal !== null &&
            ` · ${formatKm(routeTotal)} along the route, +${formatInt(sum((s) => s.climbM))} m, ${formatHours(sum((s) => s.hours))}`}
        </span>
      </div>
      {segments.length === 0 ? (
        <div className={styles.hint}>
          {TOUCH ? 'Tap' : 'Click'} the map to add points.
          {gps && points.length === 0 && (
            <>
              {' '}
              <button
                type="button"
                className={styles.inline}
                onClick={() => setMeasure([[gps.lng, gps.lat]])}
              >
                Start at my position
              </button>
            </>
          )}
        </div>
      ) : (
        <ol className={styles.segments}>
          {segments.map((s, i) => (
            <li key={`${points[i].join()}|${points[i + 1].join()}`}>
              {i + 1}→{i + 2}: <b>{formatKm(s.km)}</b>
              {s.routeKm !== null && (
                <span className={styles.route}>
                  {' '}
                  · {formatKm(s.routeKm)} along the route, +{formatInt(s.climbM ?? 0)} m,{' '}
                  {formatHours(s.hours ?? 0)}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
      <div className={styles.buttons}>
        <button type="button" disabled={points.length === 0} onClick={() => setMeasure(points.slice(0, -1))}>
          Undo
        </button>
        <button type="button" disabled={points.length === 0} onClick={() => setMeasure([])}>
          Clear
        </button>
        <button type="button" className={styles.done} onClick={() => setMeasure(null)}>
          Done
        </button>
      </div>
    </div>
  );
}
