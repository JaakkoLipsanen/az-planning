import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { TripBundle } from '#shared/bundle.ts';

import { computePlan, overnightCandidates, type DayPlan } from '../plan/dayPlan.ts';
import { createTripStore, TripStoreContext, useTripState } from '../state/tripStore.ts';
import { buildTripModel, type TripModel } from './model.ts';

const ModelContext = createContext<TripModel | null>(null);
const PlanContext = createContext<DayPlan | null>(null);

export function useTripModel(): TripModel {
  const model = useContext(ModelContext);
  if (!model) throw new Error('useTripModel outside TripProvider');
  return model;
}

export function usePlan(): DayPlan {
  const plan = useContext(PlanContext);
  if (!plan) throw new Error('usePlan outside TripProvider');
  return plan;
}

function PlanProvider({ model, children }: { model: TripModel; children: ReactNode }) {
  const days = useTripState((s) => s.days);
  const candidates = useMemo(() => overnightCandidates(model), [model]);
  const plan = useMemo(() => computePlan(model, candidates, days), [model, candidates, days]);
  return <PlanContext.Provider value={plan}>{children}</PlanContext.Provider>;
}

export function TripProvider({ bundle, children }: { bundle: TripBundle; children: ReactNode }) {
  const model = useMemo(() => buildTripModel(bundle), [bundle]);
  const store = useMemo(() => createTripStore(bundle), [bundle]);
  return (
    <ModelContext.Provider value={model}>
      <TripStoreContext.Provider value={store}>
        <PlanProvider model={model}>{children}</PlanProvider>
      </TripStoreContext.Provider>
    </ModelContext.Provider>
  );
}
