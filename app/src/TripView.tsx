import { useEffect, useRef, useState } from 'react';

import type { TripBundle } from '#shared/bundle.ts';
import { boundsOf } from '#shared/geo.ts';

import { TemperatureControl } from './climate/TemperatureControl.tsx';
import { todayIn } from './climate/time.ts';
import { BasemapSwitcher } from './map/BasemapSwitcher.tsx';
import { HoverMarker } from './map/HoverMarker.tsx';
import { MapInteractions } from './map/MapInteractions.tsx';
import { MapView } from './map/MapView.tsx';
import { MeasurePanel } from './map/MeasurePanel.tsx';
import { PositionCard } from './map/PositionCard.tsx';
import { useMapSync } from './map/useMapSync.ts';
import { OfflineProvider } from './offline/OfflineContext.tsx';
import { dayOnDate } from './plan/calendar.ts';
import { ElevationProfile } from './profile/ElevationProfile.tsx';
import { Sidebar } from './sidebar/Sidebar.tsx';
import { useTripStore } from './state/tripStore.ts';
import { loadTrip } from './trip/loadTrip.ts';
import { TripProvider, useCalendar, usePlan, useTripModel } from './trip/TripContext.tsx';
import { Header } from './ui/Header.tsx';
import { Message } from './ui/Message.tsx';

import styles from './TripView.module.css';

/** During the trip the app opens on today's day of the plan. */
function useTodaysDay(): void {
  const model = useTripModel();
  const plan = usePlan();
  const calendar = useCalendar();
  const store = useTripStore();
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    const number = calendar && dayOnDate(calendar, todayIn(model.timeZone));
    const day = number ? plan.days[number - 1] : undefined;
    if (!day || store.getState().selectedDay !== null) return;
    store.getState().selectDay(day.number);
    store.getState().moveCamera({ kind: 'bounds', bounds: boundsOf(day.coords), maxZoom: 13 });
  }, [model, plan, calendar, store]);
}

function MapOverlays() {
  useMapSync();
  useTodaysDay();
  return (
    <>
      <MapInteractions />
      <HoverMarker />
      <BasemapSwitcher />
      <div className={styles.topCards}>
        <PositionCard />
        <TemperatureControl />
      </div>
      <MeasurePanel />
    </>
  );
}

type Loaded = { bundle: TripBundle } | { error: string } | null;

export function TripView({ slug }: { slug: string }) {
  const [loaded, setLoaded] = useState<Loaded>(null);
  useEffect(() => {
    let cancelled = false;
    loadTrip(slug).then(
      (bundle) => {
        if (cancelled) return;
        document.title = `${bundle.title} map`;
        setLoaded({ bundle });
      },
      (error: unknown) =>
        !cancelled && setLoaded({ error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (!loaded) return <Message>Loading route data…</Message>;
  if ('error' in loaded) {
    return (
      <Message>
        {loaded.error} <a href="/">All trips</a>
      </Message>
    );
  }
  return (
    <TripProvider bundle={loaded.bundle}>
      <OfflineProvider>
        <div className={styles.app}>
          <Header />
          <Sidebar />
          <main className={styles.main}>
            <MapView>
              <MapOverlays />
            </MapView>
            <ElevationProfile />
          </main>
        </div>
      </OfflineProvider>
    </TripProvider>
  );
}
