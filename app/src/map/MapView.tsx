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

import { temperatureRenderer } from '../climate/temperatureTiles.ts';
import { isNarrow } from '../lib/device.ts';
import { registerTileProtocol, setTileRenderer } from '../offline/tileProtocol.ts';
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

/** A map button that is on or off; `render` sets its label and title for each state. */
class ToggleControl implements IControl {
  readonly button = document.createElement('button');
  private readonly container = document.createElement('div');
  private readonly render: (button: HTMLButtonElement, on: boolean) => void;

  constructor(onClick: () => void, render: (button: HTMLButtonElement, on: boolean) => void) {
    this.render = render;
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this.button.type = 'button';
    this.button.className = styles.toggleButton;
    this.button.addEventListener('click', onClick);
    this.container.append(this.button);
    this.show(false);
  }

  show(on: boolean): void {
    this.button.classList.toggle(styles.on, on);
    this.button.setAttribute('aria-pressed', String(on));
    this.render(this.button, on);
  }

  onAdd(): HTMLElement {
    return this.container;
  }

  onRemove(): void {
    this.container.remove();
  }
}

const RULER_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M2.5 16.5 16.5 2.5l5 5-14 14z"/><path d="M6.5 12.5l2 2M9.5 9.5l2 2M12.5 6.5l2 2"/></svg>';

function terrainControl(onClick: () => void): ToggleControl {
  return new ToggleControl(onClick, (button, on) => {
    button.textContent = on ? '2D' : '3D';
    button.title = on
      ? 'Back to the flat 2D map'
      : 'Show 3D terrain (tilt with right-drag, Ctrl-drag or two fingers)';
  });
}

function measureControl(onClick: () => void): ToggleControl {
  return new ToggleControl(onClick, (button, on) => {
    button.innerHTML = RULER_ICON;
    button.title = on ? 'Stop measuring' : 'Measure distances';
    button.setAttribute('aria-label', button.title);
  });
}

interface Controls {
  terrain: ToggleControl;
  measure: ToggleControl;
}

function useControlStates(controls: Controls | null): void {
  const terrain3d = useTripState((s) => s.terrain3d);
  const measuring = useTripState((s) => s.measure !== null);
  useEffect(() => {
    controls?.terrain.show(terrain3d);
  }, [controls, terrain3d]);
  useEffect(() => {
    controls?.measure.show(measuring);
  }, [controls, measuring]);
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
  const [controls, setControls] = useState<Controls | null>(null);
  const [webgl] = useState(supportsWebGL2);
  useControlStates(controls);

  useEffect(() => {
    if (!container.current || !webgl) return;
    registerTileProtocol();
    if (model.climate) setTileRenderer('temperature', temperatureRenderer(model.climate, model.timeZone));
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

    const buttons: Controls = {
      terrain: terrainControl(() => {
        const { terrain3d, update } = store.getState();
        update({ terrain3d: !terrain3d });
      }),
      measure: measureControl(() => {
        const { measure, setMeasure } = store.getState();
        setMeasure(measure ? null : []);
      }),
    };
    instance.addControl(new NavigationControl({ visualizePitch: true }), 'top-left');
    instance.addControl(buttons.terrain, 'top-left');
    instance.addControl(buttons.measure, 'top-left');
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
        setControls(buttons);
        setMap(instance);
      });
    });
    return () => {
      disposed = true;
      setMap(null);
      setControls(null);
      instance.remove();
      setTileRenderer('temperature', null);
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
