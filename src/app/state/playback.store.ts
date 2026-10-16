import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';

export interface PlaybackState {
  playing: boolean;
  /** 1 = forward, -1 = reverse. */
  direction: 1 | -1;
  /** Replay speed multiplier. */
  speed: number;
  loop: boolean;
}

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

/** Transport state. The playhead time itself is hot (changes every frame) and lives in PlaybackService. */
export const PlaybackStore = signalStore(
  { providedIn: 'root' },
  withState<PlaybackState>({ playing: false, direction: 1, speed: 1, loop: true }),
  withMethods((store) => ({
    setPlaying: (playing: boolean) => patchState(store, { playing }),
    setDirection: (direction: 1 | -1) => patchState(store, { direction }),
    setSpeed: (speed: number) => patchState(store, { speed }),
    setLoop: (loop: boolean) => patchState(store, { loop }),
  })),
);
