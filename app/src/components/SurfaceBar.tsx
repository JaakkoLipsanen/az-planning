import type { Day } from '../plan/dayPlan.ts';
import { SURFACE_COLORS, SURFACE_INDICES, SURFACE_LABELS, SURFACE_SHORT } from '../theme.ts';

import styles from './SurfaceBar.module.css';

export function SurfaceBar({ day }: { day: Day }) {
  return (
    <div className={styles.bar}>
      {SURFACE_INDICES.map((s) =>
        day.surfacePct[s] ? (
          <i
            key={s}
            style={{ width: `${day.surfacePct[s]}%`, background: SURFACE_COLORS[s] }}
            title={`${SURFACE_LABELS[s]} ${day.surfacePct[s]}% (${day.surfaceKm[s].toFixed(1)} km)`}
          />
        ) : null,
      )}
    </div>
  );
}

export function SurfaceShares({ day }: { day: Day }) {
  return (
    <span className={styles.shares}>
      <span style={{ color: SURFACE_COLORS[0] }}>
        {SURFACE_SHORT[0]} {day.surfacePct[0]}%
      </span>
      {' · '}
      <span style={{ color: SURFACE_COLORS[1] }}>
        {SURFACE_SHORT[1]} {day.surfacePct[1]}%
      </span>
      {' · '}
      <span>
        {SURFACE_SHORT[2]} {day.surfacePct[2]}%
      </span>
    </span>
  );
}

export function Dot({ color, square = false }: { color: string; square?: boolean }) {
  return <i className={square ? styles.square : styles.dot} style={{ background: color }} />;
}
