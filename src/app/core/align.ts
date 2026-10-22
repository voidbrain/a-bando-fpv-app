import type { BuildingSpec } from './site-spec';

const rad = (d: number): number => (d * Math.PI) / 180;

/**
 * Move building `b` so it sits flush against building `a`: a small gap (up to `maxGap` m) is closed, an overlap is pushed
 * out along the axis that needs the smaller move, a slightly different angle is straightened to `a`'s axes, and edges
 * that are almost in line (within `edgeTol` m) are lined up. Works on the bounding boxes, so for shaped buildings it
 * aligns the outer box. Returns the distance moved, or null when `b` is not near `a` (nothing changes).
 */
export function snapBeside(a: BuildingSpec, b: BuildingSpec, maxGap = 3, edgeTol = 1.5): number | null {
  const d = (((b.rotDeg - a.rotDeg) % 90) + 90) % 90;
  const dev = Math.min(d, 90 - d);
  const turned = dev > 0.01 && dev <= 10;
  const rot = turned ? a.rotDeg + Math.round((b.rotDeg - a.rotDeg) / 90) * 90 : b.rotDeg;
  if (!turned && dev > 10) return null; // clearly not parallel: leave it
  const q = Math.round((rot - a.rotDeg) / 90) % 2 !== 0;
  const ca = Math.cos(rad(-a.rotDeg)), sa = Math.sin(rad(-a.rotDeg));
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  const c = { x: dx * ca - dz * sa, z: dx * sa + dz * ca }; // b's centre in a's frame
  const ha = { x: a.length / 2, z: a.width / 2 };
  const hb = q ? { x: b.width / 2, z: b.length / 2 } : { x: b.length / 2, z: b.width / 2 };
  const ox = ha.x + hb.x - Math.abs(c.x), oz = ha.z + hb.z - Math.abs(c.z); // >0 overlap, <0 gap
  // pushing out an overlap and closing a gap are the same move: `o` is positive for an overlap, negative for a gap
  const sx = c.x >= 0 ? 1 : -1, sz = c.z >= 0 ? 1 : -1;
  const n = { x: c.x, z: c.z };
  let main: 'x' | 'z';
  if (ox > 0 && oz > 0) main = ox < oz ? 'x' : 'z';
  else if (ox <= 0 && -ox <= maxGap && oz > 0) main = 'x';
  else if (oz <= 0 && -oz <= maxGap && ox > 0) main = 'z';
  else return null;
  if (main === 'x') n.x += sx * ox;
  else n.z += sz * oz;
  // line up almost-aligned edges along the other axis (only while the two still share a wall)
  const other = main === 'x' ? 'z' : 'x';
  const lo = n[other] - hb[other] + ha[other], hi = n[other] + hb[other] - ha[other];
  const adj = Math.abs(lo) <= Math.abs(hi) ? lo : hi;
  if (Math.abs(adj) > 0.001 && Math.abs(adj) <= edgeTol && ha[other] + hb[other] - Math.abs(n[other] - adj) > 0.5) n[other] -= adj;
  const wx = n.x * Math.cos(rad(a.rotDeg)) - n.z * Math.sin(rad(a.rotDeg)) + a.pos.x;
  const wz = n.x * Math.sin(rad(a.rotDeg)) + n.z * Math.cos(rad(a.rotDeg)) + a.pos.z;
  const moved = Math.hypot(wx - b.pos.x, wz - b.pos.z);
  b.pos = { x: Math.round(wx * 100) / 100, z: Math.round(wz * 100) / 100 };
  b.rotDeg = ((rot % 360) + 360) % 360;
  return moved;
}

/** Align a (new) building to every neighbour that is close enough, nearest first. Returns how many it snapped to. */
export function autoAlign(b: BuildingSpec, others: readonly BuildingSpec[], maxGap = 3): number {
  const near = [...others].filter((o) => o.id !== b.id && !o.frame).sort((p, q) => Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z) - Math.hypot(q.pos.x - b.pos.x, q.pos.z - b.pos.z));
  let n = 0;
  for (const o of near.slice(0, 4)) if (snapBeside(o, b, maxGap) !== null) n++;
  return n;
}
