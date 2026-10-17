/**
 * The site specification: a plain, serialisable description of everything the 3D model is built from — buildings with
 * their dimensions / orientation / openings / rooms, trees and scenery. Nothing here knows about three.js or Google
 * Maps; {@link ../three/site-model} turns a spec into geometry and {@link ../services/site.service} stores specs.
 *
 * Local frame (same as before): X across the main building (+X = east side), Z along it (+Z = south end),
 * origin = centre of the main building. All values in metres unless noted.
 */

export interface Vec2 {
  x: number;
  z: number;
}

/** A door or window punched in a wall. `c` = centre along the wall, `w` = width, `h` = height above ground. */
export interface OpeningSpec {
  kind: 'door' | 'window';
  c: number;
  w: number;
  /** Height of the opening itself. */
  h: number;
  /** Windows: height of the bottom edge above the floor (doors always start at the floor). Default 75 % of the wall. */
  sill?: number;
}

/**
 * An opening in a shaped (non-rectangular) building: the centre point on a wall, in building-centred metres. The wall
 * is found geometrically, so openings survive reshaping the footprint as long as their wall still exists.
 */
export interface WallOpening {
  kind: 'door' | 'window';
  x: number;
  z: number;
  w: number;
  h: number;
  sill?: number;
}

/** One storey of a building: a slab at `baseY`, walls up to `baseY + height`, roof on top, interior partitions. */
export interface LevelSpec {
  /** Floor / ceiling slab at this height (the ground floor sits at 0). */
  baseY: number;
  /** Wall height of this level. */
  height: number;
  /** Walls to draw (and make solid) on each side of the footprint. */
  sides: Record<'n' | 's' | 'e' | 'w', boolean>;
  /** Openings per side, positions measured along that side (from its min corner). */
  doors: Partial<Record<'n' | 's' | 'e' | 'w', OpeningSpec[]>>;
  /** Openings of a shaped building ({@link BuildingSpec.footprint}); rectangular buildings use `doors`. */
  wallOpenings?: WallOpening[];
  /** Interior partition walls (solid, no openings): segment endpoints in building-local metres. */
  partitions: [Vec2, Vec2][];
  /** 'gable' = pitched roof over the long axis, 'vault' = barrel vault(s), 'flat' = parapet slab. */
  roof: 'gable' | 'vault' | 'flat';
  /** Extra rise of the roof above the wall head (ridge / vault rise). */
  roofRise: number;
  /** Barrel vaults: how many across the width. */
  vaultCount?: number;
  /** Vault squash factor (height / radius) — 0.58 for the big shed roofs. */
  vaultK?: number;
  roofColor?: string;
}

export interface BuildingSpec {
  id: string;
  name: string;
  /** Centre of the footprint in site coordinates. */
  pos: Vec2;
  /** Rotation of the footprint about Y, degrees (0 = axes aligned with the site frame). */
  rotDeg: number;
  /** Footprint size: length along local X, depth along local Z. */
  length: number;
  width: number;
  levels: LevelSpec[];
  /**
   * Outline of a shaped building (L, T, U, H ...): a rectilinear polygon in building-centred metres. Absent = plain
   * rectangle of `length` × `width`. Shaped buildings get flat roofs and per-edge walls (see wallOpenings).
   */
  footprint?: Vec2[];
  color?: string;
  floorColor?: string;
  /** Greenhouse-style thin steel frame instead of masonry walls (walls ignored). */
  frame?: 'greenhouse';
}

export interface TreeSpec {
  x: number;
  z: number;
  h: number;
  r: number;
  kind: 'd' | 'c';
}

export interface PadSpec {
  x: number;
  z: number;
  w: number;
  d: number;
  /** Rotation about Y in degrees (roads along a map bearing); default 0. */
  rotDeg?: number;
  color?: string;
}

/** A rectangular map area: centre and half extents (metres) east-west / north-south. */
export interface ZoneSpec {
  lat: number;
  lon: number;
  halfE: number;
  halfN: number;
}

