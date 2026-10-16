import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { computed, inject, signal } from '@angular/core';
import { DEFAULT_SITE_ORIGIN, siteOrigin } from '../core/constants';
import { StorageService } from '../services/storage.service';
import { persistState } from './persist';

/** Backdrops: the live OpenStreetMap standard tiles, an aerial/satellite layer (Esri World Imagery), or none. */
export type MapBackground = 'osm' | 'sat' | 'none';

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

export const MAP_DEFAULT_SCALE: Record<MapBackground, number> = { osm: 0.42, sat: 0.42, none: 0.6 };
/** The map embed URL for a location and background ('sat' uses Esri World Imagery tiles through the OSM frame). */
export const osmUrlFor = (lat: number, lon: number, bg: MapBackground = 'osm'): string => {
  const dLat = 0.0025, dLon = 0.0028;
  const bbox = `${(lon - dLon).toFixed(6)}%2C${(lat - dLat).toFixed(6)}%2C${(lon + dLon).toFixed(6)}%2C${(lat + dLat).toFixed(6)}`;
  const marker = `${lat.toFixed(6)}%2C${lon.toFixed(6)}`;
  if (bg === 'sat') {
    // Esri World Imagery: free-to-view aerial imagery with lat/lon alignment (Web Mercator, no rotation needed)
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=https%3A%2F%2Fserver.arcgisonline.com%2FArcGIS%2Frest%2Fservices%2FWorld_Imagery%2FMapServer%2Ftile%2F%7Bz%7D%2F%7Bx%7D%2F%7By%7D&marker=${marker}`;
  }
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${marker}`;
};
const KEY = 'abando-ng-map';
const DEFAULTS: MapState = { background: 'osm', overlayOpacity: 0.6, align: false, scale: { ...MAP_DEFAULT_SCALE }, rotation: 0, dx: 0, dz: 0 };

/**
 * Merge a persisted snapshot with the defaults. Older builds saved extra backgrounds — 'img' (the fixed satellite
 * screenshot), 'goog' (Google Maps) — as a per-background scale map and a `googleUrl`; everything is OSM-only now,
 * so those legacy fields are dropped while the saved alignment (scale / rotation / offset) is kept.
 */
export function mergeMapState(
  saved: (Partial<Omit<MapState, 'scale'>> & { scale?: Partial<Record<string, number>>; googleUrl?: string }) | null | undefined,
): MapState {
  const { googleUrl: _googleUrl, ...rest } = saved ?? {};
  const bg: MapBackground = rest.background === 'none' || rest.background === 'sat' ? rest.background : 'osm'; // legacy 'img'/'goog' migrate to osm
  const scaleIn = rest.scale ?? {};
  return {
    ...DEFAULTS,
    ...rest,
    background: bg,
    // Carry an old per-background scale over to OSM ('img' / 'goog' entries came from removed backdrops).
    scale: { ...MAP_DEFAULT_SCALE, osm: scaleIn['osm'] ?? scaleIn['img'] ?? scaleIn['goog'] ?? MAP_DEFAULT_SCALE.osm, sat: scaleIn['sat'] ?? scaleIn['img'] ?? MAP_DEFAULT_SCALE.sat, none: scaleIn['none'] ?? MAP_DEFAULT_SCALE.none },
  };
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
  withMethods((store) => {
    // The location the map frame points at. Defaults to the active site's origin; `locate()` overrides it
    // (e.g. when a site is generated / imported), so the embed follows the latest location even if the
    // origin signal hasn't propagated yet. The nonce `n` forces the iframe to reload even when only the
    // marker position repeats (the user panned the live map away).
    const located = signal<{ lat: number; lon: number; n: number } | null>(null);
    return {
      setBackground: (background: MapBackground) => patchState(store, { background }),
      setOverlayOpacity: (overlayOpacity: number) => patchState(store, { overlayOpacity }),
      setAlign: (align: boolean) => patchState(store, { align }),
      setScale: (v: number) => patchState(store, (s) => ({ scale: { ...s.scale, [s.background]: Math.max(0.01, v) } })),
      scaleBy: (factor: number) => patchState(store, (s) => ({ scale: { ...s.scale, [s.background]: Math.max(0.01, s.scale[s.background] * factor) } })),
      setRotation: (rotation: number) => patchState(store, { rotation }),
      nudge: (dx: number, dz: number) => patchState(store, (s) => ({ dx: s.dx + dx, dz: s.dz + dz })),
      setOffset: (dx: number, dz: number) => patchState(store, { dx, dz }),
      resetAlignment: () => patchState(store, { scale: { ...MAP_DEFAULT_SCALE }, rotation: 0, dx: 0, dz: 0 }),
      /** Point the OpenStreetMap embed at a location (used when a site is created / loaded or on search). */
      locate: (lat: number, lon: number) => located.set({ lat, lon, n: Date.now() }),
      /** The location currently shown: explicit `locate()` override, else the active site origin. */
      location: computed(() => {
        const l = located();
        return l
          ? { lat: l.lat, lon: l.lon, nonce: l.n, override: true }
          : { ...siteOrigin(), nonce: 0, override: false };
      }),
    };
  }),
  withComputed((store) => ({
    /** The OpenStreetMap embed for the location being shown (see {@link locate}); the nonce busts the iframe cache. */
    osmUrl: computed(() => {
      // read `locate()`'s signal *inside* this computed so a new locate() re-runs it (the nonce is part of its identity)
      const l = store.location();
      return osmUrlFor(l.lat, l.lon, store.background()) + (l.override ? `#v${l.nonce}` : '');
    }),
  })),
  withHooks((store) => {
    persistState(store, KEY);
    return {};
  }),
);
