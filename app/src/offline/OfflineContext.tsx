import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { TripBundle } from '#shared/bundle.ts';

import { useTripState } from '../state/tripStore.ts';
import { useTripModel } from '../trip/TripContext.tsx';
import {
  deleteOffline,
  downloadOffline,
  offlineStatus,
  StorageFullError,
  type DownloadProgress,
  type OfflineStatus,
} from './download.ts';

interface StorageInfo {
  usage: number;
  quota: number | null;
  persisted: boolean | null;
}

interface Offline {
  supported: boolean;
  status: OfflineStatus | null;
  /** Everything selected is stored and the app itself is cached by the service worker. */
  ready: boolean;
  appCached: boolean;
  busy: boolean;
  progress: DownloadProgress | null;
  message: string;
  storage: StorageInfo | null;
  download: () => Promise<void>;
  cancel: () => void;
  remove: () => Promise<void>;
}

const OfflineContext = createContext<Offline | null>(null);

export function useOffline(): Offline {
  const value = useContext(OfflineContext);
  if (!value) throw new Error('useOffline outside OfflineProvider');
  return value;
}

async function storageInfo(): Promise<StorageInfo | null> {
  if (!navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? null, persisted };
}

/** Cache Storage can disappear (private browsing, cleared site data); then nothing counts as stored. */
async function readOfflineState(
  bundle: TripBundle,
): Promise<{ status: OfflineStatus | null; storage: StorageInfo | null }> {
  try {
    const [status, storage] = await Promise.all([offlineStatus(bundle), storageInfo()]);
    return { status, storage };
  } catch {
    return { status: null, storage: null };
  }
}

const PAUSED = 'Paused - press Download to continue where it stopped.';

function downloadMessage(result: DownloadProgress | null, error: unknown, paused: boolean): string {
  if (paused) return PAUSED;
  if (error instanceof StorageFullError) return error.message;
  if (error) return `Download failed: ${error instanceof Error ? error.message : 'unexpected error'}`;
  if (result && result.failed > 0)
    return `${result.failed} tiles failed - press Download again to retry them.`;
  return `Done: ${((result?.bytes ?? 0) / 1e6).toFixed(0)} MB downloaded.`;
}

export function OfflineProvider({ children }: { children: ReactNode }) {
  const { bundle } = useTripModel();
  const selected = useTripState((s) => s.offlinePacks);
  const supported = typeof caches !== 'undefined' && window.isSecureContext;
  const [status, setStatus] = useState<OfflineStatus | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [appCached, setAppCached] = useState(() => Boolean(navigator.serviceWorker?.controller));
  const abort = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const state = await readOfflineState(bundle);
    setStatus(state.status);
    setStorage(state.storage);
  }, [bundle]);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void readOfflineState(bundle).then((state) => {
      if (cancelled) return;
      setStatus(state.status);
      setStorage(state.storage);
    });
    const onController = (): void => setAppCached(Boolean(navigator.serviceWorker?.controller));
    navigator.serviceWorker?.addEventListener('controllerchange', onController);
    // The service worker may have taken over between the first render and this listener.
    onController();
    return () => {
      cancelled = true;
      navigator.serviceWorker?.removeEventListener('controllerchange', onController);
    };
  }, [bundle, supported]);

  const download = useCallback(async () => {
    if (abort.current) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setMessage('');
    let result: DownloadProgress | null = null;
    let failure: unknown = null;
    try {
      result = await downloadOffline(bundle, selected, controller.signal, setProgress);
    } catch (error) {
      failure = error;
    }
    abort.current = null;
    setBusy(false);
    setMessage(downloadMessage(result, failure, controller.signal.aborted));
    await refresh();
  }, [bundle, selected, refresh]);

  const remove = useCallback(async () => {
    await deleteOffline(bundle);
    setProgress(null);
    setMessage('Offline data deleted.');
    await refresh();
  }, [bundle, refresh]);

  const value = useMemo((): Offline => {
    const chosen = status?.packs.filter((p) => selected.includes(p.pack.id)) ?? [];
    const ready =
      Boolean(status?.filesStored) && chosen.length > 0 && chosen.every((p) => p.complete) && appCached;
    return {
      supported,
      status,
      ready,
      appCached,
      busy,
      progress,
      message,
      storage,
      download,
      cancel: () => abort.current?.abort(),
      remove,
    };
  }, [supported, status, selected, appCached, busy, progress, message, storage, download, remove]);

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}
