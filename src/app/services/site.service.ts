import { Injectable, computed, effect, inject, signal, untracked, type WritableSignal } from '@angular/core';
import { ELEVATION_ATTRIBUTION } from '../core/elevation';
import type { Calibration, GeoPoint } from '../core/models';
import { setSiteOrigin } from '../core/constants';
import { solveCalibration, toGeo } from '../core/geo';
import { bounds, edgesOf, recentre, rectilinear, type Pt } from '../core/footprint';
import type { BuildingSpec, LocationInfo, SiteSpec, StructureSpec, TreeSpec, Vec2, WallOpening, ZoneSpec } from '../core/site-spec';
import { keepInsideAreas } from '../core/areas';
import { emptySpec, uid } from '../core/site-spec';
import { setActiveGround, setAutoAlign, setTakeoff } from '../core/takeoff';
import { decodeHeights, shareCopy, type Privacy } from '../core/share';
import { emptyGrid, getTerrainBase } from '../core/terrain';
import { cacheBase } from './elevation.service';
import { hasTerrainBase, type HeightGrid } from '../core/terrain';
import { ElevationService } from './elevation.service';
import { siteGround } from '../core/site-ground';
import type { Footprint } from './geo.service';
import { SiteEditor } from '../core/site-editor';
import { CalibrationStore } from '../state/calibration.store';
import { GeoService } from './geo.service';
import { SceneService } from './scene.service';
import { isVoidSpec } from '../three/scene-host';
import { showcaseLink } from '../core/tour';
import { SiteLibraryService } from './site-library.service';
import { ToastService } from './toast.service';

/** Zone half extents are bounded: Overpass queries and the 3D scene both get heavy beyond ~1 km. */
export const MAX_HALF_EXTENT = 500;
const clampHalf = (v: number): number => Math.min(MAX_HALF_EXTENT, Math.max(30, v));

const bboxPoly = (pts: Pt[]): Pt[] => {
  const b = bounds(pts);
  return [{ x: b.x0, z: b.z0 }, { x: b.x1, z: b.z0 }, { x: b.x1, z: b.z1 }, { x: b.x0, z: b.z1 }];
};

export interface GenerateOptions {
  scale?: number;
  seed?: number;
  /** Half extents (metres) of the map zone to pull from OpenStreetMap. Default 250 × 250. */
  area?: { halfE: number; halfN: number; rotDeg?: number };
  /** Regenerate an existing bando in place: keep its id / name / creation date. */
  keep?: { id?: string; name: string; createdAt?: number };
  /** Several map areas in one bando (`area` must cover them all): without `fillGaps` only what is inside one of them is kept. */
  areas?: ZoneSpec[];
  fillGaps?: boolean;
}

/**
 * The site as the rest of the app sees it: which {@link SiteSpec} is active, how to generate one from a location
 * (address / map click -> OSM footprints -> starter model), and how to load / save / edit sites. The app starts on a
 * blank canvas — every model comes from a real location or the user's own edits. Loading a site moves the geographic
 * origin, re-solves the GPS calibration from the spec's corner landmarks and rebuilds the 3D scene, so logged paths
 * land on the new model without manual alignment.
 */
@Injectable({ providedIn: 'root' })
export class SiteService {
  private readonly geo = inject(GeoService);
  private readonly library = inject(SiteLibraryService);
  private readonly scene = inject(SceneService);
  private readonly calibration = inject(CalibrationStore);
  private readonly toast = inject(ToastService);
  private readonly elevation = inject(ElevationService);

  /** The editor draft (the "Sites" panel binds to this; apply() pushes it into the scene). */
  readonly editor = new SiteEditor();
  readonly active = signal<SiteSpec>(emptySpec({ lat: 0, lon: 0 }, 'Blank site'));
  readonly generating = signal(false);
  /** True while no model has been generated / loaded yet — used for the stage hint. */
  readonly blank = computed(() => this.active().buildings.length === 0);
  readonly generatedCount = computed(() => this.library.list().length);
  /**
   * While a Sites-panel pick mode is armed, the panel registers a handler here: Alt+clicks on the stage edit the
   * model (drop a tree / draw a partition) instead of starting a new generation.
   */
  readonly stagePick: WritableSignal<((clientX: number, clientY: number) => void) | null> = signal(null);

  /** The last geocoded search ("Show on map" points the OSM embed here without generating anything). */

