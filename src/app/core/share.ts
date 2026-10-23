/**
 * Sharing a bando. A shared copy can keep its exact place, round it (to ~1 km) or hide it. Hidden or rounded, the
 * things that give the place away go (the map area, the GPS landmarks, the pilot's alignment, the height above sea
 * level), and the real ground, which could otherwise be downloaded again only from the coordinates, travels inside the
 * file. A flight loaded into such a bando starts on its take-off pad. Pure.
 */
import { cloneSpec, uid, type SiteSpec, type Vec2 } from './site-spec';

export type Privacy = 'exact' | 'rounded' | 'hidden';

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

/**
 * The copy to put in a file. `heights` = the real ground registered for this bando (if any): a hidden / rounded copy
 * carries it, an exact copy does not need to (the receiver downloads it from the coordinates).
 */
export function shareCopy(spec: SiteSpec, privacy: Privacy, heights: Float32Array | null): SiteSpec {
  const s = cloneSpec(spec);
  if (privacy === 'exact') {
    delete s.privacy;
    return s;
  }
  s.privacy = privacy;
  s.origin = privacy === 'hidden' ? { lat: 0, lon: 0 } : { lat: Math.round(s.origin.lat * 100) / 100, lon: Math.round(s.origin.lon * 100) / 100 };
  delete s.zone;
  delete s.areas;
  delete s.geoCorners;
  delete s.calibration;
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
