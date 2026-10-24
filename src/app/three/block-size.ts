import * as THREE from 'three';
import { placeBlock, type BlockSpec } from '../core/blocks';
import { emptySpec } from '../core/site-spec';
import { buildStructure } from './structures';

const cache = new Map<string, { w: number; d: number; h: number } | null>();

/**
 * How big a block is once placed with its default values: width (east–west), depth and height in metres, measured on
 * the same geometry the scene draws. Null for patterns (they apply to a floor). Remembered per block version.
 */
export function blockSize(b: BlockSpec): { w: number; d: number; h: number } | null {
  const key = `${b.id}@${b.version}`;
  if (cache.has(key)) return cache.get(key)!;
  let out: { w: number; d: number; h: number } | null = null;
  if (b.kind !== 'pattern') {
    const spec = emptySpec({ lat: 0, lon: 0 }, 'size');
    if (placeBlock(spec, b, {}, { x: 0, z: 0 }, 0).placed) {
      const box = new THREE.Box3();
      for (const st of spec.structures ?? []) {
        const o = buildStructure(st).object;
        o.updateMatrixWorld(true);
        box.union(new THREE.Box3().setFromObject(o));
        o.traverse((m) => (m as THREE.Mesh).geometry?.dispose());
      }
      for (const bd of spec.buildings) {
        const top = Math.max(0, ...bd.levels.map((l) => l.baseY + l.height + (l.roof === 'none' || l.roof === 'flat' ? 0 : l.roofRise)));
        const a = (bd.rotDeg * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
        const hw = (bd.length * c + bd.width * s) / 2, hd = (bd.length * s + bd.width * c) / 2;
        box.union(new THREE.Box3(new THREE.Vector3(bd.pos.x - hw, 0, bd.pos.z - hd), new THREE.Vector3(bd.pos.x + hw, top, bd.pos.z + hd)));
      }
      for (const w of spec.walls ?? []) box.union(new THREE.Box3().setFromPoints([new THREE.Vector3(w.a.x, 0, w.a.z), new THREE.Vector3(w.b.x, w.height, w.b.z)]));
      for (const t of spec.trees) box.union(new THREE.Box3(new THREE.Vector3(t.x - t.r, 0, t.z - t.r), new THREE.Vector3(t.x + t.r, t.h, t.z + t.r)));
      if (!box.isEmpty()) {
        const s = box.getSize(new THREE.Vector3());
        out = { w: Math.round(s.x * 10) / 10, d: Math.round(s.z * 10) / 10, h: Math.round(s.y * 10) / 10 };
      }
    }
  }
  cache.set(key, out);
  return out;
}

/** The size as the Library shows it ("6 × 0.5 × 3.2 m"). */
export const sizeText = (s: { w: number; d: number; h: number }): string => `${s.w} × ${s.d} × ${s.h} m`;
