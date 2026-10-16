import { computed, signal } from '@angular/core';
import type { Calibration, GeoPoint } from './models';

export const GRAVITY = 9.81;
/** Altitude above sea level assumed for the simulator's GPS log, metres. */
export const SIM_BASE_ALT = 8;

/** Geographic origin of the local frame. Default: centre of the shipped site model (the abandoned store). */
export const DEFAULT_SITE_ORIGIN: GeoPoint = { lat: 45.528698, lon: 12.133305 };
export const METRES_PER_DEG_LAT = 111132;

/**
 * The geographic origin of the *active* site. {@link SiteService} writes it whenever a generated / stored site is
 * loaded, so geo conversions, GPS logs and map URLs follow the site instead of being hard-coded to one address.
 */
const originSignal = signal<GeoPoint>(DEFAULT_SITE_ORIGIN);
export const siteOrigin = computed(() => originSignal());
export const setSiteOrigin = (p: GeoPoint): void => originSignal.set({ lat: p.lat, lon: p.lon });

/** @deprecated the live origin is {@link siteOrigin}; kept for the shipped default site. */
export const SITE_ORIGIN: GeoPoint = DEFAULT_SITE_ORIGIN;
/** @deprecated use {@link metresPerDegLon}(lat) from core/geo. */
export const METRES_PER_DEG_LON = 111320 * Math.cos((DEFAULT_SITE_ORIGIN.lat * Math.PI) / 180);

/**
 * Default calibration, solved from two real corners (greenhouse NW and store SE) so that logged GPS paths
 * land on the model without manual alignment. See {@link solveCalibration}.
 */
export const DEFAULT_CALIBRATION: Calibration = { rot: -6.7608, dx: -95.627, dz: -22.358 };

export const CALIBRATION_CORNERS = {
  greenhouseNW: { lat: 45.52933973044534, lon: 12.13339414617621 },
  storeSE: { lat: 45.52770802963285, lon: 12.134709822938442 },
} as const;

/** Where the simulator drone starts (on the west apron), model metres. */
export const DRONE_START = { x: -44, z: 26 } as const;
export const DRONE_REST_HEIGHT = 0.06;

/** Satellite top view shipped with the app: scale and where its centre sits in the model. */
export const MAP_IMAGE = {
  url: 'assets/map-top.jpg',
  width: 1382,
  height: 1084,
  metresPerPixel: 0.205,
  centre: { x: -18.4, z: -14.1 },
  /** Angle of image-up in the model frame, degrees. */
  upAngle: 56.5,
} as const;
