import type { SiteSpec, ZoneSpec } from './site-spec';

/**
 * Several map areas generated as one bando. The data is fetched once for the rectangle that covers them all
 * ({@link boundingZone}); then either everything in that rectangle is kept ("fill the gaps": the areas are merged into one)
 * or only what lies inside one of the areas ({@link keepInsideAreas}). Pure functions, metres, x east / z south.
 */

const M_LAT = 111132;
const mLon = (lat: number): number => 111320 * Math.cos((lat * Math.PI) / 180);

/** An area's centre in site metres around `origin`, with its half sizes and turn. */
function local(a: ZoneSpec, origin: { lat: number; lon: number }): { cx: number; cz: number; e: number; n: number; r: number } {
  return { cx: (a.lon - origin.lon) * mLon(origin.lat), cz: -(a.lat - origin.lat) * M_LAT, e: a.halfE, n: a.halfN, r: ((a.rotDeg ?? 0) * Math.PI) / 180 };
}

/** The four corners of an area in site metres around `origin`. */
export function areaCorners(a: ZoneSpec, origin: { lat: number; lon: number }): { x: number; z: number }[] {
  const l = local(a, origin), c = Math.cos(l.r), s = Math.sin(l.r);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({ x: l.cx + u! * l.e * c - v! * l.n * s, z: l.cz + u! * l.e * s + v! * l.n * c }));
}

/** The north-up rectangle that covers every area (its centre, and half sizes in metres). */
export function boundingZone(areas: readonly ZoneSpec[]): ZoneSpec {
  const o = areas[0]!;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const a of areas) {
    for (const p of areaCorners(a, o)) {
      x0 = Math.min(x0, p.x);
      z0 = Math.min(z0, p.z);
      x1 = Math.max(x1, p.x);
      z1 = Math.max(z1, p.z);
    }
  }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  return { lat: o.lat - cz / M_LAT, lon: o.lon + cx / mLon(o.lat), halfE: (x1 - x0) / 2, halfN: (z1 - z0) / 2 };
}

/** Is the site point (x, z) inside area `a` (or within `margin` metres of it)? */
export function insideArea(a: ZoneSpec, origin: { lat: number; lon: number }, x: number, z: number, margin = 0): boolean {
  const l = local(a, origin);
  const dx = x - l.cx, dz = z - l.cz;
  const u = dx * Math.cos(l.r) + dz * Math.sin(l.r), v = -dx * Math.sin(l.r) + dz * Math.cos(l.r);
  return Math.abs(u) <= l.e + margin && Math.abs(v) <= l.n + margin;
}

/** Drop the buildings, trees, roads and structures of a generated spec that are outside every area (the gaps). */
export function keepInsideAreas(spec: SiteSpec, areas: readonly ZoneSpec[], margin = 6): void {
  const o = spec.origin;
  const keep = (x: number, z: number): boolean => areas.some((a) => insideArea(a, o, x, z, margin));
  const start = spec.pads[spec.pads.length - 1]; // the take-off pad is always kept
  spec.buildings = spec.buildings.filter((b) => keep(b.pos.x, b.pos.z));
  spec.trees = spec.trees.filter((t) => keep(t.x, t.z));
  spec.structures = (spec.structures ?? []).filter((s) => keep(s.x, s.z));
  spec.pads = spec.pads.filter((p) => p === start || keep(p.x, p.z));
}

/** Two areas framing (almost) the same place: the same one. */
export function sameArea(a: ZoneSpec, b: ZoneSpec): boolean {
  const l = local(b, a);
  return Math.hypot(l.cx, l.cz) < 3 && Math.abs(a.halfE - b.halfE) < 3 && Math.abs(a.halfN - b.halfN) < 3 && Math.abs((a.rotDeg ?? 0) - (b.rotDeg ?? 0)) < 1;
}
