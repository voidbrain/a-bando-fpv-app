import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { computed } from '@angular/core';
import { siteOrigin } from '../core/constants';
import { persistState, savedState } from './persist';

export type MapBackground = 'img' | 'goog' | 'osm' | 'none';

export interface MapState {
  background: MapBackground;
  /** Opacity of the 3D overlay over the background, 0..1. */
  overlayOpacity: number;
  /** Align mode: drag moves, wheel scales, shift+wheel rotates the overlay. */
  align: boolean;
  /** Overlay scale (metres per map pixel / per screen unit) per background. */
  scale: Record<MapBackground, number>;
  rotation: number;
  dx: number;
  dz: number;
  /** User-supplied Google Maps embed URL. */
  googleUrl: string;
}

export const MAP_DEFAULT_SCALE: Record<MapBackground, number> = { img: 0.205, goog: 0.42, osm: 0.42, none: 0.6 };
/** Live-map URLs follow the *active* site origin (generated sites move; the builtin one keeps the old numbers). */
export const googleUrlFor = (lat: number, lon: number): string => `https://maps.google.com/maps?q=${lat},${lon}&t=k&z=18&output=embed`;
export const osmUrlFor = (lat: number, lon: number): string => {
  const dLat = 0.0025, dLon = 0.0028;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${(lon - dLon).toFixed(6)}%2C${(lat - dLat).toFixed(6)}%2C${(lon + dLon).toFixed(6)}%2C${(lat + dLat).toFixed(6)}&layer=mapnik&marker=${lat.toFixed(6)}%2C${lon.toFixed(6)}`;
};
const KEY = 'abando-ng-map';
const DEFAULTS: MapState = { background: 'img', overlayOpacity: 0.6, align: false, scale: { ...MAP_DEFAULT_SCALE }, rotation: 0, dx: 0, dz: 0, googleUrl: googleUrlFor(45.528698, 12.133305) };

/** Accepts an embed URL or the whole `<iframe ...>` snippet; returns a clean Google Maps URL or null. */
export function parseGoogleEmbed(input: string): string | null {
  let v = input.trim();
  const m = /src=["']([^"']+)["']/.exec(v);
  if (m) v = m[1] as string;
  v = v.replace(/&amp;/g, '&');
  return /^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)/.test(v) ? v : null;
}

export const MapStore = signalStore(
  { providedIn: 'root' },
  withState(() => savedState(KEY, DEFAULTS)),
  withMethods((store) => ({
    setBackground: (background: MapBackground) => patchState(store, { background }),
    setOverlayOpacity: (overlayOpacity: number) => patchState(store, { overlayOpacity }),
    setAlign: (align: boolean) => patchState(store, { align }),
    setScale: (v: number) => patchState(store, (s) => ({ scale: { ...s.scale, [s.background]: Math.max(0.01, v) } })),
    scaleBy: (factor: number) => patchState(store, (s) => ({ scale: { ...s.scale, [s.background]: Math.max(0.01, s.scale[s.background] * factor) } })),
    setRotation: (rotation: number) => patchState(store, { rotation }),
    nudge: (dx: number, dz: number) => patchState(store, (s) => ({ dx: s.dx + dx, dz: s.dz + dz })),
    setOffset: (dx: number, dz: number) => patchState(store, { dx, dz }),
    setGoogleUrl: (googleUrl: string) => patchState(store, { googleUrl }),
    /** Point both live backgrounds at a new location (used when a generated site is loaded). */
    locate: (lat: number, lon: number) => patchState(store, { googleUrl: googleUrlFor(lat, lon) }),
    resetAlignment: () => patchState(store, { scale: { ...MAP_DEFAULT_SCALE }, rotation: 0, dx: 0, dz: 0 }),
  })),
  withComputed(() => ({
    /** The OpenStreetMap embed for the active site (display only; the data behind the model comes from Overpass). */
    osmUrl: computed(() => {
      const o = siteOrigin();
      return osmUrlFor(o.lat, o.lon);
    }),
  })),
  withHooks((store) => {
    persistState(store, KEY);
    return {};
  }),
);
