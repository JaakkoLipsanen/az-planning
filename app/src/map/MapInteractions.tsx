import type { MapGeoJSONFeature, Map as MapLibreMap, MapMouseEvent, PointLike } from 'maplibre-gl';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { LandCategory, SurfaceIndex } from '#shared/bundle.ts';
import { clamp, EARTH_CIRCUMFERENCE_M, type LngLat } from '#shared/geo.ts';

import { temperatureHere, type PointTemperature } from '../climate/overlay.ts';
import { TOUCH } from '../lib/device.ts';
import { shortLabel, shortName } from '../lib/format.ts';
import type { DayPlan } from '../plan/dayPlan.ts';
import { useTripStore, type Hover, type HoverExtra, type TripStore } from '../state/tripStore.ts';
import { snapToLine, type TripModel } from '../trip/model.ts';
import { usePlan, useTripModel } from '../trip/TripContext.tsx';
import { LAYERS, OTHER_LINE_LAYERS, POINT_LAYERS } from './layers.ts';
import { PointTooltip, PopupBody, type Selection } from './MapContent.tsx';
import { useMap } from './MapContext.ts';
import { MapPopup } from './MapPopup.tsx';

import styles from './MapInteractions.module.css';

const HOVER_PAD_PX = 8;
const CLICK_PAD_PX = 5;
/** Slack for the distance between the pointer and the nearest profile sample (samples are ~100 m apart). */
const SAMPLE_SLACK_M = 60;

interface Tip {
  x: number;
  y: number;
  selection: Selection;
}

interface PopupState {
  lngLat: LngLat;
  selection: Selection;
  land: LandCategory | null;
  /** The overlay's typical temperature at the clicked point, while the temperature overlay is on. */
  temperature?: PointTemperature;
}

type Point = { x: number; y: number };

function box(point: Point, pad: number): [PointLike, PointLike] {
  return [
    [point.x - pad, point.y - pad],
    [point.x + pad, point.y + pad],
  ];
}

function metersPerPixel(map: MapLibreMap, lat: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
}

function pointSelection(feature: MapGeoJSONFeature): Selection {
  const p = feature.properties;
  if (feature.layer.id === LAYERS.pois) return { kind: 'poi', index: Number(p.index) };
  if (feature.layer.id === LAYERS.dayLabels) return { kind: 'day', day: Number(p.day) };
  return { kind: 'night', index: Number(p.index) };
}

/** Lookups at a pointer position shared by hover and click. */
function probe(map: MapLibreMap, model: TripModel, store: TripStore) {
  return {
    point: (p: Point): MapGeoJSONFeature | null =>
      map.queryRenderedFeatures([p.x, p.y], { layers: POINT_LAYERS })[0] ?? null,
    route: (p: Point, pad: number): MapGeoJSONFeature | null =>
      map.queryRenderedFeatures(box(p, pad), { layers: [LAYERS.route] })[0] ?? null,
    otherLines: (p: Point, pad: number): string[] => [
      ...new Set(
        map
          .queryRenderedFeatures(box(p, pad), { layers: OTHER_LINE_LAYERS })
          .map((f) => String(f.properties.id)),
      ),
    ],
    /** The land category under a position, when the land overlay shows it. */
    land: ([lng, lat]: LngLat): LandCategory | null => {
      const category = model.landAt(lng, lat);
      return category && store.getState().land.includes(category.id) ? category : null;
    },
  };
}

/** What hovering at a map position shows: the final route's profile sample and/or nearby lines and land. */
function hoverAt(map: MapLibreMap, model: TripModel, store: TripStore, e: MapMouseEvent): Hover | null {
  const look = probe(map, model, store);
  const { lng, lat } = e.lngLat;
  const tolerance = HOVER_PAD_PX * metersPerPixel(map, lat) + SAMPLE_SLACK_M;
  const nearest = look.route(e.point, HOVER_PAD_PX) ? model.profile.snap(lng, lat, null) : null;
  const onRoute = nearest !== null && nearest.offRouteM < tolerance;
  const others = look
    .otherLines(e.point, HOVER_PAD_PX)
    .flatMap((id) => {
      const line = model.lines.get(id);
      return line ? [{ line, snap: snapToLine(line, lng, lat) }] : [];
    })
    .filter(({ snap }) => snap.distanceM < tolerance * 1.5);
  if (!onRoute && others.length === 0) return null;
  const extras: HoverExtra[] = others.map(({ line, snap }) => ({
    kind: 'line',
    name: shortName(line.track.name),
    km: snap.km,
    totalKm: line.track.km,
    ele: snap.ele,
  }));
  const land = look.land([lng, lat]);
  if (land) extras.push({ kind: 'land', label: shortLabel(land.label), color: land.color });
  return onRoute
    ? { profileIndex: nearest.index, position: model.profile.lngLatAt(nearest.index), extras }
    : { profileIndex: null, position: others[0].snap.position, extras };
}

