import { computed, signal } from '@angular/core';
import type { Vec2 } from './site-spec';

/** A take-off pad: plan position plus the ground height under it (0 on flat ground). */
export type Takeoff = Vec2 & { y?: number };

/**
 * The take-off pad of the *active* site (model metres). {@link SiteService} writes it whenever a site is generated /
 * loaded / applied, so the simulator drone always rests on the current model's pad — never on a hard-coded spot of a
 * shipped scene. Defaults to the origin while no site has been applied yet.
 */
const takeoffSignal = signal<Takeoff>({ x: 0, z: 0 });
export const takeoffSpot = computed(() => takeoffSignal());
export const setTakeoff = (p: Takeoff): void => takeoffSignal.set({ x: p.x, z: p.z, y: p.y ?? 0 });

/** Ground height of the active site (model metres); null while its ground is flat. Flight paths are laid on it. */
const groundSignal = signal<((x: number, z: number) => number) | null>(null);
export const activeGround = computed(() => groundSignal());
export const setActiveGround = (fn: ((x: number, z: number) => number) | null): void => groundSignal.set(fn);

/** The active bando's place is hidden / rounded and no flight was aligned yet: the next loaded flight starts on the pad. */
const autoAlignSignal = signal(false);
export const autoAlignFlights = computed(() => autoAlignSignal());
export const setAutoAlign = (on: boolean): void => autoAlignSignal.set(on);
