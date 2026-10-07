import { useEffect, useState } from 'react';

import { formatMegabytes } from '../lib/format.ts';
import { estimatedBytes } from '../offline/download.ts';
import { useOffline } from '../offline/OfflineContext.tsx';
import { useTripState } from '../state/tripStore.ts';
import { useTripModel } from '../trip/TripContext.tsx';

import styles from './Sidebar.module.css';

const IS_IOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function Progress() {
  const { progress, busy } = useOffline();
  if (!progress) return null;
  const pct = progress.totalTiles ? (progress.doneTiles / progress.totalTiles) * 100 : 100;
  const seconds = Math.max(0.5, (progress.updatedAt - progress.startedAt) / 1000);
  const rate = progress.doneTiles / seconds;
  const minutesLeft = rate > 0 ? Math.ceil((progress.totalTiles - progress.doneTiles) / rate / 60) : null;
  return (
    <div className={styles.progress}>
      <div className={styles.bar}>
        <i style={{ width: `${pct.toFixed(1)}%` }} />
      </div>
      <div className={styles.note}>
        {progress.doneTiles.toLocaleString()} of {progress.totalTiles.toLocaleString()} tiles ·{' '}
        {formatMegabytes(progress.bytes)}
        {busy && minutesLeft !== null && progress.doneTiles > 0 && ` · ~${minutesLeft} min left`}
        {progress.failed > 0 && ` · ${progress.failed} failed`}
      </div>
    </div>
  );
}

function DeleteButton() {
  const { busy, remove } = useOffline();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        void remove();
      }}
    >
      {armed ? 'Tap again to delete' : 'Delete offline data'}
    </button>
  );
}

export function OfflinePanel() {
  const { bundle } = useTripModel();
  const offline = useOffline();
  const selected = useTripState((s) => s.offlinePacks);
  const toggle = useTripState((s) => s.toggleInList);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const packs = offline.status?.packs ?? [];
  if (!bundle.offline || packs.length === 0) {
    if (offline.supported) return null;
    return (
      <section className={styles.group} id="offline">
        <h2 className={styles.groupTitle}>Offline</h2>
        <p className={styles.warn}>
          Offline mode needs HTTPS (or localhost) and a browser with Cache Storage.
        </p>
      </section>
    );
  }
  const chosen = packs.filter((p) => selected.includes(p.pack.id));
  const stored = chosen.reduce((sum, p) => sum + p.stored, 0);
  const remaining = estimatedBytes(chosen);
  const total = estimatedBytes(packs.map((p) => ({ ...p, stored: 0 })));
  const tilesComplete = chosen.every((p) => p.complete);
  const statusLine = offline.ready ? (
    <b className={styles.ok}>✓ Ready offline</b>
  ) : tilesComplete && stored > 0 && !offline.status?.filesStored ? (
    <>
      <b>Trip updated</b> · download again to store the new route files
    </>
  ) : stored > 0 ? (
    <>
      <b>Partly downloaded</b> · ~{formatMegabytes(remaining)} to go
    </>
  ) : (
    <>
      <b>Not downloaded yet</b> · ~{formatMegabytes(remaining)} for the selection
    </>
  );
  return (
    <section className={styles.group} id="offline">
      <h2 className={styles.groupTitle}>Offline</h2>
      <div className={styles.offlineStatus}>{statusLine}</div>
      {!offline.appCached && (
        <div className={styles.note}>
          The app itself is not cached yet; that happens in the background in the installed or deployed app.
          Reload once if this stays.
        </div>
      )}
      <div>
        {packs.map(({ pack, stored: count, complete }) => (
          <label key={pack.id} className={styles.item}>
            <input
              type="checkbox"
              checked={selected.includes(pack.id)}
              onChange={(e) => toggle('offlinePacks', pack.id, e.target.checked)}
            />
            <span />
            <span className={styles.name}>{pack.label}</span>
            <span className={styles.detail}>
              {formatMegabytes(pack.estimatedBytes)}
              {complete ? (
                <b className={styles.ok}> ✓</b>
              ) : count > 0 ? (
                ` · ${Math.floor((count / pack.tileCount) * 100)}%`
              ) : (
                ''
              )}
            </span>
          </label>
        ))}
      </div>
      <div className={styles.buttons}>
        <button
          type="button"
          className={styles.primary}
          disabled={offline.busy || !online || (tilesComplete && offline.status?.filesStored)}
          onClick={() => void offline.download()}
        >
          {stored > 0 ? 'Download the rest' : 'Download for offline'}
        </button>
        {offline.busy && (
          <button type="button" onClick={offline.cancel}>
            Pause
          </button>
        )}
        <DeleteButton />
      </div>
      <Progress />
      {offline.message && <div className={styles.note}>{offline.message}</div>}
      {offline.storage && (
        <div className={styles.note}>
          Device storage used by this app: {formatMegabytes(offline.storage.usage)}
          {offline.storage.quota !== null && ` of ${formatMegabytes(offline.storage.quota)} allowed`}
          {offline.storage.persisted === true && ' · kept permanently'}
          {offline.storage.persisted === false &&
            ' · not marked permanent (the browser may clear it when the device runs out of space)'}
        </div>
      )}
      <p className={styles.note}>
        Stores the trip data, GPX files and the chosen map tiles on this device (about{' '}
        {formatMegabytes(total)} for everything). Zoomed-out levels cover a wide area; detail levels stay
        close to the route and the map upscales lower zooms elsewhere. Use Wi-Fi.{' '}
        {IS_IOS &&
          'iPhone: add this page to the Home Screen first (Share → Add to Home Screen), open it from there and download inside that app - it keeps its own storage, separate from Safari. '}
        Test it in airplane mode before you rely on it.
      </p>
    </section>
  );
}
