import {
  AttributionControl,
  GeolocateControl,
  Map as MapLibreMap,
  NavigationControl,
  prewarm,
  ScaleControl,
  setWorkerUrl,
  type IControl,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { isNarrow } from '../lib/device.ts';
import { registerTileProtocol } from '../offline/tileProtocol.ts';
import { useTripState, useTripStore } from '../state/tripStore.ts';
import { usePlan, useTripModel } from '../trip/TripContext.tsx';
import { dayFeatures } from './dayFeatures.ts';
import { addMapIcons } from './icons.ts';
import { MapContext } from './MapContext.ts';
import { buildStyle } from './style.ts';

import styles from './MapView.module.css';

setWorkerUrl(workerUrl);
prewarm();

/** Expected while offline or when a provider lacks a tile; the protocol already falls back for these. */
const IGNORED_ERRORS = /no elevation tile|Failed to fetch|AbortError/i;

class TerrainControl implements IControl {
  readonly button = document.createElement('button');
  private readonly container = document.createElement('div');

  constructor(onClick: () => void) {
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this.button.type = 'button';
    this.button.className = styles.terrainButton;
    this.button.addEventListener('click', onClick);
    this.container.append(this.button);
  }

  show(on: boolean): void {
    this.button.textContent = on ? '2D' : '3D';
    this.button.classList.toggle(styles.on, on);
    this.button.title = on
      ? 'Back to the flat 2D map'
      : 'Show 3D terrain (tilt with right-drag, Ctrl-drag or two fingers)';
  }

  onAdd(): HTMLElement {
    return this.container;
  }

  onRemove(): void {
    this.container.remove();
  }
}

function useTerrainControl(control: TerrainControl | null): void {
  const terrain3d = useTripState((s) => s.terrain3d);
  useEffect(() => {
    control?.show(terrain3d);
  }, [control, terrain3d]);
}

function supportsWebGL2(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

export function MapView({ children }: { children: ReactNode }) {
  const model = useTripModel();
  const plan = usePlan();
  const store = useTripStore();
  const container = useRef<HTMLDivElement>(null);
  const initialPlan = useRef(plan);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [terrainControl, setTerrainControl] = useState<TerrainControl | null>(null);
  const [webgl] = useState(supportsWebGL2);
  useTerrainControl(terrainControl);

  useEffect(() => {
    if (!container.current || !webgl) return;
    registerTileProtocol();
    const state = store.getState();
    const days = dayFeatures(initialPlan.current, model.bundle.plan?.longDayHours ?? Infinity);
    const instance = new MapLibreMap({
      container: container.current,
      style: buildStyle(model, state, days, state.selectedDay),
      bounds: model.bundle.bounds,
      fitBoundsOptions: { padding: 20 },
      minZoom: 3,
      maxZoom: 17.5,
      maxPitch: 70,
      attributionControl: false,
      fadeDuration: 100,
    });

    const terrainButton = new TerrainControl(() => {
      const { terrain3d, update } = store.getState();
      update({ terrain3d: !terrain3d });
    });
    instance.addControl(new NavigationControl({ visualizePitch: true }), 'top-left');
    instance.addControl(terrainButton, 'top-left');
    const geolocate = new GeolocateControl({
      positionOptions: { enableHighAccuracy: true, maximumAge: 5000, timeout: 30_000 },
      trackUserLocation: true,
      fitBoundsOptions: { maxZoom: 14 },
    });
    instance.addControl(geolocate, 'top-left');
    geolocate.on('geolocate', (e) => {
      const { gps, setGps } = store.getState();
      const snap = model.profile.snap(e.coords.longitude, e.coords.latitude, gps?.km ?? null);
      setGps({
        lng: e.coords.longitude,
        lat: e.coords.latitude,
        accuracyM: e.coords.accuracy,
        km: snap.km,
        offRouteM: snap.offRouteM,
      });
    });
    geolocate.on('error', (e) => {
      const denied =
        e.code === 1
          ? ': permission denied (iPhone: Settings → Privacy → Location Services → Safari Websites / this app)'
          : '';
      store.getState().setGps(null, `Location unavailable${denied}`);
    });
    instance.addControl(new ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');
    const attribution = [model.bundle.attribution, '© OpenStreetMap contributors', 'MapLibre']
      .filter(Boolean)
      .join(' · ');
    instance.addControl(
      new AttributionControl({ compact: isNarrow(), customAttribution: attribution }),
      'bottom-right',
    );
    instance.on('error', (e) => {
      const message = e.error?.message ?? '';
      if (message && !IGNORED_ERRORS.test(message)) console.warn('map error:', message);
    });
    let disposed = false;
    const iconsAdded = addMapIcons(instance).catch((error: unknown) => {
      if (!disposed) console.warn('map icons:', error);
    });
    if (import.meta.env.DEV) Object.assign(window, { map: instance });
    let idleCount = 0;
    const markBusy = (): void => {
      instance.getContainer().dataset.busy = 'true';
    };
    instance.on('movestart', markBusy);
    instance.on('dataloading', markBusy);
    instance.on('idle', () => {
      const element = instance.getContainer();
      delete element.dataset.busy;
      element.dataset.idleCount = String(++idleCount);
    });
    instance.once('load', () => {
      if (!isNarrow()) return;
      for (const el of instance.getContainer().querySelectorAll('.maplibregl-compact-show'))
        el.classList.remove('maplibregl-compact-show');
    });
    instance.once('style.load', () => {
      void iconsAdded.then(() => {
        if (disposed) return;
        instance.fitBounds(model.bundle.bounds, { padding: 20, duration: 0 });
        setTerrainControl(terrainButton);
        setMap(instance);
      });
    });
    return () => {
      disposed = true;
      setMap(null);
      setTerrainControl(null);
      instance.remove();
    };
  }, [model, store, webgl]);

  return (
    <div className={styles.wrap}>
      <div className={styles.map} ref={container} data-testid="map" />
      {!map && webgl && <div className={styles.loading}>Loading map…</div>}
      {!webgl && (
        <div className={styles.error}>This browser cannot draw the map (WebGL 2 is not available).</div>
      )}
      {map && <MapContext.Provider value={map}>{children}</MapContext.Provider>}
    </div>
  );
}
