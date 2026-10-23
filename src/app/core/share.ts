/**
 * Sharing a bando. A shared copy keeps its exact place or hides it; a bando whose place is already hidden is always
 * shared hidden (its origin is 0, 0: an "exact" copy would claim a place that is not its own). Hidden, the things that
 * give the place away go (the map area, the GPS landmarks, the pilot's alignment, the height above sea
 * level), and the real ground, which could otherwise be downloaded again only from the coordinates, travels inside the
 * file. A flight loaded into such a bando starts on its take-off pad. Pure.
 */
import { cloneSpec, uid, type SiteSpec, type StructureKind, type Vec2 } from './site-spec';

export type Privacy = 'exact' | 'hidden';

/** Heights in decimetres as little-endian Int16, base64: 600 × 600 m at 1 m ≈ 1 MB of text. */
export function encodeHeights(h: Float32Array): string {
  const out = new Int16Array(h.length);
  for (let i = 0; i < h.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(h[i]! * 10)));
  const bytes = new Uint8Array(out.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The inverse of {@link encodeHeights}; null when the text is not `n` heights. */
export function decodeHeights(text: string, n: number): Float32Array | null {
  let bin: string;
  try {
    bin = atob(text);
  } catch {
    return null;
  }
  if (bin.length !== n * 2) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const v = new Int16Array(bytes.buffer);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = v[i]! / 10;
  return out;
}

/** The plain name of a structure kind, for a copy that must not carry names from the map. */
const GENERIC_NAME: Partial<Record<StructureKind, string>> = {
  bridge: 'Bridge', stairs: 'Steps', chimney: 'Chimney', silo: 'Silo', tank: 'Tank', water_tower: 'Water tower', lattice_tower: 'Lattice tower', ramp: 'Ramp', tower_crane: 'Tower crane',
};

/**
 * The copy to put in a file. `heights` = the real ground registered for this bando (if any): a hidden copy carries it,
 * an exact copy does not need to (the receiver downloads it from the coordinates).
 */
export function shareCopy(spec: SiteSpec, privacy: Privacy, heights: Float32Array | null): SiteSpec {
  const s = cloneSpec(spec);
  if (privacy === 'exact' && spec.privacy !== 'hidden') {
    delete s.privacy;
    return s;
  }
  s.privacy = 'hidden';
  s.origin = { lat: 0, lon: 0 };
  delete s.zone;
  delete s.areas;
  delete s.geoCorners;
  delete s.calibration;
  // names from the map data give the place away (a street, a shop): back to plain names. Bridges and steps are named
  // after the road they carry, so they always are (bandos made before the names were marked included).
  s.buildings.forEach((b, i) => {
    if (b.nameFromMap) b.name = b.frame ? 'Greenhouse' : `Building ${i + 1}`;
    delete b.nameFromMap;
  });
  for (const st of s.structures ?? []) {
    if (st.nameFromMap || st.kind === 'bridge' || st.kind === 'stairs') st.name = GENERIC_NAME[st.kind] ?? 'Structure';
    delete st.nameFromMap;
  }
  if (s.terrain?.base) {
    if (heights) s.terrain.base = { source: 'embedded', key: `embedded:${uid('t')}`, fetchedAt: 0, datum: 0, data: encodeHeights(heights) };
    else delete s.terrain.base; // nothing to carry: the shape of the strokes stays, on flat ground
  }
  return s;
}

/** How far to move a flight so that its first fix (model metres) lands on the take-off pad. */
export function alignShift(first: Vec2, start: Vec2): { dx: number; dz: number } {
  return { dx: start.x - first.x, dz: start.z - first.z };
}
