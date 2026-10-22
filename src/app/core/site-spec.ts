/**
 * The site specification: a plain, serialisable description of everything the 3D model is built from — buildings with
 * their dimensions / orientation / openings / rooms, trees and scenery. Nothing here knows about three.js or Google
 * Maps; {@link ../three/site-model} turns a spec into geometry and {@link ../services/site.service} stores specs.
 *
 * Local frame (same as before): X across the main building (+X = east side), Z along it (+Z = south end),
 * origin = centre of the main building. All values in metres unless noted.
 */

import { sanitizeTerrain, type TerrainSpec } from './terrain';

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
  /** Closed (a door leaf / window pane is there, and solid). Default: open, i.e. just the hole. */
  closed?: boolean;
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
  closed?: boolean;
}

/** One storey of a building: a slab at `baseY`, walls up to `baseY + height`, roof on top, interior partitions. */
/** A rectangular opening in a floor slab; on the ground floor `water` fills it with a basin instead. */
export interface VoidSpec {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  water?: boolean;
}

export interface ColumnSpec {
  x: number;
  z: number;
  /** Side (square) or diameter (round), metres. */
  size: number;
  round?: boolean;
}

export type StructureKind = 'chimney' | 'silo' | 'tank' | 'water_tower' | 'lattice_tower' | 'bridge' | 'stairs' | 'ramp' | 'tower_crane' | 'container' | 'car' | 'truck' | 'excavator';

/**
 * A free-standing structure that is not a building: towers (chimney, silo, storage tank, water tower, lattice mast
 * / pylon) and bridges. Towers stand at (x, z); a bridge is centred there and runs along its rotation.
 */
export interface StructureSpec {
  id: string;
  kind: StructureKind;
  name: string;
  x: number;
  z: number;
  /** Rotation about Y in degrees (same convention as buildings). */
  rotDeg: number;
  /** Raised by this many metres (a container on a container, stairs on the first floor). Default 0. */
  y?: number;
  /** Towers: total height. Bridge: deck top above the ground. Stairs / ramp: total rise. Vehicles, container: body height. */
  height: number;
  /** Chimney / silo / tank / water tower: radius. Lattice tower / crane mast: half-width. Bridge, stairs, ramp, container, vehicles: width. */
  size: number;
  /** Bridge, stairs, ramp, container, vehicles: length along its direction. Tower crane: length of the jib. */
  length?: number;
  /** Bridge only: flat beam on piers, or an arch below the deck. */
  style?: 'beam' | 'arch';
  color?: string;
}

/** A free-standing wall or fence on the site (not part of a building). */
export interface WallSpec {
  a: Vec2;
  b: Vec2;
  height: number;
  thick: number;
  color?: string;
}

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
  roof: 'gable' | 'vault' | 'flat' | 'none';
  /** Turn the roof a quarter: the ridge / barrels run across the building instead of along it. */
  roofTurn?: boolean;
  /** Repeat the roof module this many times (3 side-by-side gables, 4 barrels ...). Default 1. */
  roofCount?: number;
  /** Holes in this floor (a stairwell, an atrium) or, on the ground floor, a water basin. Building-local, from the min corner. */
  voids?: VoidSpec[];
  /** Columns standing on this floor, from its slab up to the next one. Building-local, from the min corner. */
  columns?: ColumnSpec[];
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
  /** The frame was turned this many degrees (clockwise): only what lies inside the turned rectangle is used. */
  rotDeg?: number;
}

export interface SiteSpec {
  /** How the pilot aligned the logged paths with this site (pins, compass): kept with the bando so Save / edits do not undo it. */
  calibration?: { rot: number; dx: number; dz: number };
  /** Free-standing walls / fences. */
  walls?: WallSpec[];
  /** Towers and bridges. */
  structures?: StructureSpec[];
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
  /** Ground shape (real elevation + the pilot's strokes). Absent = flat ground at y = 0. */
  terrain?: TerrainSpec;
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
    calibration:
      s.calibration && [s.calibration.rot, s.calibration.dx, s.calibration.dz].every((v) => typeof v === 'number' && isFinite(v))
        ? { rot: s.calibration.rot, dx: s.calibration.dx, dz: s.calibration.dz }
        : undefined,
    zone:
      s.zone && [s.zone.lat, s.zone.lon, s.zone.halfE, s.zone.halfN].every((v) => typeof v === 'number' && isFinite(v))
        ? { lat: s.zone.lat, lon: s.zone.lon, halfE: s.zone.halfE, halfN: s.zone.halfN, ...(typeof s.zone.rotDeg === 'number' && isFinite(s.zone.rotDeg) && s.zone.rotDeg ? { rotDeg: s.zone.rotDeg } : {}) }
        : undefined,
    bearingDeg: typeof s.bearingDeg === 'number' ? s.bearingDeg : 0,
    genScale: typeof s.genScale === 'number' ? s.genScale : 1,
    groundColor: typeof s.groundColor === 'string' ? s.groundColor : '#789b52',
    buildings: s.buildings.filter((b) => b && typeof b.length === 'number') as BuildingSpec[],
    pads: Array.isArray(s.pads) ? (s.pads as PadSpec[]) : [],
    walls: Array.isArray(s.walls) ? (s.walls as WallSpec[]) : [],
    structures: Array.isArray(s.structures) ? (s.structures as StructureSpec[]) : [],
    trees: Array.isArray(s.trees) ? (s.trees as TreeSpec[]) : [],
    seed: typeof s.seed === 'number' ? s.seed : 7,
    extent: typeof s.extent === 'number' ? s.extent : 500,
    droneStart: s.droneStart && typeof s.droneStart.x === 'number' ? s.droneStart : { x: 0, z: 0 },
    terrain: sanitizeTerrain(s.terrain),
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
