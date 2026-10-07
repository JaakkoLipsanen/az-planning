import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

import styles from './UpdatePrompt.module.css';

/** How often an open app looks for a new version, and the least time between two looks. */
const CHECK_EVERY_MS = 60 * 60_000;
const MIN_GAP_MS = 60_000;

/**
 * Looks for a new version whenever the app comes back to the foreground, and every hour while it is open.
 * Home-screen apps on iOS resume without reloading, so the browser's own check on page load rarely runs.
 */
function useUpdateChecks(registration: ServiceWorkerRegistration | null): void {
  useEffect(() => {
    if (!registration) return;
    let last = Date.now();
    const check = (): void => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      if (Date.now() - last < MIN_GAP_MS) return;
      last = Date.now();
      registration.update().catch(() => undefined);
    };
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [registration]);
}

/** Registers the service worker and offers a reload when a new version of the app is installed. */
export function UpdatePrompt() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({ onRegisteredSW: (_url, r) => setRegistration(r ?? null) });
  useUpdateChecks(registration);
  if (!needRefresh) return null;
  const reload = (): void => {
    // The plugin reloads only for updates it found while registering, not for later checks.
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
      once: true,
    });
    void updateServiceWorker(true);
  };
  return (
    <div className={styles.toast} role="status">
      A new version of the map is ready.
      <button type="button" onClick={reload}>
        Reload
      </button>
    </div>
  );
}