/** The popup a click opens, or null to close it. */
function clickAt(
  map: MapLibreMap,
  model: TripModel,
  plan: DayPlan,
  store: TripStore,
  e: MapMouseEvent,
): PopupState | null {
  const look = probe(map, model, store);
  const state = store.getState();
  const at: LngLat = [e.lngLat.lng, e.lngLat.lat];
  const feature = look.point(e.point);
  if (feature) {
    const selection = pointSelection(feature);
    if (selection.kind === 'day') state.selectDay(selection.day);
    const anchor =
      selection.kind === 'poi'
        ? model.pois[selection.index]
        : selection.kind === 'night'
          ? plan.nights[selection.index]
          : null;
    return { lngLat: anchor ? [anchor.lng, anchor.lat] : at, selection, land: null };
  }
  const land = look.land(at);
  const routeFeature = look.route(e.point, 4);
  const lineIds = look.otherLines(e.point, CLICK_PAD_PX);
  if (lineIds.length > 0 && !routeFeature)
    return { lngLat: at, selection: { kind: 'line', id: lineIds[0] }, land };
  if (routeFeature) {
    const { index } = model.profile.snap(at[0], at[1], null);
    let lngLat = at;
    if (TOUCH) {
      lngLat = model.profile.lngLatAt(index);
      state.setHover({ profileIndex: index, position: lngLat, extras: [], dotOnly: true });
    }
    const surface = routeFeature.properties.surface as SurfaceIndex | undefined;
    return {
      lngLat,
      selection: {
        kind: 'section',
        section: Number(routeFeature.properties.section),
        profileIndex: index,
        surface: surface ?? null,
      },
      land,
    };
  }
  if (TOUCH) state.setHover(null);
  return land ? { lngLat: at, selection: { kind: 'land' }, land } : null;
}

function Tooltip({ tip }: { tip: Tip }) {
  const model = useTripModel();
  const plan = usePlan();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el?.parentElement) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const maxX = el.parentElement.clientWidth - width - 6;
    const x = clamp(tip.x + 14 <= maxX ? tip.x + 14 : tip.x - width - 14, 6, maxX);
    const y = tip.y - height - 10 >= 4 ? tip.y - height - 10 : tip.y + 18;
    el.style.transform = `translate(${x}px, ${y}px)`;
  }, [tip]);
  return (
    <div className={styles.tip} ref={ref}>
      <PointTooltip model={model} plan={plan} selection={tip.selection} />
    </div>
  );
}

export function MapInteractions() {
  const map = useMap();
  const model = useTripModel();
  const plan = usePlan();
  const store = useTripStore();
  const [tip, setTip] = useState<Tip | null>(null);
  const [popup, setPopup] = useState<PopupState | null>(null);

  useEffect(() => {
    let frame = 0;
    let lookups = 0;
    const canvas = map.getCanvas();
    /** The overlay's temperature at a point, or null when the overlay is off or has no value there. */
    const temperatureAt = (lngLat: LngLat): Promise<PointTemperature | null> => {
      const state = store.getState();
      return state.temperatureOverlay
        ? temperatureHere(model, state, lngLat, map.getZoom())
        : Promise.resolve(null);
    };
    const setHover = (hover: Hover | null): void => {
      if (hover || store.getState().hover) store.getState().setHover(hover);
    };

    const onMove = (e: MapMouseEvent): void => {
      cancelAnimationFrame(frame);
      if (store.getState().measure) {
        canvas.style.cursor = 'crosshair';
        return;
      }
      frame = requestAnimationFrame(() => {
        const feature = probe(map, model, store).point(e.point);
        if (feature) {
          canvas.style.cursor = 'pointer';
          setTip({ x: e.point.x, y: e.point.y, selection: pointSelection(feature) });
          setHover(null);
          return;
        }
        setTip(null);
        const hover = hoverAt(map, model, store, e);
        canvas.style.cursor = hover ? 'crosshair' : '';
        setHover(hover);
        const lookup = ++lookups;
        const at: LngLat = [e.lngLat.lng, e.lngLat.lat];
        void temperatureAt(at).then((t) => {
          if (!t || lookup !== lookups) return;
          const base = hover ?? { profileIndex: null, position: at, extras: [] };
          const extra: HoverExtra = { kind: 'temperature', celsius: t.celsius, ele: t.ele, hour: t.hour };
          store.getState().setHover({ ...base, extras: [...base.extras, extra] });
        });
      });
    };
    const onOut = (): void => {
      cancelAnimationFrame(frame);
      lookups++;
      setTip(null);
      setHover(null);
    };
    const onClick = (e: MapMouseEvent): void => {
      const { measure: points, setMeasure } = store.getState();
      if (points) {
        setMeasure([...points, [e.lngLat.lng, e.lngLat.lat]]);
        setPopup(null);
        return;
      }
      const next = clickAt(map, model, plan, store, e);
      setPopup(next);
      store.getState().setSidebarOpen(false);
      const at: LngLat = [e.lngLat.lng, e.lngLat.lat];
      void temperatureAt(at).then((temperature) => {
        if (!temperature) return;
        setPopup((current) => {
          if (current === next && next) return { ...next, temperature };
          return current === null && next === null && TOUCH
            ? { lngLat: at, selection: { kind: 'temperature' }, land: null, temperature }
            : current;
        });
      });
    };

    // Phones send a mousemove before every tap, which would add hover labels on top of the tap's popup.
    if (!TOUCH) {
      map.on('mousemove', onMove);
      map.on('mouseout', onOut);
    }
    map.on('click', onClick);
    return () => {
      cancelAnimationFrame(frame);
      map.off('mousemove', onMove);
      map.off('mouseout', onOut);
      map.off('click', onClick);
    };
  }, [map, model, plan, store]);

  const closePopup = useCallback(() => setPopup(null), []);

  return (
    <>
      {tip && <Tooltip tip={tip} />}
      {popup && (
        <MapPopup lngLat={popup.lngLat} onClose={closePopup}>
          <PopupBody
            model={model}
            plan={plan}
            selection={popup.selection}
            land={popup.land}
            temperature={popup.temperature}
          />
        </MapPopup>
      )}
    </>
  );
}
