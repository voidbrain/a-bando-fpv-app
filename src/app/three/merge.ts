import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Fewer draw calls for the flight view: the plain meshes of one building (or structure, or roof) that share a material
 * and shadow flags become one mesh, in that unit's own frame. Instanced, transparent and multi-material meshes stay as
 * they are. Returns which merged mesh replaced each original one (so the x-ray fades the merged mesh instead).
 */
export function mergeUnit(unit: THREE.Object3D): Map<THREE.Mesh, THREE.Mesh> {
  const replaced = new Map<THREE.Mesh, THREE.Mesh>();
  unit.updateMatrixWorld(true);
  const toUnit = new THREE.Matrix4().copy(unit.matrixWorld).invert();
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; receive: boolean; meshes: THREE.Mesh[] }>();
  unit.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material) || m.material.transparent || !m.visible) return;
    if (!m.geometry.getAttribute('position')) return;
    const key = `${m.material.uuid}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}`;
    const b = buckets.get(key) ?? { mat: m.material, cast: m.castShadow, receive: m.receiveShadow, meshes: [] };
    b.meshes.push(m);
    buckets.set(key, b);
  });
  for (const b of buckets.values()) {
    if (b.meshes.length < 2) continue;
    const geos = b.meshes.map((m) => {
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      g.clearGroups();
      g = g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toUnit, m.matrixWorld));
      return g;
    });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const one = new THREE.Mesh(merged, b.mat);
    one.castShadow = b.cast;
    one.receiveShadow = b.receive;
    one.userData = { ...b.meshes[0]!.userData, merged: b.meshes.length };
    unit.add(one);
    for (const m of b.meshes) {
      m.removeFromParent();
      m.geometry.dispose();
      replaced.set(m, one);
    }
  }
  return replaced;
}
