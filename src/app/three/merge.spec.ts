import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import chiari from '../../../public/library/bandos/chiari-e-forti.json';
import { sanitizeSpec } from '../core/site-spec';
import { buildSiteFromSpec } from './site-model';

const meshes = (o: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  o.traverse((x) => (x as THREE.Mesh).isMesh && out.push(x as THREE.Mesh));
  return out;
};

describe('merged meshes for the flight view', () => {
  const spec = sanitizeSpec(chiari)!;
  const plain = buildSiteFromSpec(spec);
  const merged = buildSiteFromSpec(spec, { merge: true });

  it('draws far fewer meshes, the same shapes in the same place', () => {
    const a = meshes(plain.group).length, b = meshes(merged.group).length;
    expect(b).toBeLessThan(a / 3);
    const box = (g: THREE.Object3D): number[] => new THREE.Box3().setFromObject(g).min.toArray().concat(new THREE.Box3().setFromObject(g).max.toArray());
    box(merged.group).forEach((v, i) => expect(v).toBeCloseTo(box(plain.group)[i]!, 3));
  });

  it('keeps the roofs apart (hide roofs) and the x-ray on meshes that are in the scene', () => {
    expect(meshes(merged.roof).length).toBeGreaterThan(0);
    const inScene = new Set(meshes(merged.group));
    expect(merged.occluders.length).toBeGreaterThan(0);
    expect(merged.occluders.length).toBeLessThan(plain.occluders.length);
    for (const o of merged.occluders) expect(inScene.has(o)).toBe(true);
    // the collider does not change
    expect(merged.collider).toEqual(plain.collider);
  });
});
