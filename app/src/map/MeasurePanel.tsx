import { useEffect } from 'react';

import { TOUCH } from '../lib/device.ts';
import { useTripState } from '../state/tripStore.ts';
import { useTripModel } from '../trip/TripContext.tsx';
import { formatKm, measure } from './measure.ts';

import styles from './MeasurePanel.module.css';

/** Distances between the points clicked while measuring, straight and along the final route. */
export function MeasurePanel() {
  const model = useTripModel();
  const points = useTripState((s) => s.measure);
  const setMeasure = useTripState((s) => s.setMeasure);

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
  const routeTotal =
    segments.length > 0 && segments.every((s) => s.routeKm !== null)
      ? segments.reduce((sum, s) => sum + (s.routeKm ?? 0), 0)
      : null;
  return (
    <div className={styles.card} role="group" aria-label="Distance measurement">
      <div className={styles.head}>
        <b>Measure</b>
        <span className={styles.total} data-testid="measure-total">
          {segments.length > 0 ? formatKm(totalKm) : ''}
          {routeTotal !== null && ` · ${formatKm(routeTotal)} along the route`}
        </span>
      </div>
      {segments.length === 0 ? (
        <div className={styles.hint}>{TOUCH ? 'Tap' : 'Click'} the map to add points.</div>
      ) : (
        <ol className={styles.segments}>
          {segments.map((s, i) => (
            <li key={`${points[i].join()}|${points[i + 1].join()}`}>
              {i + 1}→{i + 2}: <b>{formatKm(s.km)}</b>
              {s.routeKm !== null && (
                <span className={styles.route}> · {formatKm(s.routeKm)} along the route</span>
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
