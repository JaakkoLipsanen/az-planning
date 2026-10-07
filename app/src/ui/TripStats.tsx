import { formatInt } from '../lib/format.ts';
import { usePlan, useTripModel } from '../trip/TripContext.tsx';

import styles from './Header.module.css';

export function TripStats() {
  const { bundle } = useTripModel();
  const plan = usePlan();
  const { distanceKm, climbM, movingHours } = bundle.stats;
  return (
    <span className={styles.stats}>
      <span>
        <b>{formatInt(distanceKm)} km</b>
      </span>
      <span>
        <b>+{formatInt(climbM)} m</b> climbing
      </span>
      <span>
        <b>~{Math.round(movingHours)} h</b> moving
      </span>
      {bundle.plan && (
        <span>
          <b>{plan.count} days</b> · ~{plan.hoursPerDay.toFixed(1)} h/day
        </span>
      )}
    </span>
  );
}
