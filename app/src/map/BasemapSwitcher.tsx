import { useEffect, useRef, useState } from 'react';

import { TILE_SOURCES, type TileSourceId } from '#shared/basemaps.ts';
import { tileAt } from '#shared/tiles.ts';

import { shortLabel } from '../lib/format.ts';
import { fetchTileBlob } from '../offline/tileProtocol.ts';
import { MAPBOX_STYLES, usePreferences } from '../state/preferences.ts';
import { useTripState } from '../state/tripStore.ts';
import { useTripModel } from '../trip/TripContext.tsx';

import styles from './BasemapSwitcher.module.css';

const THUMBNAIL_ZOOM = 13;

function useThumbnails(sources: readonly TileSourceId[]): Partial<Record<TileSourceId, string>> {
  const { bundle } = useTripModel();
  const [urls, setUrls] = useState<Partial<Record<TileSourceId, string>>>({});
  useEffect(() => {
    const at = bundle.imagery?.thumbnail ?? {
      lng: (bundle.bounds[0] + bundle.bounds[2]) / 2,
      lat: (bundle.bounds[1] + bundle.bounds[3]) / 2,
    };
    const tile = tileAt(at.lng, at.lat, THUMBNAIL_ZOOM);
    const created: string[] = [];
    let cancelled = false;
    void Promise.all(
      sources
        .filter((id) => TILE_SOURCES[id].kind === 'raster' && id !== 'mapbox')
        .map(async (id) => {
          const blob = await fetchTileBlob(id, tile.z, tile.x, tile.y);
          if (!blob || cancelled) return;
          const url = URL.createObjectURL(blob);
          created.push(url);
          setUrls((prev) => ({ ...prev, [id]: url }));
        }),
    );
    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [bundle, sources]);
  return urls;
}

function Card({
  id,
  thumbnail,
  active,
  onSelect,
}: {
  id: TileSourceId;
  thumbnail?: string;
  active: boolean;
  onSelect: () => void;
}) {
  const source = TILE_SOURCES[id];
  return (
    <button
      type="button"
      className={`${styles.card} ${active ? styles.active : ''} ${thumbnail ? '' : styles[`plain-${source.kind}`]}`}
      style={thumbnail ? { backgroundImage: `url(${thumbnail})` } : undefined}
      title={source.title}
      onClick={onSelect}
    >
      <span className={styles.label}>
        {source.label}
        {!source.offline && <span className={styles.online}> · online</span>}
      </span>
    </button>
  );
}

function MapboxSettings() {
  const token = usePreferences((s) => s.mapboxToken);
  const style = usePreferences((s) => s.mapboxStyle);
  const setMapbox = usePreferences((s) => s.setMapbox);
  return (
    <div className={styles.extra}>
      <div className={styles.row}>
        <input
          type="password"
          className={styles.input}
          placeholder="Mapbox access token (pk.…)"
          defaultValue={token}
          onChange={(e) => setMapbox(e.target.value.trim(), style)}
        />
        <select className={styles.select} value={style} onChange={(e) => setMapbox(token, e.target.value)}>
          {MAPBOX_STYLES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.note}>
        Token from account.mapbox.com (the free tier is plenty for personal use); it is kept only in this
        browser.
      </div>
    </div>
  );
}

function LandOverlay() {
  const { bundle } = useTripModel();
  const land = useTripState((s) => s.land);
  const update = useTripState((s) => s.update);
  const categories = bundle.land?.categories ?? [];
  const checkbox = useRef<HTMLInputElement>(null);
  const some = land.length > 0;
  useEffect(() => {
    if (checkbox.current) checkbox.current.indeterminate = some && land.length < categories.length;
  }, [some, land.length, categories.length]);
  if (categories.length === 0) return null;
  return (
    <>
      <label className={styles.check}>
        <input
          ref={checkbox}
          type="checkbox"
          checked={some}
          onChange={(e) => update({ land: e.target.checked ? categories.map((c) => c.id) : [] })}
        />
        Land ownership
      </label>
      <div className={styles.legend}>
        {categories.map((c) => (
          <span key={c.id}>
            <i style={{ background: c.color }} title={c.label} />
            {shortLabel(c.label)}
          </span>
        ))}
      </div>
    </>
  );
}

function Overlays() {
  const { bundle, climate } = useTripModel();
  const temperature = useTripState((s) => s.temperatureOverlay);
  const update = useTripState((s) => s.update);
  if (!bundle.land && !climate) return null;
  return (
    <div className={styles.overlay}>
      <div className={styles.title}>Overlay</div>
      <LandOverlay />
      {climate && (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={temperature}
            onChange={(e) => update({ temperatureOverlay: e.target.checked })}
          />
          Typical temperature at a date and hour
        </label>
      )}
    </div>
  );
}

export function BasemapSwitcher() {
  const { bundle } = useTripModel();
  const basemap = useTripState((s) => s.basemap);
  const update = useTripState((s) => s.update);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const sources = bundle.imagery?.basemaps ?? [];
  const thumbnails = useThumbnails(sources);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={styles.switcher} ref={root}>
      <Card id={basemap} thumbnail={thumbnails[basemap]} active={false} onSelect={() => setOpen(!open)} />
      {open && (
        <div className={styles.panel} role="dialog" aria-label="Map type">
          <div className={styles.title}>Map type</div>
          <div className={styles.cards}>
            {sources.map((id) => (
              <Card
                key={id}
                id={id}
                thumbnail={thumbnails[id]}
                active={id === basemap}
                onSelect={() => update({ basemap: id })}
              />
            ))}
          </div>
          {basemap === 'mapbox' && <MapboxSettings />}
          <Overlays />
          <div className={styles.note}>
            Maps marked online need a connection; the others can be stored for offline use in the Offline
            panel.
          </div>
        </div>
      )}
    </div>
  );
}
