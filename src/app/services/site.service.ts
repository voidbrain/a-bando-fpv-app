import { Injectable, computed, inject, signal, untracked } from '@angular/core';
import type { Calibration } from '../core/models';
import { DEFAULT_CALIBRATION, setSiteOrigin } from '../core/constants';
import { solveCalibration } from '../core/geo';
import type { LocationInfo, SiteSpec } from '../core/site-spec';
import { cloneSpec, generateSite, uid } from '../core/site-spec';
import { SiteEditor } from '../core/site-editor';
import { builtinSpec } from '../three/site-model';
import { CalibrationStore } from '../state/calibration.store';
import { MapStore } from '../state/map.store';
import { GeoService } from './geo.service';
import { SceneService } from './scene.service';
import { SiteLibraryService } from './site-library.service';
import { ToastService } from './toast.service';

/**
 * The site as the rest of the app sees it: which {@link SiteSpec} is active, how to generate one from a location
 * (address / map click -> OSM footprints -> starter model), and how to load / save / edit sites. Loading a site
 * moves the geographic origin, re-solves the GPS calibration from the spec's corner landmarks and rebuilds the 3D
 * scene, so logged paths land on the new model without manual alignment.
 */
@Injectable({ providedIn: 'root' })
export class SiteService {
  private readonly geo = inject(GeoService);
  private readonly library = inject(SiteLibraryService);
  private readonly scene = inject(SceneService);
  private readonly calibration = inject(CalibrationStore);
  private readonly map = inject(MapStore);
  private readonly toast = inject(ToastService);

  /** The editor draft (the "Sites" panel binds to this; apply() pushes it into the scene). */
  readonly editor = new SiteEditor();
  readonly active = signal<SiteSpec>(builtinSpec());
  readonly generating = signal(false);
  readonly generatedCount = computed(() => this.library.list().length);

  constructor() {
    // start where the user left off: the stored active spec, or the shipped site
    const savedId = readStoredId();
    const restored = savedId ? this.library.load(savedId) : null;
    this.editor.load(restored ?? this.active());
    if (restored) untracked(() => this.applySpec(restored, false));
  }

  /** Builtin site, freshly built from its spec. */
  useBuiltin(): void {
    this.applySpec(builtinSpec(), true);
    this.toast.show('Shipped site loaded.');
  }

  /** Load a stored site by id. */
  useStored(id: string): boolean {
    const spec = this.library.load(id);
    if (!spec) return false;
    this.applySpec(spec, true);
    this.toast.show(`Site “${spec.name}” loaded.`);
    return true;
  }

  /** Import a spec (JSON text from a file drop / paste). */
  importJson(text: string): boolean {
    const spec = this.library.importJson(text);
    if (!spec) {
      this.toast.show('Not a valid site file.');
      return false;
    }
    this.applySpec(spec, true);
    this.toast.show(`Imported “${spec.name}”.`);
    return true;
  }

  exportActive(): string {
    return this.library.exportJson(this.active());
  }

  /** Generate a starter site at a location (from geocoding or a map click) and make it active. */
  async generate(info: LocationInfo, opts: { scale?: number; seed?: number } = {}): Promise<SiteSpec> {
    this.generating.set(true);
    try {
      let full = info;
      if (info.footprintLength === undefined) {
        full = await this.geo.locationInfo(info.lat, info.lon, info.label);
      }
      const spec = generateSite(full, opts);
      this.applySpec(spec, true);
      this.library.save(spec);
      this.toast.show(`Generated “${spec.name}” — open Sites to edit every dimension.`);
      return spec;
    } finally {
      this.generating.set(false);
    }
  }

  /** Convenience: geocode an address and generate from the first hit. Returns false when nothing matched. */
  async generateFromAddress(address: string, scale = 1): Promise<boolean> {
    this.generating.set(true);
    try {
      const hits = await this.geo.geocode(address, 1);
      if (!hits.length) {
        this.toast.show('No location found for that address.');
        return false;
      }
      await this.generate(hits[0]!, { scale });
      return true;
    } catch {
      this.toast.show('Geocoding unreachable (offline?). Enter lat,lon instead.');
      const p = parseLatLng(address);
      if (!p) return false;
      await this.generate({ label: 'Entered position', lat: p[0], lon: p[1] }, { scale });
      return true;
    } finally {
      this.generating.set(false);
    }
  }

  /** Reverse-geocode a clicked coordinate and generate there. */
  async generateFromPoint(lat: number, lon: number, scale = 1): Promise<void> {
    const hit = await this.geo.reverse(lat, lon);
    await this.generate({ label: hit.label || `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lat, lon }, { scale });
  }

  // ---- editing ----

  /** Push the editor draft into the scene (live preview). Keeps the camera where it is. */
  applyDraft(): void {
    this.applySpec(this.editor.snapshot(), false);
  }

  /** Store the current active site in the library under its name. */
  saveActive(): void {
    const spec = this.active();
    this.library.save(spec);
    this.toast.show(`Site “${spec.name}” saved (${this.generatedCount()} in the library). Source: ${this.geo.attribution}.`);
  }

  removeStored(id: string): void {
    this.library.remove(id);
  }

  // ---- internals ----

  private applySpec(spec: SiteSpec, resetView: boolean): void {
    this.active.set(spec);
    // adopt the spec as the new draft, unless the caller is applying the draft itself (live preview)
    if (!sameSpec(this.editor.draft(), spec)) this.editor.load(spec);
    writeStoredId(spec.id === 'bando-default' ? '' : spec.id);
    setSiteOrigin(spec.origin);
    this.map.locate(spec.origin.lat, spec.origin.lon);
    this.calibration.apply(calibrationForSpec(spec));
    if (resetView) this.scene.resetCamera();
    if (this.scene.host) {
      const site = this.scene.host.setSite(spec);
      // the x-ray and the simulator collider point at the old model object graph: re-arm them
      this.scene.rebindSite(site);
    }
  }
}

/**
 * Calibration for a spec: the builtin site keeps the hand-solved default (bit-for-bit identical to the shipped app);
 * generated sites solve rot/dx/dz from their own corner landmarks so logged GPS paths fall in place.
 */
export function calibrationForSpec(spec: SiteSpec): Calibration {
  if (spec.id === 'bando-default') return { ...DEFAULT_CALIBRATION };
  if (!spec.geoCorners) return { rot: -spec.bearingDeg + 90, dx: 0, dz: 0 };
  const r = solveCalibration(spec.geoCorners.p1, spec.geoCorners.p2, spec.calibCorners.p1, spec.calibCorners.p2, spec.origin);
  return r ? r.calibration : { rot: 0, dx: 0, dz: 0 };
}

/** "45.52,12.13" or "45.52 12.13" -> [lat, lon]; anything else -> null. */
export function parseLatLng(text: string): [number, number] | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = +m[1]!, lon = +m[2]!;
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null;
}

/** A unique-ish id for adopted specs (imports of the same file twice must not collide). */
export function freshSpecId(spec: SiteSpec): SiteSpec {
  const c = cloneSpec(spec);
  c.id = uid('site');
  return c;
}

/** Structural equality of two specs (cheap: they are small plain objects). */
function sameSpec(a: SiteSpec, b: SiteSpec): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

const ID_KEY = 'abando-ng-active-site-id';
function readStoredId(): string {
  try {
    return localStorage.getItem(ID_KEY) ?? '';
  } catch {
    return '';
  }
}
function writeStoredId(id: string): void {
  try {
    if (id) localStorage.setItem(ID_KEY, id);
    else localStorage.removeItem(ID_KEY);
  } catch {
    /* storage unavailable: the session still works */
  }
}
