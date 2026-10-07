import { useMemo } from 'react';

import { useTripState } from '../state/tripStore.ts';
import type { RouteStop } from '../trip/model.ts';
import { useCalendar, usePlan, useTripModel } from '../trip/TripContext.tsx';
import { resupplyStops, stretchesBetween, waterStops, type Stretch, type SupplyOptions } from './supplies.ts';

export interface Supplies {
  options: SupplyOptions;
  waterStops: RouteStop[];
  foodStops: RouteStop[];
  /** Stretches without water and without resupply, in route order. */
  water: Stretch[];
  food: Stretch[];
}

/** Water and resupply along the route with the user's choice of sources. */
export function useSupplies(): Supplies {
  const model = useTripModel();
  const plan = usePlan();
  const calendar = useCalendar();
  const natural = useTripState((s) => s.waterNatural);
  const osm = useTripState((s) => s.waterOsm);
  return useMemo(() => {
    const options = { natural, osm };
    const water = waterStops(model, options);
    const food = resupplyStops(model, options);
    return {
      options,
      waterStops: water,
      foodStops: food,
      water: stretchesBetween(model, plan, calendar, water),
      food: stretchesBetween(model, plan, calendar, food),
    };
  }, [model, plan, calendar, natural, osm]);
}
