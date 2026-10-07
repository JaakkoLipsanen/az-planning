import { useState, type CSSProperties, type ReactNode } from 'react';

import type { Bounds } from '#shared/geo.ts';

import { useTripState } from '../state/tripStore.ts';
import { SURFACE_COLORS } from '../theme.ts';

import styles from './Sidebar.module.css';

export interface LayerItem {
  id: string;
  name: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  color: string;
  swatch?: 'block' | 'dash' | 'dot' | 'surface';
  detail?: string;
  bounds?: Bounds;
}

export type GroupEntry = LayerItem | { heading: string };

const SURFACE_GRADIENT = `linear-gradient(90deg, ${SURFACE_COLORS[0]} 0 33%, ${SURFACE_COLORS[1]} 33% 66%, ${SURFACE_COLORS[2]} 66%)`;

function swatchStyle(item: LayerItem): CSSProperties {
  return item.swatch === 'surface'
    ? { background: SURFACE_GRADIENT }
    : ({ '--c': item.color } as CSSProperties);
}

function Item({ item }: { item: LayerItem }) {
  const moveCamera = useTripState((s) => s.moveCamera);
  const setSidebarOpen = useTripState((s) => s.setSidebarOpen);
  const zoom = (): void => {
    if (!item.bounds) return;
    moveCamera({ kind: 'bounds', bounds: item.bounds, padding: 30 });
    if (!item.checked) item.onChange(true);
    setSidebarOpen(false);
  };
  return (
    <label className={styles.item}>
      <input type="checkbox" checked={item.checked} onChange={(e) => item.onChange(e.target.checked)} />
      <span
        className={`${styles.swatch} ${styles[item.swatch ?? 'block'] ?? ''}`}
        style={swatchStyle(item)}
      />
      <span className={styles.name}>{item.name}</span>
      <span className={styles.detail}>
        {item.detail}
        {item.bounds && (
          <button
            type="button"
            className={styles.zoom}
            onClick={(e) => {
              e.preventDefault();
              zoom();
            }}
          >
            zoom
          </button>
        )}
      </span>
    </label>
  );
}

export function LayerGroup({
  title,
  entries,
  note,
}: {
  title: string;
  entries: GroupEntry[];
  note?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const items = entries.filter((e): e is LayerItem => 'id' in e);
  const setAll = (on: boolean): void => {
    for (const item of items) if (item.checked !== on) item.onChange(on);
  };
  return (
    <section className={styles.group}>
      <h2 className={styles.groupTitle}>
        <button
          type="button"
          className={styles.collapse}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {title}
        </button>
        <span className={styles.allNone}>
          <button type="button" onClick={() => setAll(true)}>
            all
          </button>
          <button type="button" onClick={() => setAll(false)}>
            none
          </button>
        </span>
      </h2>
      {!collapsed && (
        <div>
          {entries.map((entry) =>
            'heading' in entry ? (
              <div key={`h:${entry.heading}`} className={styles.sub}>
                {entry.heading}
              </div>
            ) : (
              <Item key={entry.id} item={entry} />
            ),
          )}
          {note && <p className={styles.note}>{note}</p>}
        </div>
      )}
    </section>
  );
}