export interface SiteSpec {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  /** Geographic centre of the model (drives the map background, geocoding and GPS calibration). */
  origin: { lat: number; lon: number };
  /** Heading of the model's +X axis, degrees clockwise from true north (set by "Point north" or the map alignment). */
  bearingDeg: number;
  /** The map zone the model was generated from (centre + half extents in metres, east/north), so it can be re-edited. */
  zone?: ZoneSpec;
  /** Overall multiplier applied to every dimension when generating (kept so regeneration is reproducible). */
  genScale: number;
  groundColor: string;
  buildings: BuildingSpec[];
  pads: PadSpec[];
  trees: TreeSpec[];
  /** Deterministic seed of the tree scatter. */
  seed: number;
  /** Radius of the grass plane around the site. */
  extent: number;
  /** Take-off pad position in site metres (scaled with the model). */
  droneStart: Vec2;
  /** Two landmarks used to fit logged GPS paths onto the model (model corners ↔ real corners). */
  calibCorners: { p1: { x: number; z: number }; p2: { x: number; z: number } };
  /** The same two landmarks as real coordinates, so calibration survives loading a stored site. */
  geoCorners?: { p1: { lat: number; lon: number }; p2: { lat: number; lon: number } };
}

/** Rectangular room inside a building, building-local metres (before rotation). */
export interface RoomRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export const ROOM_TOL = 1.2;

/** Rooms a vertical slice at local coordinate `v` passes through (used by the indoor x-ray). */
export function roomsAt(b: BuildingSpec, level: number, v: number): RoomRect[] {
  const l = b.levels[level];
  if (!l) return [];
  const out: RoomRect[] = [];
  const add = (r: RoomRect): void => {
    if (r.x1 - r.x0 > ROOM_TOL && r.z1 - r.z0 > ROOM_TOL) out.push(r);
  };
  // cut every partition pair plus the outer shell
  const xs = [0, b.length, ...l.partitions.flatMap(([a, c]) => [a.x, c.x])].sort((p, q) => p - q);
  const zs = [0, b.width, ...l.partitions.flatMap(([a, c]) => [a.z, c.z])].sort((p, q) => p - q);
  for (let i = 0; i < xs.length - 1; i++) {
    if (xs[i] === xs[i + 1]) continue;
    for (const seg of l.partitions) {
      const [a, c] = seg;
      const vertical = Math.abs(a.x - c.x) < 0.01;
      const lo = Math.min(a.z, c.z), hi = Math.max(a.z, c.z);
      if (vertical && a.x >= xs[i] - 0.01 && a.x <= xs[i + 1] + 0.01 && lo <= v && hi >= v) {
        // split this strip at the crossing horizontal walls
        const cuts = l.partitions
          .filter(([p, q]) => Math.abs(p.z - q.z) < 0.01 && p.z > lo + 0.01 && p.z < hi - 0.01 && Math.min(p.x, q.x) <= xs[i + 1] && Math.max(p.x, q.x) >= xs[i])
          .map(([p]) => p.z)
          .sort((p, q) => p - q);
        let prev = lo;
        for (const cu of [...cuts, hi]) {
          add({ x0: xs[i], z0: prev, x1: xs[i + 1], z1: cu });
          prev = cu;
        }
      }
    }
  }
  return out;
}

/** Is the site point (x, z) inside the footprint of `b`? Returns the building-local coordinates too. */
export function pointInBuilding(b: BuildingSpec, x: number, z: number): { lx: number; lz: number } | null {
  const dx = x - b.pos.x, dz = z - b.pos.z;
  const a = (-b.rotDeg * Math.PI) / 180;
  const lx = dx * Math.cos(a) - dz * Math.sin(a) + b.length / 2;
  const lz = dx * Math.sin(a) + dz * Math.cos(a) + b.width / 2;
  return lx >= -0.5 && lx <= b.length + 0.5 && lz >= -0.5 && lz <= b.width + 0.5 ? { lx, lz } : null;
}

