import { TOUCH } from '../lib/device.ts';
import { useTripState } from '../state/tripStore.ts';
import { useTripModel } from '../trip/TripContext.tsx';
import { TripStats } from '../ui/TripStats.tsx';
import { ColoringPanel } from './ColoringPanel.tsx';
import { DayPlanPanel } from './DayPlanPanel.tsx';
import { LayerGroups } from './LayerGroups.tsx';
import { OfflinePanel } from './OfflinePanel.tsx';

import styles from './Sidebar.module.css';

export function Sidebar() {
  const { bundle } = useTripModel();
  const open = useTripState((s) => s.sidebarOpen);
  const customized = useTripState((s) => s.customized);
  const reset = useTripState((s) => s.reset);
  const setSidebarOpen = useTripState((s) => s.setSidebarOpen);
  const moveCamera = useTripState((s) => s.moveCamera);
  return (
    <>
      <aside
        className={`${styles.sidebar} ${open ? styles.open : ''}`}
        id="sidebar"
        aria-label="Layers and day plan"
      >
        <div className={styles.top}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              reset();
              moveCamera({ kind: 'bounds', bounds: bundle.bounds, padding: 20, resetView: true });
            }}
          >
            Reset to defaults
          </button>
          <span className={styles.note}>
            {customized ? 'Showing your last selection' : 'Default selection'}
          </span>
          <button
            type="button"
            className={styles.close}
            aria-label="Close the panel"
            onClick={() => setSidebarOpen(false)}
          >
            ×
          </button>
        </div>
        <div className={styles.mobileStats}>
          <TripStats />
        </div>
        <OfflinePanel />
        <ColoringPanel />
        <DayPlanPanel />
        <LayerGroups />
        <p className={styles.note}>
          {TOUCH
            ? 'Tap the route for details at that point; drag along the elevation profile to see where you are and tap it to zoom the map there.'
            : 'Hover the elevation profile to see where you are; click it to zoom the map there.'}
        </p>
      </aside>
      {open && <div className={styles.backdrop} onClick={() => setSidebarOpen(false)} />}
    </>
  );
}