  constructor() {
    // A pin / compass / shift changes the live calibration: remember it in the bando, otherwise the next Save or edit
    // (which re-applies the spec) would silently put the path back.
    effect(() => {
      const c = this.calibration.calibration();
      untracked(() => this.keepCalibration(c));
    });
    // start where the user left off: the stored active spec, otherwise the blank canvas; a showcase link always opens on
    // the empty world (the bando opened last is not shown first, and stays the one a normal visit opens)
    const savedId = showcaseLink(location.search, location.hash) ? '' : readStoredId();
    const restored = savedId ? this.library.load(savedId) : null;
    if (restored) untracked(() => this.applySpec(restored, false));
    else this.editor.load(this.active());
  }

  private keepCalibration(c: Calibration): void {
    const a = this.active();
    if (!a.id) return;
    const wanted = a.calibration ?? calibrationForSpec(a);
    if (Math.abs(wanted.rot - c.rot) < 1e-9 && Math.abs(wanted.dx - c.dx) < 1e-9 && Math.abs(wanted.dz - c.dz) < 1e-9) return;
    a.calibration = { ...c };
    this.editor.live((s) => {
      s.calibration = { ...c };
    });
    if (this.library.load(a.id)) this.library.save(this.editor.snapshot());
  }

  /** Wipe the scene back to the blank canvas (no buildings), keeping the current location. */
  newBlank(): void {
    this.applySpec(emptySpec(this.active().origin, 'Blank site'), true);
    this.toast.show('Blank model: create a bando in the Bandos panel, or Alt+click the map to build one.');
  }

  /**
   * Show a bando without keeping it (the welcome tour's copy of an example, the empty world): nothing is saved and the
   * bando opened last stays the one a reload opens. A file's own ground goes to the cache as with an import.
   */
  showTemporary(text: string | SiteSpec): boolean {
    const spec = typeof text === 'string' ? this.library.importJson(text) : text;
    if (!spec) return false;
    this.absorbGround(spec);
    this.applySpec(spec, true, false);
    return true;
  }

  /** The empty world of a first visit (nothing saved). */
  showVoid(): void {
    this.applySpec(emptySpec({ lat: 0, lon: 0 }, 'Blank site'), true, false);
  }

  /** The real ground a shared file carries goes to the elevation cache, out of the spec (it is cloned on every edit). */
  private absorbGround(spec: SiteSpec): void {
    const base = spec.terrain?.base;
    if (spec.terrain && base?.data) {
      const h = decodeHeights(base.data, emptyGrid(spec.terrain).h.length);
      delete base.data;
      if (h) void cacheBase(base.key, h);
      else delete spec.terrain.base;
    }
  }

  /** Load a stored site by id. */
  useStored(id: string): boolean {
    const spec = this.library.load(id);
    if (!spec) return false;
    this.applySpec(spec, true);
    this.toast.show(`Bando “${spec.name}” loaded.`);
    return true;
  }

  /**
   * Import a bando file. The real ground it carries (a shared copy whose place is hidden) moves to the local cache, out
   * of the spec; a bando already in the library under the same id is kept and the import gets a new one. It is saved.
   */
  importJson(text: string): boolean {
    const spec = this.library.importJson(text);
    if (!spec) {
      this.toast.show('Not a valid bando file.');
      return false;
    }
    this.absorbGround(spec);
    if (this.library.load(spec.id)) spec.id = uid();
    this.library.save(spec);
    this.applySpec(spec, true);
    this.toast.show(`Imported “${spec.name}”${spec.privacy === 'hidden' ? ' (its place is hidden)' : ''}.`);
    return true;
  }

  /** A bando as a file to share: with its exact place, or hidden (the real ground then travels inside). A hidden bando stays hidden. */
  async exportShared(id: string, privacy: Privacy): Promise<{ name: string; text: string; ground: boolean; hidden: boolean } | null> {
    const spec = this.library.load(id) ?? (this.active().id === id ? this.active() : null);
    if (!spec) return null;
    const key = spec.terrain?.base?.key;
    if (key && !getTerrainBase(key)) await this.elevation.ensure(spec);
    const copy = shareCopy(spec, privacy, key ? getTerrainBase(key) : null);
    const slug = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bando';
    return { name: `${slug}${copy.privacy ? '-hidden' : ''}.bando.json`, text: JSON.stringify(copy), ground: !!copy.terrain?.base?.data, hidden: !!copy.privacy };
  }

