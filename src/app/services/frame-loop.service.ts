import { Injectable } from '@angular/core';

/** Called every frame. `dt` is capped at 50 ms (physics), `rawDt` at 500 ms (replay clock). */
export type FrameTask = (dt: number, rawDt: number, now: number) => void;

/** Order in which per-frame work runs (lower first). */
export const FrameOrder = {
  input: 0,
  simulation: 10,
  live: 20,
  playback: 30,
  video: 35,
  camera: 40,
  widgets: 50,
  xray: 60,
  render: 70,
  capture: 80,
} as const;

interface Entry {
  order: number;
  seq: number;
  task: FrameTask;
  failed: boolean;
}

/**
 * The single requestAnimationFrame loop of the app. Services and widgets register tasks with an order, so the
 * sequence (input -> simulation -> replay -> cameras -> widgets -> render -> capture) is explicit in one place.
 * A task that throws is reported once and keeps running next frame (a broken widget must not freeze the page).
 */
@Injectable({ providedIn: 'root' })
export class FrameLoopService {
  private entries: Entry[] = [];
  private seq = 0;
  private last = 0;
  private running = false;
  /** While true no tasks run (an exact offline render drives frames itself). */
  suspended = false;
  /** While true, `every(n, ...)` tasks run on every call (an exact render needs every widget drawn for every frame). */
  forceAll = false;

  add(order: number, task: FrameTask): () => void {
    const entry: Entry = { order, seq: this.seq++, task, failed: false };
    this.entries = [...this.entries, entry].sort((a, b) => a.order - b.order || a.seq - b.seq);
    return () => {
      this.entries = this.entries.filter((e) => e !== entry);
    };
  }

  /** Run `task` on every n-th frame (n >= 1). */
  every(n: number, order: number, task: FrameTask): () => void {
    let k = 0;
    return this.add(order, (dt, raw, now) => {
      if (this.forceAll || k++ % n === 0) task(dt, raw, now);
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number): void => {
      requestAnimationFrame(tick);
      const raw = Math.max(0, (now - this.last) / 1000);
      this.last = now;
      if (this.suspended) return;
      this.runOnce(Math.min(raw, 0.05), Math.min(raw, 0.5), now);
    };
    requestAnimationFrame(tick);
  }

  /** Run all tasks once with the given timestep (used by the exact renderer). */
  runOnce(dt: number, rawDt: number, now: number): void {
    for (const e of this.entries) {
      try {
        e.task(dt, rawDt, now);
      } catch (err) {
        if (!e.failed) {
          e.failed = true;
          console.error('Frame task failed:', err);
        }
      }
    }
  }
}
