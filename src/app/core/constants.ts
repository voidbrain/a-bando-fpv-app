import { computed, signal } from '@angular/core';
import type { Calibration, GeoPoint } from './models';

export const GRAVITY = 9.81;
/** Altitude above sea level assumed for the simulator's GPS log, metres. */
export const SIM_BASE_ALT = 8;

/** Geographic origin of the local frame until a site is loaded (the blank canvas sits at 0,0). */
export const DEFAULT_SITE_ORIGIN: GeoPoint = { lat: 0, lon: 0 };
export const METRES_PER_DEG_LAT = 111132;

/**
 * The geographic origin of the *active* site. {@link SiteService} writes it whenever a generated / stored site is
 * loaded, so geo conversions, GPS logs and map URLs follow the site instead of being hard-coded to one address.
 */
const originSignal = signal<GeoPoint>(DEFAULT_SITE_ORIGIN);
export const siteOrigin = computed(() => originSignal());
export const setSiteOrigin = (p: GeoPoint): void => originSignal.set({ lat: p.lat, lon: p.lon });

/** Neutral default calibration; every real site re-solves it from its own corner landmarks. */
export const DEFAULT_CALIBRATION: Calibration = { rot: 0, dx: 0, dz: 0 };

/** Resting height of the drone above the take-off pad, metres. */
export const DRONE_REST_HEIGHT = 0.06;
