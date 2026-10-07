import { boundsOf, type LngLat } from '#shared/geo.ts';

import { formatHours, truncate } from '../lib/format.ts';
import { litresFor, longest, type Stretch } from '../plan/supplies.ts';
import { useSupplies } from '../plan/useSupplies.ts';
import { useTripState } from '../state/tripStore.ts';
import type { TripModel } from '../trip/model.ts';
import { usePlan, useTripModel } from '../trip/TripContext.tsx';

import styles from './Sidebar.module.css';

const SHOWN = 5;

function endName(stretch: Stretch, end: 'from' | 'to', model: TripModel): string {
  const stop = stretch[end];
  if (stop) return truncate(stop.poi.name, 30);
  return end === 'from' ? (model.bundle.plan?.start ?? 'Start') : (model.bundle.plan?.finish ?? 'Finish');
}

function StretchList({ stretches, describe }: { stretches: Stretch[]; describe: (s: Stretch) => string }) {
  const model = useTripModel();
  const moveCamera = useTripState((s) => s.moveCamera);
  const setSidebarOpen = useTripState((s) => s.setSidebarOpen);
  const show = (s: Stretch): void => {
    const coords: LngLat[] = [];
    for (let km = s.fromKm; km < s.toKm; km += Math.max(0.5, s.km / 40))
      coords.push(model.profile.lngLatAtKm(km));
    coords.push(model.profile.lngLatAtKm(s.toKm));
    moveCamera({ kind: 'bounds', bounds: boundsOf(coords), maxZoom: 13 });
    setSidebarOpen(false);
  };
  return (
    <ol className={styles.stretches}>
      {stretches.map((s) => (
        <li key={s.fromKm}>
          <button type="button" onClick={() => show(s)} title="Show on the map">
            <span>
              <b>{Math.round(s.km)} km</b> · km {Math.round(s.fromKm)}–{Math.round(s.toKm)} · {describe(s)}
            </span>
            <small>
              {endName(s, 'from', model)} → {endName(s, 'to', model)}
            </small>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** The longest stretches without water and without resupply, and what to carry for them. */
export function SuppliesPanel() {
  const model = useTripModel();
  const plan = usePlan();
  const supplies = useSupplies();
  const update = useTripState((s) => s.update);
  if (!model.bundle.pois) return null;
  const { natural, osm } = supplies.options;
  return (
    <section className={styles.group} id="supplies">
      <h2 className={styles.groupTitle}>Water and resupply</h2>
      <label className={`${styles.item} ${styles.plain}`}>
        <input type="checkbox" checked={osm} onChange={(e) => update({ waterOsm: e.target.checked })} />
        <span className={styles.name}>Count OpenStreetMap shops and taps (unverified)</span>
      </label>
      <label className={`${styles.item} ${styles.plain}`}>
        <input
          type="checkbox"
          checked={natural}
          onChange={(e) => update({ waterNatural: e.target.checked })}
        />
        <span className={styles.name}>Count creeks, springs and tanks (may be dry)</span>
      </label>
      <div className={styles.sub}>Longest without water</div>
      <StretchList
        stretches={longest(supplies.water, SHOWN)}
        describe={(s) =>
          `${formatHours(s.hours)} riding${s.nights > 0 ? `, ${s.nights} night${s.nights > 1 ? 's' : ''}` : ''} · carry ~${Math.ceil(litresFor(s) * 2) / 2} l`
        }
      />
      <div className={styles.sub}>Longest without resupply</div>
      <StretchList
        stretches={longest(supplies.food, SHOWN)}
        describe={(s) => `food for ~${(s.hours / plan.hoursPerDay).toFixed(1)} riding days`}
      />
      <p className={styles.note}>
        Shops, cafés and fuel stations count as water. Litres are a rough guide: 0.5 l per hour of riding when
        it is cool, up to 1.25 l in the heat (from the typical high on your dates), and 1.5 l per night.
      </p>
    </section>
  );
}
