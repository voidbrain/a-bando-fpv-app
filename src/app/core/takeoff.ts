import { computed, signal } from '@angular/core';
import type { Vec2 } from './site-spec';

/**
 * The take-off pad of the *active* site (model metres). {@link SiteService} writes it whenever a site is generated /
 * loaded / applied, so the simulator drone always rests on the current model's pad — never on a hard-coded spot of a
 * shipped scene. Defaults to the origin while no site has been applied yet.
 */
const takeoffSignal = signal<Vec2>({ x: 0, z: 0 });
export const takeoffSpot = computed(() => takeoffSignal());
export const setTakeoff = (p: Vec2): void => takeoffSignal.set({ x: p.x, z: p.z });
