import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { RADIO_PRESETS, type AxisMap, type MappingPreset, type RadioMapping } from '../core/radio/radio-input';
import { persistState, savedState } from './persist';

export type MappedControl = 'roll' | 'pitch' | 'thr' | 'yaw' | 'arm' | 'mode';

const KEY = 'abando-ng-radio';

/** Axis mapping, rates and expo for the connected radio / gamepad. */
export const RadioStore = signalStore(
  { providedIn: 'root' },
  withState<RadioMapping>(() => savedState(KEY, RADIO_PRESETS.radio())),
  withMethods((store) => ({
    setAxis: (control: MappedControl, axis: Partial<AxisMap>) =>
      patchState(store, (s) => ({ [control]: { ...s[control], ...axis } }) as Partial<RadioMapping>),
    setRate: (rate: number) => patchState(store, { rate }),
    setExpo: (expo: number) => patchState(store, { expo }),
    setSpring: (spring: boolean) => patchState(store, { spring }),
    applyPreset: (preset: MappingPreset) => patchState(store, RADIO_PRESETS[preset]()),
  })),
  withHooks((store) => {
    persistState(store, KEY);
    return {};
  }),
);
