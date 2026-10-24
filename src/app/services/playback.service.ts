import { Injectable, effect, inject, untracked } from '@angular/core';
import { ReplayPose, followClock } from '../core/flight/replay';
import { PlaybackStore } from '../state/playback.store';
import { FlightStore } from '../state/flight.store';
import { CalibrationStore } from '../state/calibration.store';
import { FlightService } from './flight.service';
import { FrameLoopService, FrameOrder } from './frame-loop.service';

/** Anything that can drive the replay clock instead of the wall clock (the flight video). */
export interface ClockSource {
  /** Replay time derived from the source, or null when it cannot be used right now. */
  time(): number | null;
}

/**
 * Replay clock and transport. The playhead `time` changes every frame, so it is a plain field (read by widgets from
 * the frame loop) rather than a signal. When a video is playing forward it is the master clock, so picture and
 * replay can never drift apart.
 */
@Injectable({ providedIn: 'root' })
export class PlaybackService {
  private readonly flights = inject(FlightService);
  private readonly flightStore = inject(FlightStore);
  private readonly calibration = inject(CalibrationStore);
  readonly transport = inject(PlaybackStore);
  readonly pose = new ReplayPose();
  /** Replay time, seconds from the start of the active flight. */
  time = 0;
  clock: ClockSource | null = null;
  private readonly seekListeners = new Set<(t: number) => void>();

  constructor() {
    inject(FrameLoopService).add(FrameOrder.playback, (_dt, raw) => this.update(raw));
    // A newly selected flight starts at 0.
    effect(() => {
      this.flightStore.activeId();
      untracked(() => {
        this.time = 0;
        this.pose.reset();
      });
    });
  }

  /** Called when the playhead is moved by the user (the video follows). */
  onSeek(cb: (t: number) => void): () => void {
    this.seekListeners.add(cb);
    return () => this.seekListeners.delete(cb);
  }

  get duration(): number {
    return this.flights.active?.dur ?? 0;
  }

  play(): void {
    this.transport.setDirection(1);
    this.transport.setPlaying(true);
  }
  playReverse(): void {
    this.transport.setDirection(-1);
    this.transport.setPlaying(true);
  }
  pause(): void {
    this.transport.setPlaying(false);
  }
  toggle(): void {
    if (this.transport.playing()) this.pause();
    else this.play();
  }

  seekTo(t: number): void {
    const f = this.flights.active;
    if (!f) return;
    this.time = Math.max(0, Math.min(f.dur, t));
    for (const cb of this.seekListeners) cb(this.time);
  }
  seekBy(delta: number): void {
    this.seekTo(this.time + delta);
  }

  private update(dt: number): void {
    const f = this.flights.active;
    if (!f) return;
    if (this.transport.playing()) {
      const master = this.transport.direction() > 0 ? this.clock?.time() : null;
      this.time += dt * this.transport.direction() * this.transport.speed();
      // the video leads, but its clock stalls and jumps when the decoder falls behind: follow it smoothly, jump only
      // when it is clearly elsewhere (a seek, a long stall)
      if (master != null) this.time = followClock(this.time, Math.max(0, master), dt);
      if (this.time < 0) {
        if (this.transport.loop()) this.time = f.dur;
        else {
          this.time = 0;
          this.pause();
        }
      }
      if (this.time > f.dur) {
        if (this.transport.loop()) this.time = 0;
        else {
          this.time = f.dur;
          this.pause();
        }
      }
    }
    this.pose.update(f, this.time, this.calibration.calibration(), dt);
  }
}