  /**
   * Generate a starter site at a location (from geocoding or a map click) and make it active. Pulls the real OSM
   * data around the point — building footprints, tagged trees, roads — and turns it into an editable spec; falls
   * back to the heuristic template when the endpoints are unreachable.
   */
  async generate(info: LocationInfo, opts: GenerateOptions = {}): Promise<SiteSpec | null> {
    this.generating.set(true);
    try {
      const k = Math.min(5, Math.max(0.2, opts.scale ?? 1));
      const seed = opts.seed ?? 7;
      const area = opts.area ? { halfE: clampHalf(opts.area.halfE), halfN: clampHalf(opts.area.halfN), rotDeg: opts.area.rotDeg ?? 0 } : { halfE: 250, halfN: 250, rotDeg: 0 };
      let data;
      try {
        data = await this.geo.areaData(info.lat, info.lon, area.halfE, area.halfN, area.rotDeg);
      } catch (e) {
        // never swap in a made-up model: keep what is on screen and say what happened
        this.toast.show(e instanceof Error ? e.message : 'Could not load OpenStreetMap data.');
        return null;
      }
      void k;
      if (data.partial) this.toast.show('Trees and roads could not be loaded (servers busy): buildings only. Regenerate later to add them.');
      const spec = this.specFromZone(info, data.footprints, data.trees, data.structures, area, seed);
      spec.roads = data.roads;
      spec.surfaces = data.surfaces;
      spec.waters = data.waters;
      spec.zone = { lat: info.lat, lon: info.lon, halfE: area.halfE, halfN: area.halfN, ...(area.rotDeg ? { rotDeg: area.rotDeg } : {}) };
      if (opts.areas && opts.areas.length > 1) {
        spec.areas = opts.areas.map((a) => ({ ...a }));
        spec.fillGaps = !!opts.fillGaps;
        if (!opts.fillGaps) keepInsideAreas(spec, opts.areas);
      }
      // regenerating an existing bando keeps its identity
      if (opts.keep) {
        if (opts.keep.id) spec.id = opts.keep.id;
        spec.name = opts.keep.name;
        spec.createdAt = opts.keep.createdAt ?? spec.createdAt;
      }
      // the real ground under the bando (flat when the elevation tiles cannot be had: it can be loaded later)
      let groundNote = '';
      try {
        const r = await this.elevation.fetchBase(spec);
        spec.terrain = { cell: r.dims.cell, half: r.dims.half, base: r.base, strokes: [] };
      } catch {
        groundNote = ' The real ground could not be loaded (offline?): it is flat for now; Terrain → Real ground loads it later.';
      }
      this.applySpec(spec, true);
      this.library.save(spec);
      this.toast.show(
        spec.buildings.length
          ? `Generated “${spec.name}”: ${spec.buildings.length} buildings, ${spec.trees.length} trees.`
          : `No buildings mapped in this area: “${spec.name}” has ${spec.trees.length} trees and ${spec.roads?.length ?? 0} roads. Add buildings in the Model editor.`,
      );
      if (groundNote) this.toast.show(groundNote.trim(), 5000);
      return spec;
    } finally {
      this.generating.set(false);
    }
  }

  async generateFromAddress(address: string, scale = 1): Promise<boolean> {
    const hit = await this.searchOne(address);
    if (!hit) return false;
    return (await this.generate(hit, { scale })) !== null;
  }

  /** Geocode a query into up to `limit` candidate locations (for the Map panel's search list). */
  async search(query: string, limit = 6): Promise<LocationInfo[]> {
    const q = query.trim();
    if (!q) return [];
    try {
      const hits = await this.geo.geocode(q, limit);
      if (!hits.length) {
        this.toast.show('No location found for that search.');
        return [];
      }
      return hits;
    } catch {
      // offline / rate-limited: accept plain "lat, lon" input so the flow still works
      const p = parseLatLng(q);
      if (!p) {
        this.toast.show('Geocoding unreachable (offline?). Enter lat,lon instead.');
        return [];
      }
      const hit = { label: 'Entered position', lat: p[0], lon: p[1] };
      return [hit];
    }
  }

