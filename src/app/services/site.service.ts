import { Injectable, computed, inject, signal, untracked, type Signal } from '@angular/core';
import * as THREE from 'three';
import type { Calibration } from '../core/models';
import { DEFAULT_CALIBRATION, setSiteOrigin } from '../core/constants';
import { solveCalibration, toGeo } from '../core/geo';
import type { BuildingSpec, LocationInfo, PadSpec, SiteSpec, TreeSpec, Vec2 } from '../core/site-spec';
import { cloneSpec, createRandom, generateSite, uid } from '../core/site-spec';
import type { Footprint } from './geo.service';
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
  /**
   * While a Sites-panel pick mode is armed, the panel registers a handler here: Alt+clicks on the stage edit the
   * model (drop a tree / draw a partition) instead of starting a new generation.
   */
  readonly stagePick: Signal<((clientX: number, clientY: number) => void) | null> = signal(null);

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

  /**
   * Generate a starter site at a location (from geocoding or a map click) and make it active. Pulls the real OSM
   * data around the point — building footprints, tagged trees, roads — and turns it into an editable spec; falls
   * back to the heuristic template when the endpoints are unreachable.
   */
  async generate(info: LocationInfo, opts: { scale?: number; seed?: number } = {}): Promise<SiteSpec> {
    this.generating.set(true);
    try {
      const k = Math.min(5, Math.max(0.2, opts.scale ?? 1));
      const seed = opts.seed ?? 7;
      let spec: SiteSpec | null = null;
      try {
        const [fps, osmTrees, roads] = await Promise.all([
          this.geo.footprints(info.lat, info.lon),
          this.geo.trees(info.lat, info.lon),
          this.geo.roads(info.lat, info.lon),
        ]);
        if (fps.length) spec = this.specFromFootprints(info, fps, osmTrees, roads, k, seed);
      } catch {
        /* Overpass down / offline: fall through to the template site below */
      }
      if (!spec) {
        // no footprint data: size the template main building from the best guess we have
        let full = info;
        if (info.footprintLength === undefined) full = await this.geo.locationInfo(info.lat, info.lon, info.label);
        spec = generateSite(full, { scale: k, seed });
      }
      this.applySpec(spec, true);
      this.library.save(spec);
      this.toast.show(`Generated “${spec.name}” (${spec.buildings.length} buildings) — edit dimensions in Sites.`);
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

  /**
   * Alt+click on the 3D scene: if a Sites panel pick mode is armed, the click edits there; otherwise the screen
   * point is projected onto the ground, converted to lat/lon through the current calibration and used as the
   * generation location ("build a model where I click").
   */
  async altClick(clientX: number, clientY: number): Promise<void> {
    const pick = this.stagePick();
    if (pick) {
      pick(clientX, clientY);
      return;
    }
    const host = this.scene.host;
    if (!host) return;
    const rect = host.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, host.mainCamera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return;
    const k = this.calibration.modelScale() || 1;
    const [lat, lon] = toGeo(hit.x / k, hit.z / k, this.calibration.calibration());
    await this.generateFromPoint(lat, lon);
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

  /** Store the editor draft in the library and make it the active site (the Sites panel's Save). */
  saveDraft(): void {
    const spec = this.editor.snapshot();
    this.library.save(spec);
    this.applySpec(spec, false);
    this.toast.show(`Site “${spec.name}” saved (${this.library.list().length} in the library). Source: ${this.geo.attribution}.`);
  }

  /** Re-solve the GPS calibration from the active spec's corner landmarks / bearing (after a "Point north"). */
  recalibrate(): void {
    this.calibration.apply(calibrationForSpec(this.active()));
  }

  removeStored(id: string): void {
    this.library.remove(id);
  }

  // ---- internals ----

  /**
   * Turn real OSM data around a point into an editable spec: the nearest building becomes the origin and main
   * building, every other footprint within the radius becomes a rectangular stand-in (size + heading from its
   * longest edge, levels/height from tags), roads become pads. Non-rectangular rings are approximated for now —
   * true polygon walls are a later phase.
   */
  private specFromFootprints(
    info: LocationInfo,
    fps: Footprint[],
    osmTrees: TreeSpec[],
    roads: PadSpec[],
    k: number,
    seed: number,
  ): SiteSpec {
    const mLat = 111132;
    const mLon = 111320 * Math.cos((info.lat * Math.PI) / 180);
    // centre on the footprint closest to the requested point (the clicked/searched place itself)
    let ci = 0;
    let bestD = Infinity;
    fps.forEach((f, i) => {
      let la = 0, lo = 0;
      for (const [p, q] of f.ring) { lo += p; la += q; }
      la /= f.ring.length; lo /= f.ring.length;
      const d = Math.hypot((lo - info.lon) * mLon, (la - info.lat) * mLat);
      if (d < bestD) { bestD = d; ci = i; }
    });
    const centre = fps[ci]!;
    const clat = centre.ring.reduce((a, p) => a + p[1], 0) / centre.ring.length;
    const clon = centre.ring.reduce((a, p) => a + p[0], 0) / centre.ring.length;
    const bearing = ((centre.headingDeg % 180) + 180) % 180;
    const bRad = (bearing * Math.PI) / 180;
    const sinB = Math.sin(bRad), cosB = Math.cos(bRad);
    /** local east/north metres -> site x/z with north along -z and the model rotated so +x is site north-ish */
    const toSite = (ex: number, nz: number): { x: number; z: number } => ({
      x: ex * cosB + nz * sinB,
      z: ex * sinB - nz * cosB,
    });
    const rotLocal = (deg: number): number => (((deg - bearing) % 180) + 180) % 180;

    const buildings: BuildingSpec[] = [];
    for (const f of fps) {
      let la = 0, lo = 0;
      for (const [p, q] of f.ring) { lo += p; la += q; }
      la /= f.ring.length; lo /= f.ring.length;
      const pos = toSite((lo - clon) * mLon, (la - clat) * mLat);
      const L = Math.min(400, Math.max(6, Math.max(f.dx, f.dz) * k));
      const W = Math.min(L * 0.9, Math.max(5, Math.min(f.dx, f.dz) * k));
      const H = Math.min(120, Math.max(2.5, (f.heightM ?? 3.2) * k));
      const lev = Math.max(1, Math.min(12, f.levels ?? 1));
      const lh = H / lev;
      const roof: 'gable' | 'flat' = /^(hip|gable)/i.test(f.roof ?? '') ? 'gable' : lev > 1 ? 'flat' : 'gable';
      const sides = { n: true, s: true, e: true, w: true };
      const doors: BuildingSpec['levels'][number]['doors'] = {
        s: [{ kind: 'door', c: L / 2, w: Math.min(4, L * 0.3), h: Math.min(lh * 0.8, 4) }],
      };
      if (L > 24) doors.w = [{ kind: 'door', c: L * 0.3, w: 3, h: Math.min(lh * 0.8, 4) }];
      const levels = Array.from({ length: lev }, (_, i) => ({
        baseY: i * lh,
        height: lh,
        sides,
        doors: i === 0 ? doors : {},
        partitions: [] as [Vec2, Vec2][],
        roof: i === lev - 1 ? roof : ('flat' as const),
        roofRise: i === lev - 1 ? (roof === 'gable' ? Math.min(W * 0.35, 6) : 0.4) : 0,
      }));
      buildings.push({
        id: f === centre ? 'main' : uid('b'),
        name: f.name || `Building ${buildings.length + 1}`,
        pos,
        rotDeg: rotLocal(f.headingDeg),
        length: L,
        width: W,
        color: '#d7d0bd',
        floorColor: '#a9aaa0',
        levels,
      });
    }

    // trees: keep the OSM-tagged ones near the centre, scatter filler trees out to the extent
    const R = Math.min(600, Math.max(120, bestD + 140)) * Math.max(1, k);
    const trees: TreeSpec[] = [];
    for (const t of osmTrees) {
      const p = toSite(t.x, -t.z); // geo service stores east/x and north/-z already
      if (Math.hypot(p.x, p.z) <= R) trees.push({ ...t, x: p.x, z: p.z });
    }
    const rnd = createRandom(seed);
    for (let i = 0; i < 260 && trees.length < 320; i++) {
      const ang = rnd() * Math.PI * 2;
      const rad = R * (0.25 + rnd() * 0.85);
      const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      if (buildings.some((b) => Math.abs(x - b.pos.x) < b.length / 2 + 5 && Math.abs(z - b.pos.z) < b.width / 2 + 5)) continue;
      const h = 5 + rnd() * 6, r = 1.6 + rnd() * 1.6;
      trees.push({ x, z, h, r, kind: rnd() < 0.28 ? 'c' : 'd' });
    }

    // roads stay axis-aligned pads in the rotated frame; the take-off pad goes into the biggest free spot
    const pads: PadSpec[] = [...roads];
    const main = buildings.find((b) => b.id === 'main') ?? buildings[0]!;
    const frontZ = main.pos.z + main.width / 2 + Math.max(8, main.width * 0.3);
    let sx = main.pos.x, sz = frontZ;
    for (let i = 0; i < 60; i++) {
      const cx = (rnd() - 0.5) * R * 1.2;
      const cz = (rnd() - 0.5) * R * 1.2;
      if (!buildings.some((b) => Math.abs(cx - b.pos.x) < b.length / 2 + 8 && Math.abs(cz - b.pos.z) < b.width / 2 + 8)) {
        sx = cx; sz = cz; break;
      }
    }
    pads.push({ x: sx, z: sz, w: 12, d: 12, color: '#a9aaa0' });

    const gl = Math.max(main.length, main.width) * 0.6;
    return {
      version: 1,
      id: uid(),
      name: info.label || 'Generated site',
      createdAt: Date.now(),
      origin: { lat: clat, lon: clon },
      bearingDeg: bearing,
      genScale: k,
      groundColor: '#789b52',
      buildings,
      pads,
      trees,
      seed,
      extent: R * 1.6,
      droneStart: { x: sx, z: sz },
      calibCorners: {
        p1: { x: main.pos.x - main.length / 2, z: main.pos.z - main.width / 2 },
        p2: { x: main.pos.x + main.length / 2, z: main.pos.z + main.width / 2 },
      },
      geoCorners: {
        p1: { lat: clat - (gl / 2) / mLat, lon: clon },
        p2: { lat: clat, lon: clon + (gl / 2) / mLon },
      },
    };
  }

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
