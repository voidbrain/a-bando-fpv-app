import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { DEFAULT_CALIBRATION } from '../core/constants';
import { clamp } from '../core/math';
import type { Calibration } from '../core/models';
import { persistState, savedState } from './persist';

export interface CalibrationState extends Calibration {
  /** Scale of the buildings (1 = the measured size). The world, paths and drone are never scaled. */
  modelScale: number;
}

const KEY = 'abando-ng-cal';
const DEFAULTS: CalibrationState = { ...DEFAULT_CALIBRATION, modelScale: 1 };
export const MODEL_SCALE_RANGE = { min: 0.3, max: 3 } as const;

/** How the real world sits on the model: rotation and shift of the geographic origin, and the model scale. */
export const CalibrationStore = signalStore(
  { providedIn: 'root' },
  withState(() => savedState(KEY, DEFAULTS)),
  withComputed((store) => ({
    calibration: computed<Calibration>(() => ({ rot: store.rot(), dx: store.dx(), dz: store.dz() })),
  })),
  withMethods((store) => ({
    setRot: (rot: number) => patchState(store, { rot: isFinite(rot) ? rot : 0 }),
    setDx: (dx: number) => patchState(store, { dx: isFinite(dx) ? dx : 0 }),
    setDz: (dz: number) => patchState(store, { dz: isFinite(dz) ? dz : 0 }),
    shift: (dx: number, dz: number) => patchState(store, (s) => ({ dx: s.dx + dx, dz: s.dz + dz })),
    rotate: (deg: number) => patchState(store, (s) => ({ rot: s.rot + deg })),
    apply: (c: Calibration) => patchState(store, { rot: c.rot, dx: c.dx, dz: c.dz }),
    reset: () => patchState(store, { ...DEFAULT_CALIBRATION }),
    setModelScale: (k: number) => patchState(store, { modelScale: clamp(isFinite(k) && k > 0 ? k : 1, MODEL_SCALE_RANGE.min, MODEL_SCALE_RANGE.max) }),
  })),
  withHooks((store) => {
    persistState(store, KEY);
    return {};
  }),
);