/** The rooms around a world point (for the x-ray "reveal the room you are in"). */
export function enclosingRooms(spec: SiteSpec, x: number, z: number, y: number): RoomRect[] {
  for (const b of spec.buildings) {
    const p = pointInBuilding(b, x, z);
    if (!p) continue;
    for (let li = 0; li < b.levels.length; li++) {
      const l = b.levels[li];
      if (y >= l.baseY - 0.5 && y <= l.baseY + l.height + 0.5) return roomsAt(b, li, p.lz);
    }
  }
  return [];
}

// ---- generation from a location (Google Maps click / geocoded address) -------------------------------

export interface LocationInfo {
  label: string;
  lat: number;
  lon: number;
  /** Best guess of the dominant building footprint, metres (from OSM data when available). */
  footprintLength?: number;
  footprintWidth?: number;
  /** Orientation of that footprint, degrees clockwise from north. */
  footprintHeading?: number;
}

const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Park-Miller generator: the tree layout depends on its exact sequence, so it is part of the spec definition. */
export function createRandom(seed = 7): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function uid(prefix = 'site'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * A blank canvas at `origin`: no buildings, just a take-off pad on open ground. This is what the app starts with —
 * every model comes from generating a site from a real location (OSM data) or from the user's own edits.
 */
export function emptySpec(origin: { lat: number; lon: number } = { lat: 0, lon: 0 }, name = 'Empty site'): SiteSpec {
  return {
    version: 1,
    id: uid(),
    name,
    createdAt: Date.now(),
    origin: { lat: origin.lat, lon: origin.lon },
    bearingDeg: 0,
    genScale: 1,
    groundColor: '#789b52',
    buildings: [],
    pads: [{ x: -14, z: 0, w: 12, d: 12, color: '#a9aaa0' }],
    trees: [],
    seed: 7,
    extent: 220,
    droneStart: { x: -14, z: 0 },
    calibCorners: { p1: { x: -60, z: -60 }, p2: { x: 60, z: 60 } },
  };
}

/**
 * Generate a starter site from a location when no OSM footprint data is available: one main building sized from the
 * footprint guess (or a plausible default), a take-off pad in front of it and a seeded tree ring. No annex /
 * greenhouse attached — everything else comes from the real data or the editor.
 */
export function generateSite(info: LocationInfo, opts: { scale?: number; seed?: number } = {}): SiteSpec {
  const k = clampNum(opts.scale ?? 1, 0.2, 5);
  const BL = clampNum((info.footprintLength ?? 120) * k, 30, 400);
  const BW = clampNum((info.footprintWidth ?? BL * 0.36) * k, 12, BL * 0.9);
  const EH = clampNum(BW * 0.105, 3.5, 12);
  const rnd = createRandom(opts.seed ?? 7);

  const vaultCount = Math.max(1, Math.round(BW / 13.75));
  const nb = Math.max(6, Math.round(BL / 6.6));
  const bay = BL / nb;
  const westDoors: OpeningSpec[] = [];
  for (let i = 1; i < nb; i++) {
    if (i % 3 === 2) westDoors.push({ kind: 'door', c: (i + 0.5) * bay, w: Math.min(bay - 1, 6), h: EH * 0.85 });
  }
  const main: BuildingSpec = {
    id: 'main',
    name: info.label || 'Main building',
    pos: { x: 0, z: 0 },
    rotDeg: 0,
    length: BW,
    width: BL,
    color: '#d7d0bd',
    floorColor: '#a9aaa0',
    levels: [
      {
        baseY: 0,
        height: EH,
        sides: { n: true, s: true, e: true, w: true },
        doors: {
          w: westDoors,
          e: [{ kind: 'door', c: BL / 2, w: 4, h: Math.min(5, EH * 0.8) }],
          n: [{ kind: 'door', c: BW / 2, w: 3, h: Math.min(4, EH * 0.7) }],
        },
        partitions: [],
        roof: 'vault',
        roofRise: (BW / vaultCount / 2) * 0.58,
        vaultCount,
        vaultK: 0.58,
        roofColor: '#b5683f',
      },
    ],
  };

  // scattered trees: a ring outside the buildings, denser where nothing stands
  const trees: TreeSpec[] = [];
  const R = Math.max(BL, BW) * 1.35 + 60;
  const insideAny = (x: number, z: number, pad: number): boolean =>
    [main].some((b) => {
      const p = pointInBuilding(b, x, z);
      return !!p && p.lx > -pad && p.lx < b.length + pad && p.lz > -pad && p.lz < b.width + pad;
    });
  for (let i = 0; i < 420; i++) {
    const ang = rnd() * Math.PI * 2;
    const rad = R * (0.55 + rnd() * 0.75);
    const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
    if (insideAny(x, z, 6)) continue;
    const h = 5 + rnd() * 6, r = 1.6 + rnd() * 1.6;
    trees.push({ x, z, h, r, kind: rnd() < 0.28 ? 'c' : 'd' });
  }

  return {
    version: 1,
    id: uid(),
    name: info.label || 'New site',
    createdAt: Date.now(),
    origin: { lat: info.lat, lon: info.lon },
    bearingDeg: info.footprintHeading ?? 0,
    genScale: k,
    groundColor: '#789b52',
    buildings: [main],
    pads: [
      { x: -BW * 0.82, z: BL * 0.19, w: Math.min(34, BW * 0.62), d: Math.min(94, BL * 0.62), color: '#a9aaa0' },
      { x: 0, z: BL / 2 + 12, w: BW * 6.5, d: 7, color: '#4a4d4b' },
    ],
    trees,
    seed: opts.seed ?? 7,
    extent: R * 1.9,
    droneStart: { x: -BW * 0.8, z: BL * 0.17 },
    calibCorners: { p1: { x: main.pos.x - BW / 2, z: main.pos.z - BL / 2 }, p2: { x: main.pos.x + BW / 2, z: main.pos.z + BL / 2 } },
  };
}

/** Keep only the fields we understand (localStorage content may be old or corrupt). */
export function sanitizeSpec(raw: unknown): SiteSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<SiteSpec>;
  if (typeof s.id !== 'string' || !Array.isArray(s.buildings) || !s.origin || typeof s.origin.lat !== 'number') return null;
  return {
    version: 1,
    id: s.id,
    name: typeof s.name === 'string' ? s.name : 'Site',
    createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
    origin: { lat: s.origin.lat, lon: typeof s.origin.lon === 'number' ? s.origin.lon : 0 },
    zone:
      s.zone && [s.zone.lat, s.zone.lon, s.zone.halfE, s.zone.halfN].every((v) => typeof v === 'number' && isFinite(v))
        ? { lat: s.zone.lat, lon: s.zone.lon, halfE: s.zone.halfE, halfN: s.zone.halfN }
        : undefined,
    bearingDeg: typeof s.bearingDeg === 'number' ? s.bearingDeg : 0,
    genScale: typeof s.genScale === 'number' ? s.genScale : 1,
    groundColor: typeof s.groundColor === 'string' ? s.groundColor : '#789b52',
    buildings: s.buildings.filter((b) => b && typeof b.length === 'number') as BuildingSpec[],
    pads: Array.isArray(s.pads) ? (s.pads as PadSpec[]) : [],
    trees: Array.isArray(s.trees) ? (s.trees as TreeSpec[]) : [],
    seed: typeof s.seed === 'number' ? s.seed : 7,
    extent: typeof s.extent === 'number' ? s.extent : 500,
    droneStart: s.droneStart && typeof s.droneStart.x === 'number' ? s.droneStart : { x: 0, z: 0 },
    calibCorners: s.calibCorners ?? { p1: { x: -100, z: -100 }, p2: { x: 100, z: 100 } },
    geoCorners:
      s.geoCorners && typeof s.geoCorners.p1?.lat === 'number' && typeof s.geoCorners.p2?.lat === 'number'
        ? { p1: { lat: s.geoCorners.p1.lat, lon: s.geoCorners.p1.lon }, p2: { lat: s.geoCorners.p2.lat, lon: s.geoCorners.p2.lon } }
        : undefined,
  };
}

/** Deep copy of a spec (the editor mutates a draft; commit replaces the active spec with a clone). */
export function cloneSpec(spec: SiteSpec): SiteSpec {
  return JSON.parse(JSON.stringify(spec)) as SiteSpec;
}
