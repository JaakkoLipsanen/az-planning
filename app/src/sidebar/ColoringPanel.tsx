import { SURFACES } from '#shared/bundle.ts';

import { formatInt } from '../lib/format.ts';
import { useTripState, type ColorMode } from '../state/tripStore.ts';
import { SURFACE_COLORS, SURFACE_INDICES, SURFACE_LABELS } from '../theme.ts';
import { useTripModel } from '../trip/TripContext.tsx';

import styles from './Sidebar.module.css';

export function ColoringPanel() {
  const { bundle } = useTripModel();
  const colorMode = useTripState((s) => s.colorMode);
  const update = useTripState((s) => s.update);
  const modes: [ColorMode, string][] = [
    ['surface', 'Surface'],
    ['section', 'Section'],
    ...(bundle.plan ? [['day', 'Day'] as [ColorMode, string]] : []),
  ];
  const kinds = [...new Map(Object.values(bundle.kinds).map((k) => [`${k.label}|${k.color}`, k])).values()];
  return (
    <section className={styles.group}>
      <h2 className={styles.groupTitle}>Route colouring</h2>
      <div className={styles.segmented} role="radiogroup" aria-label="Route colouring">
        {modes.map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={colorMode === mode}
            className={colorMode === mode ? styles.segmentOn : ''}
            onClick={() => update({ colorMode: mode })}
          >
            {label}
          </button>
        ))}
      </div>
      {colorMode === 'surface' && (
        <div className={styles.legend}>
          {SURFACE_INDICES.map((s) => (
            <span key={s} className={styles.legendRow}>
              <i style={{ background: SURFACE_COLORS[s] }} />
              <span>{SURFACE_LABELS[s]}</span>
              <span className={styles.detail}>
                {bundle.surfaceTotalsKm ? `${formatInt(bundle.surfaceTotalsKm[SURFACES[s]])} km` : ''}
              </span>
            </span>
          ))}
        </div>
      )}
      {colorMode === 'section' && (
        <div className={styles.legend}>
          {kinds.map((k) => (
            <span key={`${k.label}|${k.color}`} className={styles.legendRow}>
              <i style={{ background: k.color }} />
              <span>{k.label}</span>
            </span>
          ))}
        </div>
      )}
      <p className={styles.note}>
        Surface from OpenStreetMap (path = singletrack, track / unpaved = unpaved road, other roads = paved;
        unmapped bits inherit the section type). Day colours alternate per riding day of the day plan below.
      </p>
    </section>
  );
}
