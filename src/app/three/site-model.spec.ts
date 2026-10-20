import * as THREE from 'three';
import { emptySpec, type SiteSpec } from '../core/site-spec';
import { buildSiteFromSpec } from './site-model';

/** A small but complete site: ground 528 m wide (extent 240), two buildings, a few pads, a tower and a bridge. */
const spec = (): SiteSpec => {
  const s = emptySpec({ lat: 45.5, lon: 12.1 }, 'Test site');
  s.extent = 240;
  const level = { baseY: 0, height: 4, sides: { n: true, s: true, e: true, w: true }, doors: {}, partitions: [], roof: 'gable' as const, roofRise: 2 };
  s.buildings = [
    { id: 'a', name: 'A', pos: { x: 0, z: 0 }, rotDeg: 0, length: 40, width: 14, levels: [{ ...level }] },
    { id: 'b', name: 'B', pos: { x: 60, z: 20 }, rotDeg: 30, length: 18, width: 10, levels: [{ ...level }] },
  ];
  s.pads = [{ x: 0, z: 30, w: 30, d: 8, color: '#555' }, { x: 40, z: -30, w: 12, d: 12 }, { x: -50, z: 10, w: 20, d: 20, rotDeg: 20 }];
  s.structures = [{ id: 't', kind: 'chimney', name: 'C', x: -30, z: -30, rotDeg: 0, height: 30, size: 1.8 }, { id: 'br', kind: 'bridge', name: 'B', x: 20, z: 60, rotDeg: 0, height: 5, size: 7, length: 30 }];
  return s;
};

/**
 * Regression: the meadow patches were once given a draw order BEFORE the ground, so the ground painted over all of them and
 * the terrain looked flat. The ground must come first, then the patches in creation order.
 */
describe('site model terrain', () => {
  const meshes = (): THREE.Mesh[] => {
    const out: THREE.Mesh[] = [];
    buildSiteFromSpec(spec()).group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
    });
    return out;
  };

  it('has the 300 meadow patches of the original', () => {
    expect(meshes().filter((m) => m.geometry.type === 'CircleGeometry').length).toBe(300);
  });

  it('draws the ground before every patch, and the patches in creation order', () => {
    const all = meshes();
    const ground = all.find((m) => m.geometry.type === 'BoxGeometry' && (m.geometry as THREE.BoxGeometry).parameters.width === 528);
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
    const others = all.filter((m) => m.geometry.type !== 'CircleGeometry' && !(m.geometry.type === 'BoxGeometry' && (m.geometry as THREE.BoxGeometry).parameters.width === 528));
    expect(others.length).toBeGreaterThan(20);
    for (const m of others) expect(m.renderOrder).toBeGreaterThan(lastPatch);
  });

  it('builds the same site every time (the tree layout comes from a fixed seed)', () => {
    const a = buildSiteFromSpec(spec()).trees;
    const b = buildSiteFromSpec(spec()).trees;
    expect(a.dec.length).toBe(b.dec.length);
    expect(a.dec[10]).toEqual(b.dec[10]);
  });
});


describe('open and closed doors and windows', () => {
  it('an open door is a hole you can fly through; a closed one is solid; a closed window is solid too', async () => {
    const { buildSiteFromSpec } = await import('./site-model');
    const { emptySpec } = await import('../core/site-spec');
    const { Vec3 } = await import('../core/math3d');
    const mkSpec = (closed: boolean, kind: 'door' | 'window'): ReturnType<typeof emptySpec> => {
      const s = emptySpec({ lat: 0, lon: 0 }, 't');
      s.buildings = [{
        id: 'b', name: 'B', pos: { x: 0, z: 0 }, rotDeg: 0, length: 20, width: 10,
        levels: [{ baseY: 0, height: 4, sides: { n: true, s: true, e: true, w: true }, roof: 'flat', roofRise: 0, partitions: [], doors: { s: [{ kind, c: 10, w: 2, h: 2.2, closed: closed || undefined }] } }],
      }];
      return s;
    };
    const through = new Vec3(0, 1.0, 5); // in the south wall, at the door
    expect(buildSiteFromSpec(mkSpec(false, 'door'), { bare: true }).collider.hit(through)).toBe(false);
    expect(buildSiteFromSpec(mkSpec(true, 'door'), { bare: true }).collider.hit(through)).toBe(true);
    const win = new Vec3(0, 3.5, 5); // the default sill is 3 m, so 3.5 m is inside the window
    expect(buildSiteFromSpec(mkSpec(false, 'window'), { bare: true }).collider.hit(win)).toBe(false);
    expect(buildSiteFromSpec(mkSpec(true, 'window'), { bare: true }).collider.hit(win)).toBe(true);
  });
});


describe('outer walls', () => {
  it('each of the four walls covers its whole side, on a building that is not square', async () => {
    const { buildSiteFromSpec } = await import('./site-model');
    const { emptySpec } = await import('../core/site-spec');
    const s = emptySpec({ lat: 0, lon: 0 }, 't');
    s.buildings = [{
      id: 'b', name: 'B', pos: { x: 0, z: 0 }, rotDeg: 0, length: 30, width: 12,
      levels: [{ baseY: 0, height: 4, sides: { n: true, s: true, e: true, w: true }, roof: 'flat', roofRise: 0, partitions: [], doors: { s: [{ kind: 'door', c: 15, w: 2, h: 2.2 }], w: [{ kind: 'door', c: 6, w: 2, h: 2.2 }] } }],
    }];
    const solids = buildSiteFromSpec(s, { bare: true }).collider.solids.filter((b) => b[2] === 0 && b[3] === 4 || (b[2] === 0 && Math.abs(b[3] - 4) < 0.01) || (b[2] === 2.2));
    const covered = (axis: 'x' | 'z', at: number): number => {
      const pieces = solids.filter((b) => (axis === 'x' ? b[4] < at + 0.3 && b[5] > at - 0.3 && b[1] - b[0] > b[5] - b[4] : b[0] < at + 0.3 && b[1] > at - 0.3 && b[5] - b[4] > b[1] - b[0]));
      return pieces.reduce((n, b) => n + (axis === 'x' ? b[1] - b[0] : b[5] - b[4]), 0);
    };
    expect(covered('x', -6)).toBeCloseTo(30, 1); // north: the whole length
    expect(covered('x', 6)).toBeGreaterThan(27); // south: whole length minus the 2 m door
    expect(covered('z', 15)).toBeCloseTo(12, 1); // east: the whole width
    expect(covered('z', -15)).toBeGreaterThan(9.5); // west: whole width minus the door
  });
});
