import { useEffect, useState } from 'react';

import type { TripIndex } from '#shared/bundle.ts';

import { formatInt } from './lib/format.ts';
import { loadTripIndex } from './trip/loadTrip.ts';
import { Message } from './ui/Message.tsx';

import styles from './TripIndexPage.module.css';

export function TripIndexPage() {
  const [index, setIndex] = useState<TripIndex | string | null>(null);
  useEffect(() => {
    loadTripIndex().then(setIndex, (error: unknown) =>
      setIndex(error instanceof Error ? error.message : String(error)),
    );
  }, []);
  if (index === null) return <Message>Loading…</Message>;
  if (typeof index === 'string') return <Message>{index}</Message>;
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Trips</h1>
      <ul className={styles.list}>
        {index.trips.map((trip) => (
          <li key={trip.slug}>
            <a className={styles.card} href={`/${trip.slug}/`}>
              <b>{trip.title}</b>
              {trip.subtitle && <span>{trip.subtitle}</span>}
              <span className={styles.stats}>
                {formatInt(trip.stats.distanceKm)} km · +{formatInt(trip.stats.climbM)} m · ~
                {Math.round(trip.stats.movingHours)} h moving
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