  private async searchOne(address: string): Promise<LocationInfo | null> {
    const hits = await this.search(address, 1);
    return hits[0] ?? null;
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
    const hit = host.groundPoint(host.mainCamera, ((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    if (!hit) return;
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

  /** Commit a site-level draft edit and push it live in one step (Map panel's "Point north"). */
  commitNorth(deg: number): void {
    this.editor.commitSite((s) => {
      s.bearingDeg = ((deg % 360) + 360) % 360;
    });
    this.applyDraft();
  }

  /** Move the take-off pad (and the drone start) to a ground point picked on the 3D scene. */
  setTakeoffAt(x: number, z: number): void {
    this.editor.commitSite((s) => {
      s.droneStart = { x, z };
    });
    // applyDraft -> applySpec -> rebindSite already moves the parked drone to takeoffSpot()
    this.applyDraft();
  }

  /** Store the current active site in the library under its name. */
  saveActive(): void {
    const spec = this.active();
    this.library.save(spec);
    this.toast.show(`Bando “${spec.name}” saved (${this.generatedCount()} in the library). Source: ${this.geo.attribution}.`);
  }

  /** Store the editor draft in the library and make it the active site (the Sites panel's Save). */
  saveDraft(): void {
    const spec = this.editor.snapshot();
    this.library.save(spec);
    this.applySpec(spec, false);
    this.toast.show(`Bando “${spec.name}” saved (${this.library.list().length} in the library). Source: ${this.geo.attribution}.`);
  }

  /** Re-solve the GPS calibration from the active spec's corner landmarks / bearing (after a "Point north"). */
  recalibrate(): void {
    this.calibration.apply(calibrationForSpec(this.active()));
  }

  removeStored(id: string): void {
    this.library.remove(id);
  }

  // ---- bando management (the Bandos panel) ----

  /** Every saved bando, newest first; re-evaluates on any change. */
  readonly bandos = this.library.entries;

  /** Delete a bando; when it is the one on screen the scene goes back to a blank model. */
  remove(id: string): void {
    const wasActive = this.active().id === id;
    this.library.remove(id);
    if (wasActive) this.applySpec(emptySpec(this.active().origin, 'Blank site'), true);
  }

  /** Copy a bando under a new id; returns the copy's id. */
  duplicate(id: string): string | null {
    const copy = this.library.duplicate(id);
    return copy?.id ?? null;
  }

  rename(id: string, name: string): void {
    const n = name.trim();
    if (!n) return;
    this.library.rename(id, n);
    if (this.active().id === id) {
      this.editor.commitSite((s) => {
        s.name = n;
      });
      this.applyDraft();
    }
  }

  /** The stored spec of a bando without activating it (zone, origin ...). */
  peek(id: string): SiteSpec | null {
    return this.library.load(id);
  }

  // ---- internals ----

  /**
   * Turn real OSM data for a zone into an editable spec, laid out exactly like the map: no rotation (site +x = east,
   * +z = south), origin at the zone centre. Each footprint keeps its true outline when it is rectilinear (L, T, U, H
   * shapes ...) or becomes a rectangle along its longest edge otherwise; roads are rotated pads.
   */
  private specFromZone(info: LocationInfo, fps: Footprint[], osmTrees: TreeSpec[], structures: StructureSpec[], area: { halfE: number; halfN: number; rotDeg?: number }, seed: number): SiteSpec {
    const mLat = 111132;
    const mLon = 111320 * Math.cos((info.lat * Math.PI) / 180);
    const buildings: BuildingSpec[] = [];
    for (const f of fps.slice(0, 120)) {
      let la = 0, lo = 0;
      for (const [p, q] of f.ring) { lo += p; la += q; }
      la /= f.ring.length; lo /= f.ring.length;
      const cx = (lo - info.lon) * mLon, cz = -(la - info.lat) * mLat; // centroid, site metres
      const rot = (((f.headingDeg - 90) % 360) + 360) % 360;
      const a = (rot * Math.PI) / 180;
      const cs = Math.cos(a), sn = Math.sin(a);
      const local: Pt[] = f.ring.map(([p, q]) => {
        const dx = (p - lo) * mLon, dz = -(q - la) * mLat;
        return { x: dx * cs + dz * sn, z: -dx * sn + dz * cs };
      });
      const greenhouse = f.type === 'greenhouse';
      let outline = greenhouse ? null : rectilinear(local);
      if (outline && outline.length === 4) outline = null;
      const rc = recentre(outline ?? bboxPoly(local));
      const L = Math.max(3, rc.length), W = Math.max(3, rc.width);
      const pos = { x: cx + rc.shift.x * cs - rc.shift.z * sn, z: cz + rc.shift.x * sn + rc.shift.z * cs };
      const H = Math.min(120, Math.max(2.5, f.heightM ?? 3.2));
      const lev = Math.max(1, Math.min(12, f.levels ?? 1));
      const lh = H / lev;
      const roof: 'gable' | 'flat' = !outline && (/^(hip|gable)/i.test(f.roof ?? '') || lev === 1) && lev === 1 ? 'gable' : 'flat';
      const sides = { n: true, s: true, e: true, w: true };
      const dh = Math.min(lh * 0.8, 3);
      const doors: BuildingSpec['levels'][number]['doors'] = outline ? {} : { s: [{ kind: 'door', c: L / 2, w: Math.min(3, L * 0.3), h: dh }] };
      const wallOpenings: WallOpening[] = [];
      if (outline) {
        const e = edgesOf(rc.poly).sort((p, q) => q.to - q.from - (p.to - p.from))[0];
        if (e) wallOpenings.push(e.axis === 'x' ? { kind: 'door', x: (e.from + e.to) / 2, z: e.at, w: Math.min(3, (e.to - e.from) * 0.3), h: dh } : { kind: 'door', x: e.at, z: (e.from + e.to) / 2, w: Math.min(3, (e.to - e.from) * 0.3), h: dh });
      }
      if (greenhouse) {
        // the arched steel-skeleton greenhouse: a vault tunnel along the longest side
        buildings.push({
          id: uid('b'),
          name: f.name || 'Greenhouse',
          ...(f.name ? { nameFromMap: true as const } : {}),
          pos,
          rotDeg: rot,
          length: Math.max(6, L),
          width: Math.max(3, W),
          frame: 'greenhouse',
          color: '#9ec1b6',
          levels: [{ baseY: 0, height: 2.4, sides: { n: false, s: false, e: false, w: false }, doors: {}, partitions: [], roof: 'vault', roofRise: 0, vaultK: 0.7 }],
        });
        continue;
      }
      const levels = Array.from({ length: lev }, (_, i) => ({
        baseY: i * lh,
        height: lh,
        sides,
        doors: i === 0 ? doors : {},
        ...(outline && i === 0 ? { wallOpenings } : {}),
        partitions: [] as [Vec2, Vec2][],
        roof: i === lev - 1 ? roof : ('none' as const),
        roofRise: i === lev - 1 ? (roof === 'gable' ? Math.min(W * 0.35, 6) : 0.4) : 0,
      }));
      buildings.push({
        id: uid('b'),
        name: f.name || `Building ${buildings.length + 1}`,
        ...(f.name ? { nameFromMap: true as const } : {}),
        pos,
        rotDeg: rot,
        length: L,
        width: W,
        ...(outline ? { footprint: rc.poly } : {}),
        color: '#d7d0bd',
        floorColor: '#a9aaa0',
        levels,
      });
    }
    const inside = (x: number, z: number, pad: number): boolean =>
      buildings.some((b) => {
        const a = (b.rotDeg * Math.PI) / 180;
        const dx = x - b.pos.x, dz = z - b.pos.z;
        const lx = dx * Math.cos(a) + dz * Math.sin(a), lz = -dx * Math.sin(a) + dz * Math.cos(a);
        return Math.abs(lx) < b.length / 2 + pad && Math.abs(lz) < b.width / 2 + pad;
      });
    // take-off pad: the free spot closest to the zone centre
    let sx = 0, sz = 0;
    search: for (let r = 0; r < 300; r += 4) {
      for (let k = 0; k < Math.max(1, Math.round(r / 2)); k++) {
        const ang = (k / Math.max(1, Math.round(r / 2))) * Math.PI * 2;
        const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
        if (!inside(x, z, 6)) { sx = x; sz = z; break search; }
      }
    }
    const spec = emptySpec({ lat: info.lat, lon: info.lon }, info.label || 'New bando');
    spec.buildings = buildings;
    spec.trees = osmTrees.filter((t) => !inside(t.x, t.z, 0));
    spec.structures = structures;
    spec.pads = [{ x: sx, z: sz, w: 6, d: 6, color: '#a9aaa0' }];
    spec.seed = seed;
    spec.extent = Math.max(area.halfE, area.halfN) * 1.5 + 40;
    spec.droneStart = { x: sx, z: sz };
    spec.calibCorners = { p1: { x: -area.halfE, z: -area.halfN }, p2: { x: area.halfE, z: area.halfN } };
    return spec;
  }

  /** The terrain grid the flight paths were last laid on (a new grid re-projects them). */
  private groundGrid: HeightGrid | null = null;

  private applySpec(spec: SiteSpec, resetView: boolean, remember = true): void {
    this.active.set(spec);
    // adopt the spec as the new draft, unless the caller is applying the draft itself (live preview)
    if (!sameSpec(this.editor.draft(), spec)) this.editor.load(spec);
    if (remember) writeStoredId(spec.id);
    setSiteOrigin(spec.origin);
    const ground = siteGround(spec);
    setTakeoff({ ...spec.droneStart, y: ground.start });
    setAutoAlign(!!spec.privacy && !spec.calibration);
    this.scene.startFixed.set(!!spec.privacy); // no real place: flights start on the take-off pad, which stays put
    if (ground.grid !== this.groundGrid) {
      this.groundGrid = ground.grid;
      setActiveGround(ground.grid ? ground.at : null);
    }
    this.calibration.apply(spec.calibration ?? calibrationForSpec(spec)); // the pilot's own alignment wins over the solved one
    if (resetView) this.scene.resetCamera();
    // nothing built yet: the empty world turns slowly; a bando with something in it stands still
    this.scene.autoOrbit.set(isVoidSpec(spec));
    if (this.scene.host) {
      const site = this.scene.host.setSite(spec);
      // the x-ray and the simulator collider point at the old model object graph: re-arm them
      this.scene.rebindSite(site);
    }
    // a saved bando with real ground: its heights come from the cache (or are downloaded again), then the scene is rebuilt
    const base = spec.terrain?.base;
    if (base && !hasTerrainBase(base.key)) {
      void this.elevation.ensure(spec).then((ok) => {
        if (ok && this.active().id === spec.id) this.applySpec(this.active(), false);
      });
    }
  }

  /** Load (or re-load) the real ground under the bando being edited; the pilot's terrain strokes are kept. One undo step. */
  async loadRealGround(): Promise<boolean> {
    try {
      const r = await this.elevation.fetchBase(this.editor.snapshot());
      this.editor.commitSite((s) => {
        s.terrain = { cell: r.dims.cell, half: r.dims.half, base: r.base, strokes: s.terrain?.strokes ?? [] };
      });
      this.applyDraft();
      this.toast.show(`Real ground loaded (${r.base.datum} m above sea level at the centre). ${ELEVATION_ATTRIBUTION}.`);
      return true;
    } catch (e) {
      this.toast.show(`Could not load the real ground: ${e instanceof Error ? e.message : 'network error'}.`);
      return false;
    }
  }

  /** The last solved model/real distance ratio from {@link calibrateFromCorners} (null until a calibration ran). */
  lastCalibrationRatio(): number | null {
    return this.lastRatio;
  }
  private lastRatio: number | null = null;

  /**
   * Solve rotation + shift in one shot from two real landmarks that match the active spec's calibration corners.
   * Stores the corner coordinates back into the spec (so the calibration survives a reload) and applies the solved
   * calibration. Returns false when the input is degenerate (corners too close together).
   */
  calibrateFromCorners(a: GeoPoint, b: GeoPoint): boolean {
    const spec = this.active();
    const k = this.calibration.modelScale() || 1;
    const r = solveCalibration(a, b, { x: spec.calibCorners.p1.x * k, z: spec.calibCorners.p1.z * k }, { x: spec.calibCorners.p2.x * k, z: spec.calibCorners.p2.z * k }, spec.origin);
    if (!r) {
      this.toast.show('The two corners are too close together to solve a rotation.');
      return false;
    }
    this.calibration.apply(r.calibration);
    this.lastRatio = r.distanceRatio;
    this.active.update((s) => ({ ...s, geoCorners: { p1: { lat: a.lat, lon: a.lon }, p2: { lat: b.lat, lon: b.lon } } }));
    this.editor.load(this.active());
    return true;
  }
}

/**
 * Calibration for a spec: sites with stored corner landmarks re-solve rot/dx/dz from them so logged GPS paths fall
 * in place; freshly generated ones start from the model's bearing.
 */
export function calibrationForSpec(spec: SiteSpec): Calibration {
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
