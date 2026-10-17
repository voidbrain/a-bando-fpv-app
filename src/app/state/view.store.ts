import { signalStore, withHooks, withMethods, withState, patchState } from '@ngrx/signals';
import type { CameraView, MainSource } from '../core/models';
import { persistState, savedState } from './persist';

export interface ViewState {
  /** What fills the page: the 3D model or the flight video. */
  mainSource: MainSource;
  /** Camera of the main 3D page. */
  cameraView: CameraView;
  /** Orbit / top views follow the drone. */
  orbitFollow: boolean;
  /** Chase / FPV follow the replay when a flight is loaded (and the simulator is not armed). */
  replayFollow: boolean;
  /** Fade obstacles between the camera and the drone. */
  xray: boolean;
  roofHidden: boolean;
  collisions: boolean;
  /** Up-tilt of the FPV camera, degrees. */
  fpvTiltDeg: number;
}

const KEY = 'abando-ng-view';
const DEFAULTS: ViewState = { mainSource: '3d', cameraView: 'orbit', orbitFollow: true, replayFollow: true, xray: true, roofHidden: false, collisions: true, fpvTiltDeg: 25 };

export const ViewStore = signalStore(
  { providedIn: 'root' },
  withState(() => {
    const saved = savedState(KEY, DEFAULTS);
    // Old builds could persist 'video' as the main source; without a loaded video that leaves a black page.
    if (saved.mainSource === 'video') return { ...saved, mainSource: '3d' as MainSource };
    return saved;
  }),
  withMethods((store) => ({
    setMainSource: (mainSource: MainSource) => patchState(store, { mainSource }),
    setCameraView: (cameraView: CameraView) => patchState(store, { cameraView }),
    toggleOrbitFollow: () => patchState(store, (s) => ({ orbitFollow: !s.orbitFollow })),
    toggleReplayFollow: () => patchState(store, (s) => ({ replayFollow: !s.replayFollow })),
    toggleXray: () => patchState(store, (s) => ({ xray: !s.xray })),
    setRoofHidden: (roofHidden: boolean) => patchState(store, { roofHidden }),
    toggleRoof: () => patchState(store, (s) => ({ roofHidden: !s.roofHidden })),
    toggleCollisions: () => patchState(store, (s) => ({ collisions: !s.collisions })),
    setFpvTilt: (fpvTiltDeg: number) => patchState(store, { fpvTiltDeg: isFinite(fpvTiltDeg) ? fpvTiltDeg : 0 }),
  })),
  withHooks((store) => {
    persistState(store, KEY);
    return {};
  }),
);
