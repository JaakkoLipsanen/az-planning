import { Marker, type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

import { clamp, type LngLat } from '#shared/geo.ts';

import { formatGrade, formatHours, formatInt, shortName } from '../lib/format.ts';
import { dayProgress } from '../plan/dayPlan.ts';
import { useTripState, type Hover } from '../state/tripStore.ts';
import { usePlan, useTripModel } from '../trip/TripContext.tsx';
import { useMap } from './MapContext.ts';

import styles from './HoverMarker.module.css';

function extraKey(extra: Hover['extras'][number]): string {
  return extra.kind === 'line' ? `line:${extra.name}` : `land:${extra.label}`;
}

function MainRouteLines({ index }: { index: number }) {
  const model = useTripModel();
  const plan = usePlan();
  const { profile, bundle } = model;
  const { data } = profile;
  const km = data.km[index];
  const speed = profile.speedAt(index);
  const progress = bundle.plan ? dayProgress(model, plan, km) : null;
  const section = bundle.sections[data.section[index]];
  return (
    <>
      <b>km {km.toFixed(1)}</b> · {formatInt(data.ele[index])} m · {formatGrade(profile.gradeAt(index))}
      {speed !== null && ` · ~${speed >= 10 ? Math.round(speed) : speed.toFixed(1)} km/h`}
      {progress && (
        <>
          <br />
          <b>
            Day {progress.day.number}: {progress.doneKm.toFixed(1)} / {progress.day.km.toFixed(1)} km,{' '}
            {formatHours(progress.hoursLeft)} remaining
          </b>
        </>
      )}
      {section && (
        <>
          <br />
          <span className={styles.dim}>{shortName(section.name).slice(0, 44)}</span>
        </>
      )}
    </>
  );
}

function Label({ hover }: { hover: Hover }) {
  return (
    <>
      {hover.profileIndex !== null && <MainRouteLines index={hover.profileIndex} />}
      {hover.extras.map((extra) =>
        extra.kind === 'line' ? (
          <span key={extraKey(extra)} className={styles.other}>
            <b>{extra.name}</b> · km {extra.km.toFixed(1)}
            {extra.totalKm ? ` / ${extra.totalKm}` : ''}
            {extra.ele !== null && ` · ${formatInt(extra.ele)} m`}
          </span>
        ) : (
          <span key={extraKey(extra)} className={styles.other}>
            <i className={styles.swatch} style={{ background: extra.color }} />
            {extra.label}
          </span>
        ),
      )}
    </>
  );
}

const GAP_PX = 10;
const MARGIN_PX = 6;

/** Beside the dot where it fits, else below or above it, always inside the map. */
function placeLabel(label: HTMLElement, map: MapLibreMap, position: LngLat): void {
  const { x, y } = map.project(position);
  const { clientWidth: width, clientHeight: height } = map.getContainer();
  const w = label.offsetWidth;
  const h = label.offsetHeight;
  let left: number;
  let top: number;
  if (x + GAP_PX + w <= width - MARGIN_PX || x - GAP_PX - w >= MARGIN_PX) {
    left = x + GAP_PX + w <= width - MARGIN_PX ? GAP_PX : -GAP_PX - w;
    top = clamp(-h / 2, MARGIN_PX - y, height - MARGIN_PX - h - y);
  } else {
    left = clamp(-w / 2, MARGIN_PX - x, width - MARGIN_PX - w - x);
    top = y + GAP_PX + h <= height - MARGIN_PX ? GAP_PX : -GAP_PX - h;
  }
  label.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

export function HoverMarker() {
  const map = useMap();
  const hover = useTripState((s) => s.hover);
  const marker = useMemo(() => new Marker({ element: document.createElement('div'), anchor: 'center' }), []);
  const label = useRef<HTMLDivElement>(null);

  const visible = hover !== null;
  const position = hover?.position;
  useEffect(() => {
    if (position) marker.setLngLat(position);
  }, [marker, position]);
  useEffect(() => {
    if (!visible) return;
    marker.addTo(map);
    return () => void marker.remove();
  }, [map, marker, visible]);
  useLayoutEffect(() => {
    const element = label.current;
    if (!element || !hover) return;
    const place = (): void => placeLabel(element, map, hover.position);
    place();
    map.on('move', place);
    return () => {
      map.off('move', place);
    };
  }, [map, hover]);

  if (!hover) return null;
  return createPortal(
    <div className={styles.wrap}>
      <div className={styles.dot} />
      {!hover.dotOnly && (
        <div className={styles.label} ref={label}>
          <Label hover={hover} />
        </div>
      )}
    </div>,
    marker.getElement(),
  );
}
