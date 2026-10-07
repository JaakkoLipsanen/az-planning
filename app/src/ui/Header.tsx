import { useCallback, useState } from 'react';

import { useOffline } from '../offline/OfflineContext.tsx';
import { useTripState } from '../state/tripStore.ts';
import { useTripModel } from '../trip/TripContext.tsx';
import { Search } from './Search.tsx';
import { TripStats } from './TripStats.tsx';

import styles from './Header.module.css';

export function Header() {
  const { bundle } = useTripModel();
  const offline = useOffline();
  const sidebarOpen = useTripState((s) => s.sidebarOpen);
  const setSidebarOpen = useTripState((s) => s.setSidebarOpen);
  const moveCamera = useTripState((s) => s.moveCamera);
  const [searching, setSearching] = useState(false);
  const closeSearch = useCallback(() => setSearching(false), []);
  const showOffline = (): void => {
    setSidebarOpen(true);
    document.getElementById('offline')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <header className={styles.header}>
      <button
        type="button"
        className={styles.menu}
        aria-controls="sidebar"
        aria-expanded={sidebarOpen}
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        Layers
      </button>
      <h1 className={styles.title}>
        {bundle.title} {bundle.subtitle && <small>{bundle.subtitle}</small>}
      </h1>
      <span className={`${styles.desktopOnly} ${styles.statsWrap}`}>
        <TripStats />
      </span>
      <span className={styles.spacer} />
      <button
        type="button"
        className={styles.button}
        aria-expanded={searching}
        onClick={() => setSearching(!searching)}
      >
        Search
      </button>
      {searching && <Search onClose={closeSearch} />}
      {offline.supported && bundle.offline && (
        <button
          type="button"
          className={`${styles.button} ${offline.ready ? styles.ready : ''}`}
          onClick={showOffline}
        >
          {offline.ready ? 'Offline ✓' : 'Offline'}
        </button>
      )}
      <button
        type="button"
        className={styles.button}
        onClick={() => moveCamera({ kind: 'bounds', bounds: bundle.bounds, padding: 20, resetView: true })}
      >
        Fit<span className={styles.desktopOnly}> whole route</span>
      </button>
    </header>
  );
}
