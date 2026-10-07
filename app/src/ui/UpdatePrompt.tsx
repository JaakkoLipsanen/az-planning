import { useRegisterSW } from 'virtual:pwa-register/react';

import styles from './UpdatePrompt.module.css';

/** Registers the service worker and offers a reload when a new version of the app is installed. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className={styles.toast} role="status">
      A new version of the map is ready.
      <button type="button" onClick={() => void updateServiceWorker(true)}>
        Reload
      </button>
    </div>
  );
}
