import { useEffect, useMemo, useRef, useState } from 'react';

import { boundsOf } from '#shared/geo.ts';

import { truncate } from '../lib/format.ts';
import type { DayPlan } from '../plan/dayPlan.ts';
import { useTripStore, type TripState } from '../state/tripStore.ts';
import { CATEGORY_LABELS } from '../theme.ts';
import { poiKms, type TripModel } from '../trip/model.ts';
import { usePlan, useTripModel } from '../trip/TripContext.tsx';

import styles from './Search.module.css';

const MAX_RESULTS = 12;

interface Result {
  key: string;
  label: string;
  meta: string;
  /** Lower comes first. */
  rank: number;
  go: () => void;
}

type Actions = Pick<TripState, 'setHover' | 'moveCamera' | 'focusOn' | 'selectDay'>;

function kmResult(model: TripModel, query: string, actions: Actions): Result[] {
  const match = /^(?:km\s*)?(\d+(?:[.,]\d+)?)$/i.exec(query.trim());
  if (!match) return [];
  const km = Number(match[1].replace(',', '.'));
  if (km > model.profile.totalKm) return [];
  return [
    {
      key: `km:${km}`,
      label: `Route km ${km}`,
      meta: 'Show this point of the route',
      rank: 0,
      go: () => {
        const index = model.profile.indexAt('km', km);
        const position = model.profile.lngLatAt(index);
        actions.setHover({ profileIndex: index, position, extras: [], dotOnly: true });
        actions.moveCamera({ kind: 'center', center: position, minZoom: 13 });
      },
    },
  ];
}

function search(model: TripModel, plan: DayPlan, query: string, actions: Actions): Result[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return kmResult(model, query, actions);
  const score = (name: string): number | null => {
    const at = name.toLowerCase().indexOf(q);
    return at < 0 ? null : at === 0 ? 0 : 1;
  };
  const results: Result[] = [...kmResult(model, query, actions)];
  model.pois.forEach((poi, index) => {
    const s = score(poi.name);
    if (s === null) return;
    const kms = poiKms(poi);
    results.push({
      key: `poi:${index}`,
      label: poi.name,
      meta: `${CATEGORY_LABELS[poi.category]}${kms.length > 0 ? ` · km ${kms.map(Math.round).join(', ')}` : ''}${poi.osm ? ' · OSM' : ''}`,
      rank: s + (poi.osm ? 2 : 0),
      go: () => actions.focusOn({ kind: 'poi', index }),
    });
  });
  plan.nights.forEach((night, index) => {
    const s = score(night.name);
    if (s === null) return;
    results.push({
      key: `night:${index}`,
      label: `Night ${night.number}: ${night.name}`,
      meta: `Day plan · km ${Math.round(night.km)}`,
      rank: s,
      go: () => actions.focusOn({ kind: 'night', index }),
    });
  });
  const nightMatch = /^night\s*(\d+)$/i.exec(q);
  const nightIndex = nightMatch ? Number(nightMatch[1]) - 1 : -1;
  const numbered = plan.nights[nightIndex];
  if (numbered) {
    results.push({
      key: `night:${nightIndex}`,
      label: `Night ${numbered.number}: ${numbered.name}`,
      meta: `Day plan · km ${Math.round(numbered.km)}`,
      rank: 0,
      go: () => actions.focusOn({ kind: 'night', index: nightIndex }),
    });
  }
  const dayMatch = /^day\s*(\d+)$/i.exec(q);
  const day = dayMatch ? plan.days[Number(dayMatch[1]) - 1] : undefined;
  if (day) {
    results.push({
      key: `day:${day.number}`,
      label: `Day ${day.number}`,
      meta: `km ${Math.round(day.startKm)}–${Math.round(day.endKm)} · ${truncate(day.to, 40)}`,
      rank: 0,
      go: () => {
        actions.selectDay(day.number);
        actions.moveCamera({ kind: 'bounds', bounds: boundsOf(day.coords), maxZoom: 13 });
      },
    });
  }
  model.bundle.sections.forEach((section, index) => {
    const s = score(section.name);
    if (s === null) return;
    results.push({
      key: `section:${index}`,
      label: truncate(section.name, 80),
      meta: `Section ${section.id} · ${section.km} km`,
      rank: s + 1,
      go: () => actions.moveCamera({ kind: 'bounds', bounds: model.sectionBounds[index] }),
    });
  });
  for (const place of model.bundle.basemap?.places ?? []) {
    const s = score(place.name);
    if (s === null) continue;
    results.push({
      key: `place:${place.name}:${place.lat}`,
      label: place.name,
      meta: `Place (${place.kind})`,
      rank: s + 1,
      go: () => actions.moveCamera({ kind: 'center', center: [place.lng, place.lat], minZoom: 12 }),
    });
  }
  return results.toSorted((a, b) => a.rank - b.rank).slice(0, MAX_RESULTS);
}

/** Finds points of interest, nights, days, sections, places and route kms, and shows them on the map. */
export function Search({ onClose }: { onClose: () => void }) {
  const model = useTripModel();
  const plan = usePlan();
  const store = useTripStore();
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => search(model, plan, query, store.getState()), [model, plan, query, store]);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const choose = (result: Result): void => {
    store.getState().setSidebarOpen(false);
    result.go();
    onClose();
  };
  return (
    <div className={styles.panel} role="dialog" aria-label="Search">
      <input
        ref={input}
        type="search"
        value={query}
        placeholder="Place, shop, water, day 7, night 7, km 812…"
        aria-label="Search the trip"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) choose(results[0]);
        }}
      />
      {results.length > 0 && (
        <ul className={styles.results}>
          {results.map((r) => (
            <li key={r.key}>
              <button type="button" onClick={() => choose(r)}>
                <span>{r.label}</span>
                <small>{r.meta}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim().length >= 2 && results.length === 0 && <p className={styles.empty}>Nothing found.</p>}
    </div>
  );
}
