import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { computed, inject } from '@angular/core';
import { siteOrigin } from '../core/constants';
import { StorageService } from '../services/storage.service';
import { persistState } from './persist';

/** The only backdrop is the live OpenStreetMap embed; 'none' shows the 3D overlay on its own. */
export type MapBackground = 'osm' | 'none';

export interface MapState {
  background: MapBackground;
  /** Opacity of the 3D overlay over the background, 0..1. */
  overlayOpacity: number;
  /** Align mode: drag moves, wheel scales, shift+wheel rotates the overlay. */
  align: boolean;
  scale: Record<MapBackground, number>;
  rotation: number;
  dx: number;
  dz: number;
}

export const MAP_DEFAULT_SCALE: Record<MapBackground, number> = { osm: 0.42, none: 0.6 };
/** The OpenStreetMap embed for a location (the same tiles the builder generates the model from). */
export const osmUrlFor = (lat: number, lon: number): string => {
  const dLat = 0.0025, dLon = 0.0028;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${(lon - dLon).toFixed(6)}%2C${(lat - dLat).toFixed(6)}%2C${(lon + dLon).toFixed(6)}%2C${(lat + dLat).toFixed(6)}&layer=mapnik&marker=${lat.toFixed(6)}%2C${lon.toFixed(6)}`;
};
const KEY = 'abando-ng-map';
const DEFAULTS: MapState = { background: 'osm', overlayOpacity: 0.6, align: false, scale: { ...MAP_DEFAULT_SCALE }, rotation: 0, dx: 0, dz: 0 };

/**
 * Merge a persisted snapshot with the defaults. Older builds saved extra backgrounds — 'img' (the fixed satellite
 * screenshot), 'goog' (Google Maps) — and per-background scales; everything is OSM-only now, so those values are
 * dropped while the saved alignment (scale / rotation / offset) is kept.
 */
export function mergeMapState(saved: Partial<MapState> & { googleUrl?: string; scale?: Partial<Record<string, number>> } | null | undefined): MapState {
  const s = { ...(saved ?? {}) } as Partial<MapState> & Record<string, unknown>;
  delete s.googleUrl;
  const bg = s.background === 'none' ? 'none' : 'osm';
  const scaleIn = (s.scale ?? {}) as Partial<Record<MapBackground, number>>;
  const merged: MapState = {
    ...DEFAULTS,
    ...s,
    background: bg,
    scale: { ...MAP_DEFAULT_SCALE, osm: scaleIn.osm ?? scaleIn.img ?? scaleIn.goog ?? MAP_DEFAULT_SCALE.osm, none: scaleIn.none ?? MAP_DEFAULT_SCALE.none },
  };
  delete (merged as Record<string, unknown>)['googleUrl'];
  return merged;
}

export const MapStore = signalStore(
  { providedIn: 'root' },
  withState(() => {
    // Not savedState(): old builds persisted removed backgrounds ('img' / 'goog'); mergeMapState migrates them to
    // the live OpenStreetMap backdrop while keeping every saved alignment value.
    const raw = inject(StorageService).readRaw(KEY);
    let saved: Partial<MapState> | null = null;
    try {
      saved = raw ? (JSON.parse(raw) as Partial<MapState>) : null;
    } catch {
      saved = null;
    }
    return mergeMapState(saved);
  }),
  withMethods((store) => ({
    setBackground: (background: MapBackground) => patchState(store, { background }),
    setOverlayOpacity: (overlayOpacity: number) => patchState(store, { overlayOpacity }),
    setAlign: (align: boolean) => patchState(store, { align }),
    setScale: (v: number) => patchState(store, (s) => ({ scale: { ...s.scale, [s.background]: Math.max(0.01, v) } })),
    scaleBy: (factor: number) => patchState(store, (s) => ({ scale: { ...s.scale, [s.background]: Math.max(0.01, s.scale[s.background] * factor) } })),
    setRotation: (rotation: number) => patchState(store, { rotation }),
    nudge: (dx: number, dz: number) => patchState(store, (s) => ({ dx: s.dx + dx, dz: s.dz + dz })),
    setOffset: (dx: number, dz: number) => patchState(store, { dx, dz }),
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
