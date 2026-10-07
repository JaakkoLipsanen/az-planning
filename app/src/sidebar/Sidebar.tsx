import { useEffect } from 'react';

import { ActionButton } from '../components/ActionButton.tsx';
import { TOUCH } from '../lib/device.ts';
import { clearLinkedSettings, planLink } from '../state/shareLink.ts';
import { defaultSettings, settingsOverrides, useTripState, useTripStore } from '../state/tripStore.ts';
import { useTripModel } from '../trip/TripContext.tsx';
import { TripStats } from '../ui/TripStats.tsx';
import { ChecklistPanel } from './ChecklistPanel.tsx';
import { ColoringPanel } from './ColoringPanel.tsx';
import { DayPlanPanel } from './DayPlanPanel.tsx';
import { LayerGroups } from './LayerGroups.tsx';
import { OfflinePanel } from './OfflinePanel.tsx';
import { SuppliesPanel } from './SuppliesPanel.tsx';

import styles from './Sidebar.module.css';

/** Shown after opening a shared plan link, whose settings are not saved until the user keeps them. */
function LinkBanner() {
  const linkUndo = useTripState((s) => s.linkUndo);
  const closeLink = useTripState((s) => s.closeLink);
  useEffect(() => clearLinkedSettings(), []);
  if (linkUndo === null) return null;
  return (
    <div className={styles.banner} role="status">
      Showing the plan from the link you opened.
      <div className={styles.buttons}>
        <button type="button" className={styles.primary} onClick={() => closeLink(false)}>
          Keep it
        </button>
        <button type="button" onClick={() => closeLink(true)}>
          Back to my settings
        </button>
      </div>
    </div>
  );
}

/** A link with these settings (day count, dates, fixed nights, layers), to open the plan on another device. */
function ShareButton() {
  const { bundle } = useTripModel();
  const store = useTripStore();
  const share = async (): Promise<string> => {
    const url = planLink(settingsOverrides(store.getState(), defaultSettings(bundle)));
    if (TOUCH && navigator.share) {
      try {
        await navigator.share({ title: `${bundle.shortName} plan`, url });
        return '';
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return '';
      }
    }
    await navigator.clipboard.writeText(url);
    return 'Link copied.';
  };
  return (
    <ActionButton title="A link that opens this trip with your plan and layers" run={share}>
      Share plan
    </ActionButton>
  );
}

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
        <LinkBanner />
        <div className={styles.share}>
          <ShareButton />
        </div>
        <div className={styles.mobileStats}>
          <TripStats />
        </div>
        <OfflinePanel />
        <ColoringPanel />
        <DayPlanPanel />
        <SuppliesPanel />
        <ChecklistPanel />
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
