import * as THREE from 'three';
import { buildSiteModel } from './site-model';

/**
 * Regression: the meadow patches were once given a draw order BEFORE the ground, so the ground painted over all of them and
 * the terrain looked flat. The ground must come first, then the patches in creation order.
 */
describe('site model terrain', () => {
  const meshes = (): THREE.Mesh[] => {
    const out: THREE.Mesh[] = [];
    buildSiteModel().group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
    });
    return out;
  };

  it('has the 300 meadow patches of the original', () => {
    expect(meshes().filter((m) => m.geometry.type === 'CircleGeometry').length).toBe(300);
  });

  it('draws the ground before every patch, and the patches in creation order', () => {
    const all = meshes();
    const ground = all.find((m) => m.geometry.type === 'BoxGeometry' && (m.geometry as THREE.BoxGeometry).parameters.width === 520);
    const patches = all.filter((m) => m.geometry.type === 'CircleGeometry');
    expect(ground).toBeTruthy();
    for (const p of patches) expect(p.renderOrder).toBeGreaterThan(ground!.renderOrder);
    for (let i = 1; i < patches.length; i++) expect(patches[i]!.renderOrder).toBeGreaterThan(patches[i - 1]!.renderOrder);
  });

  it('patches ignore the depth buffer, so they can neither flicker nor show through concrete, and still receive shadows', () => {
    for (const m of meshes().filter((x) => x.geometry.type === 'CircleGeometry')) {
      const mat = m.material as THREE.MeshStandardMaterial;
      expect(mat.depthWrite).toBe(false);
      expect(mat.depthTest).toBe(false);
      expect(mat.polygonOffset).toBe(false); // polygon offset scales with the viewing slope and leaks patches over concrete at low angles
      expect(m.receiveShadow).toBe(true);
    }
  });

  it('draws every concrete / building mesh after every patch, so the patches are always covered', () => {
    const all = meshes();
    const lastPatch = Math.max(...all.filter((m) => m.geometry.type === 'CircleGeometry').map((m) => m.renderOrder));
    const others = all.filter((m) => m.geometry.type !== 'CircleGeometry' && !(m.geometry.type === 'BoxGeometry' && (m.geometry as THREE.BoxGeometry).parameters.width === 520));
    expect(others.length).toBeGreaterThan(100);
    for (const m of others) expect(m.renderOrder).toBeGreaterThan(lastPatch);
  });

  it('builds the same site every time (the tree layout comes from a fixed seed)', () => {
    const a = buildSiteModel().trees;
    const b = buildSiteModel().trees;
    expect(a.dec.length).toBe(b.dec.length);
    expect(a.dec[10]).toEqual(b.dec[10]);
  });
});
