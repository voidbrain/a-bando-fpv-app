import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';

export interface FlightSummary {
  id: string;
  name: string;
  live: boolean;
  /** One-line stats: points, km, duration, top speed. */
  stats: string;
}

export interface FlightState {
  flights: FlightSummary[];
  /** Flight being replayed (the most recently added one unless chosen). */
  activeId: string | null;
  /** Bumps whenever flight data changes in place (live updates, recalibration), to redraw dependent views. */
  revision: number;
}

/**
 * Light-weight, serialisable index of the loaded flights. The heavy flight data (arrays of points and telemetry)
 * lives in FlightService: NgRx freezes state in dev mode, which typed arrays cannot survive.
 */
export const FlightStore = signalStore(
  { providedIn: 'root' },
  withState<FlightState>({ flights: [], activeId: null, revision: 0 }),
  withComputed((s) => ({
    count: computed(() => s.flights().length),
    active: computed(() => s.flights().find((f) => f.id === s.activeId()) ?? null),
  })),
  withMethods((store) => ({
    add: (f: FlightSummary) => patchState(store, (s) => ({ flights: [...s.flights, f], activeId: f.id, revision: s.revision + 1 })),
    clear: () => patchState(store, (s) => ({ flights: [], activeId: null, revision: s.revision + 1 })),
    activate: (id: string) => patchState(store, (s) => (s.flights.some((f) => f.id === id) ? { activeId: id } : {})),
    updateStats: (id: string, stats: string) => patchState(store, (s) => ({ flights: s.flights.map((f) => (f.id === id ? { ...f, stats } : f)) })),
    touch: () => patchState(store, (s) => ({ revision: s.revision + 1 })),
  })),
);
