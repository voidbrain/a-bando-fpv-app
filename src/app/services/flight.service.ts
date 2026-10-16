import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { findFlips, findLiftoff } from '../core/flight/analysis';
import { createFlight, flightStats, maxSpeed, prepareFlight } from '../core/flight/flight';
import { parseLog } from '../core/flight/log-parser';
import { Vec3 } from '../core/math3d';
import type { Calibration, Flight, GeoSample, Telemetry } from '../core/models';
import { CalibrationStore } from '../state/calibration.store';
import { FlightStore } from '../state/flight.store';
import { ToastService } from './toast.service';

/** Where the camera should look after a flight is loaded. */
export interface FrameRequest {
  center: Vec3;
  radius: number;
  /** Distance of the flight from the model origin: a long way off means it is outside the modelled area. */
  distanceFromOrigin: number;
}

/**
 * Owns the loaded flights (the heavy data), keeps them prepared for the current calibration and mirrors a light
 * summary into {@link FlightStore}. Parsing is delegated to the pure `parseLog`.
 */
@Injectable({ providedIn: 'root' })
export class FlightService {
  private readonly store = inject(FlightStore);
  private readonly calibration = inject(CalibrationStore);
  private readonly toast = inject(ToastService);
  private readonly byId = new Map<string, Flight>();
  /** Colour-scale maximum over all flights, m/s. */
  speedMax = 1;
  /** Latest request to frame the camera on a newly loaded flight. */
  readonly frameRequest = signal<FrameRequest | null>(null);
  private simulatedCount = 0;

  constructor() {
    // Re-project every flight when the calibration changes.
    effect(() => {
      const cal = this.calibration.calibration();
      untracked(() => this.recalculate(cal));
    });
  }

  get all(): Flight[] {
    return this.store.flights().map((s) => this.byId.get(s.id)).filter((f): f is Flight => !!f);
  }

  get active(): Flight | null {
    const id = this.store.activeId();
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async loadFiles(files: Iterable<File>): Promise<void> {
    for (const file of files) {
      try {
        const { pts, tel } = parseLog(await file.text());
        this.add(file.name, pts, tel, { frame: true });
      } catch (e) {
        this.toast.show(`${file.name}: ${(e as Error).message}`);
      }
    }
  }

  /** Add a flight (becomes the active one). Returns it so callers (live link) can keep appending. */
  add(name: string, pts: GeoSample[], tel: Telemetry | null = null, opts: { frame?: boolean; live?: boolean } = {}): Flight {
    const f = createFlight(name, pts, tel, opts.live ?? false);
    prepareFlight(f, this.calibration.calibration());
    this.byId.set(f.id, f);
    this.store.add({ id: f.id, name: f.name, live: f.live, stats: this.describe(f) });
    this.updateSpeedMax();
    if (opts.frame) this.requestFrame(f);
    return f;
  }

  /** Name for the next simulator recording. */
  nextSimulatedName(): string {
    return `Sim flight ${++this.simulatedCount}`;
  }

  clear(): void {
    this.byId.clear();
    this.store.clear();
    this.speedMax = 1;
  }

  /** Flight data was changed in place (live fixes appended): reproject it and refresh the views. */
  refresh(f: Flight): void {
    prepareFlight(f, this.calibration.calibration());
    this.updateSpeedMax();
    this.store.updateStats(f.id, this.describe(f));
    this.store.touch();
  }

  /** Cheap per-fix update for live flights: re-project the data without rebuilding the 3D path or the summaries. */
  refreshLight(f: Flight): void {
    prepareFlight(f, this.calibration.calibration());
  }

  /** Lift-off time of a flight (cached). */
  liftoff(f: Flight): number | null {
    if (f.liftoff === undefined || f.live) f.liftoff = findLiftoff(f);
    return f.liftoff;
  }

  /** Time of the first flip / roll (cached). */
  firstFlip(f: Flight): number | null {
    if (f.firstFlip === undefined) f.firstFlip = findFlips(f)[0]?.t ?? null;
    return f.firstFlip;
  }

  private recalculate(cal: Calibration): void {
    for (const f of this.byId.values()) {
      prepareFlight(f, cal);
      this.store.updateStats(f.id, this.describe(f));
    }
    this.updateSpeedMax();
    this.store.touch();
  }

  private updateSpeedMax(): void {
    this.speedMax = maxSpeed([...this.byId.values()]);
  }

  private describe(f: Flight): string {
    const s = flightStats(f);
    return `${s.points} pts · ${s.distanceKm.toFixed(2)} km · ${s.durationS.toFixed(0)} s · max ${s.maxKmh.toFixed(0)} km/h`;
  }

  private requestFrame(f: Flight): void {
    if (!f.loc.length) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of f.loc) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    const center = new Vec3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const distanceFromOrigin = Math.hypot(center.x, center.z);
    this.frameRequest.set({ center, radius: Math.min(500, Math.max(40, Math.max(x1 - x0, z1 - z0) * 1.6 + 20)), distanceFromOrigin });
    if (distanceFromOrigin > 400) this.toast.show(`Path is ${distanceFromOrigin.toFixed(0)} m from the map origin — outside the modelled area`);
  }
}
