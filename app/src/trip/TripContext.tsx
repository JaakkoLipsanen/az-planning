import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { TripBundle } from '#shared/bundle.ts';

import { dayConditions, type DayConditions } from '../climate/conditions.ts';
import { useForecasts, type DayForecast } from '../climate/forecast.ts';
import { tripCalendar, type TripCalendar } from '../plan/calendar.ts';
import { computePlan, overnightCandidates, type DayPlan } from '../plan/dayPlan.ts';
import { createTripStore, TripStoreContext, useTripState } from '../state/tripStore.ts';
import { buildTripModel, type TripModel } from './model.ts';

const ModelContext = createContext<TripModel | null>(null);
const PlanContext = createContext<DayPlan | null>(null);
const CalendarContext = createContext<TripCalendar | null>(null);
const ConditionsContext = createContext<DayConditions[] | null>(null);
const ForecastContext = createContext<Map<number, DayForecast>>(new Map());

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

/** Dates of the riding and rest days; null until a start date is chosen. */
export function useCalendar(): TripCalendar | null {
  return useContext(CalendarContext);
}

/** Date, sun times, riding hours and typical weather per day of the plan; null until a start date is chosen. */
export function useDayConditions(): DayConditions[] | null {
  return useContext(ConditionsContext);
}

/** The weather forecast for a day of the plan, when it is within the next week. */
export function useDayForecast(day: number): DayForecast | undefined {
  return useContext(ForecastContext).get(day);
}

function PlanProvider({ model, children }: { model: TripModel; children: ReactNode }) {
  const days = useTripState((s) => s.days);
  const pins = useTripState((s) => s.pinnedNights);
  const startDate = useTripState((s) => s.startDate);
  const restDays = useTripState((s) => s.restDays);
  const startTime = useTripState((s) => s.startTime);
  const breakPercent = useTripState((s) => s.breakPercent);
  const candidates = useMemo(() => overnightCandidates(model), [model]);
  const plan = useMemo(() => computePlan(model, candidates, days, pins), [model, candidates, days, pins]);
  const calendar = useMemo(
    () => (startDate ? tripCalendar(startDate, plan.count, restDays) : null),
    [startDate, plan.count, restDays],
  );
  const conditions = useMemo(
    () => (calendar ? dayConditions(model, plan, calendar, { startTime, breakPercent }) : null),
    [model, plan, calendar, startTime, breakPercent],
  );
  const forecasts = useForecasts(plan, calendar?.dates ?? null, model.timeZone);
  return (
    <PlanContext.Provider value={plan}>
      <CalendarContext.Provider value={calendar}>
        <ConditionsContext.Provider value={conditions}>
          <ForecastContext.Provider value={forecasts}>{children}</ForecastContext.Provider>
        </ConditionsContext.Provider>
      </CalendarContext.Provider>
    </PlanContext.Provider>
  );
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
