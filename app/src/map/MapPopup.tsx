import { Popup, type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { LngLat } from '#shared/geo.ts';

import { isNarrow } from '../lib/device.ts';
import { useMap } from './MapContext.ts';

const MARGIN_PX = 10;

/** How far [start, end] sticks out of [min, max]; negative past min, positive past max. */
function overflow(start: number, end: number, min: number, max: number): number {
  if (start < min) return start - min;
  return end > max ? Math.min(end - max, start - min) : 0;
}

/** Pans the map so the popup lies inside it; MapLibre only picks a side, which is not enough on phones. */
function panIntoView(map: MapLibreMap, element: HTMLElement): void {
  const view = map.getContainer().getBoundingClientRect();
  const box = element.getBoundingClientRect();
  const dx = overflow(box.left, box.right, view.left + MARGIN_PX, view.right - MARGIN_PX);
  const dy = overflow(box.top, box.bottom, view.top + MARGIN_PX, view.bottom - MARGIN_PX);
  if (dx !== 0 || dy !== 0) map.panBy([dx, dy], { duration: 250 });
}

/** A MapLibre popup whose content is rendered by React; map clicks are handled by the parent, not by the popup. */
export function MapPopup({
  lngLat,
  onClose,
  children,
}: {
  lngLat: LngLat;
  onClose: () => void;
  children: ReactNode;
}) {
  const map = useMap();
  const { popup, content } = useMemo(() => {
    const element = document.createElement('div');
    const narrow = isNarrow();
    return {
      content: element,
      popup: new Popup({
        maxWidth: `min(340px, calc(100vw - ${2 * MARGIN_PX}px))`,
        closeButton: true,
        closeOnClick: false,
        ...(narrow ? { anchor: 'bottom' as const } : {}),
      }).setDOMContent(element),
    };
  }, []);

  useEffect(() => {
    popup.on('close', onClose);
    return () => {
      popup.off('close', onClose);
    };
  }, [popup, onClose]);
  useEffect(() => {
    popup.addTo(map);
    const observer = new ResizeObserver(() => panIntoView(map, popup.getElement()));
    observer.observe(content);
    return () => {
      observer.disconnect();
      popup.remove();
    };
  }, [map, popup, content]);
  useEffect(() => {
    popup.setLngLat(lngLat);
    panIntoView(map, popup.getElement());
  }, [map, popup, lngLat]);

  return createPortal(children, content);
}
