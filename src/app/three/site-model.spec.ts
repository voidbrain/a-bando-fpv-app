import * as THREE from 'three';
import { emptySpec, type SiteSpec } from '../core/site-spec';
import { buildSiteFromSpec } from './site-model';
import { Vec3 } from '../core/math3d';

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

describe('roofs sit on top of the walls', () => {
  it('a gable starts at the wall top and its apex is `rise` above it; a vault and a flat roof too', async () => {
    const THREE = await import('three');
    const { buildSiteFromSpec } = await import('./site-model');
    const { emptySpec } = await import('../core/site-spec');
    for (const [roof, up] of [['gable', 3], ['vault', 5.8], ['flat', 0.3]] as const) {
      const s = emptySpec({ lat: 0, lon: 0 }, 't');
      s.buildings = [{ id: 'b', name: 'B', pos: { x: 0, z: 0 }, rotDeg: 0, length: 20, width: 10, levels: [{ baseY: 0, height: 4, sides: { n: true, s: true, e: true, w: true }, roof, roofRise: 3, partitions: [], doors: {} }] }];
      const box = new THREE.Box3().setFromObject(buildSiteFromSpec(s, { bare: true }).roof);
      expect(box.min.y, `${roof} starts at the wall top`).toBeCloseTo(4, 1);
      expect(box.max.y - 4, `${roof} height above the walls`).toBeCloseTo(up, 1);
    }
  });

  it('every building, roof and structure carries a pick tag for the 3D editor', async () => {
    const { buildSiteFromSpec } = await import('./site-model');
    const { emptySpec } = await import('../core/site-spec');
    const s = emptySpec({ lat: 0, lon: 0 }, 't');
    s.buildings = [{ id: 'b', name: 'B', pos: { x: 0, z: 0 }, rotDeg: 0, length: 10, width: 8, levels: [{ baseY: 0, height: 3, sides: { n: true, s: true, e: true, w: true }, roof: 'gable', roofRise: 2, partitions: [], doors: {} }] }];
    s.structures = [{ id: 'st1', kind: 'chimney', name: 'C', x: 20, z: 0, rotDeg: 0, height: 20, size: 1.5 }];
    s.walls = [{ a: { x: -20, z: 0 }, b: { x: -10, z: 0 }, height: 2, thick: 0.3 }];
    const picks: string[] = [];
    buildSiteFromSpec(s, { bare: true }).group.traverse((o) => {
      const p = o.userData['pick'] as { kind: string } | undefined;
      if (p) picks.push(p.kind);
    });
    expect(picks.sort()).toEqual(['building', 'building', 'fence', 'structure']); // the walls group, the roof group, the fence, the chimney
  });
});

/** Regression: a wall with several openings put its pieces at the wrong lengths, so slabs stuck out past the building. */
describe('walls with several openings', () => {
  it('stay inside the building outline', () => {
    const s = emptySpec({ lat: 45, lon: 12 }, 'T');
    s.buildings = [{ id: 'b', name: 'B', pos: { x: 0, z: 0 }, rotDeg: 0, length: 30, width: 12, levels: [{ baseY: 0, height: 5, sides: { n: true, s: true, e: true, w: true }, doors: { n: [{ kind: 'door', c: 5, w: 3, h: 4 }, { kind: 'door', c: 15, w: 3, h: 4 }, { kind: 'window', c: 25, w: 3, h: 1.5, sill: 1 }] }, partitions: [], roof: 'flat', roofRise: 0 }] }];
    s.trees = [];
    s.pads = [];
    const box = new THREE.Box3().setFromObject(buildSiteFromSpec(s, { bare: true }).group);
    expect(box.min.x).toBeGreaterThan(-15.6);
    expect(box.max.x).toBeLessThan(15.6);
    expect(box.min.z).toBeGreaterThan(-6.6);
    expect(box.max.z).toBeLessThan(6.6);
  });
});

describe('site model on a terrain', () => {
  const hilly = (): SiteSpec => {
    const s = spec();
    s.terrain = { cell: 1, half: { e: 120, n: 120 }, strokes: [{ op: 'hill', pts: [{ x: 60, z: 20 }], radius: 40, strength: 8 }, { op: 'hill', pts: [{ x: -30, z: -30 }], radius: 20, strength: 5 }] };
    s.walls = [{ a: { x: 40, z: -10 }, b: { x: 80, z: -10 }, height: 2, thick: 0.3 }];
    s.trees = [{ x: 70, z: 40, h: 8, r: 2, kind: 'd' }];
    return s;
  };

  it('builds one terrain mesh and keeps the flat ground for sites without terrain', () => {
    const flatSite = buildSiteFromSpec(spec());
    expect(flatSite.ground.grid).toBeNull();
    const m = buildSiteFromSpec(hilly());
    expect(m.ground.grid).not.toBeNull();
    let terrain = 0;
    m.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry.getAttribute('color') && o.geometry.index && o.geometry.index.count > 100_000) terrain++;
    });
    expect(terrain).toBe(1);
  });

  it('lifts buildings, structures, walls and trees onto the ground, colliders included', () => {
    const m = buildSiteFromSpec(hilly());
    const by = m.ground.building.get('b')!;
    expect(by).toBeGreaterThan(2);
    let building: THREE.Object3D | null = null;
    m.group.traverse((o) => {
      if ((o.userData['pick'] as { id?: string } | undefined)?.id === 'b' && o.parent === m.group) building = o;
    });
    expect((building as THREE.Object3D | null)?.position.y).toBeCloseTo(by);
    // the building's walls are solid above its pad, not at y = 0
    expect(m.collider.hit(new Vec3(60, by + 2, 20 - 5))).toBe(true);
    expect(m.collider.hit(new Vec3(60, 1, 20 - 5))).toBe(false);
    // chimney on its own hill: solid well above the old ground level
    const cy = m.ground.at(-30, -30);
    expect(m.collider.hit(new Vec3(-30, cy + 25, -30))).toBe(true);
    // tree: solid above its own ground, not below it
    const ty = m.ground.at(70, 40);
    expect(m.collider.hit(new Vec3(70, ty + 3, 40))).toBe(true);
    expect(m.collider.groundAt(70, 40)).toBeCloseTo(ty);
  });
});

describe('site model ground layers', () => {
  it('draws roads, surfaces and water, flat or on a terrain', () => {
    for (const withTerrain of [false, true]) {
      const s = spec();
      s.roads = [{ pts: [{ x: -80, z: 50 }, { x: 0, z: 60 }, { x: 80, z: 50 }], width: 6, kind: 'road' }];
      s.surfaces = [{ pts: [{ x: 70, z: -70 }, { x: 100, z: -70 }, { x: 100, z: -40 }, { x: 70, z: -40 }], kind: 'sand' }];
      s.waters = [{ pts: [{ x: -100, z: -100 }, { x: -70, z: -100 }, { x: -70, z: -70 }, { x: -100, z: -70 }], depth: 2 }];
      if (withTerrain) s.terrain = { cell: 1, half: { e: 120, n: 120 }, strokes: [] };
      const m = buildSiteFromSpec(s);
      let water = 0;
      m.group.traverse((o) => {
        if ((o.userData['pick'] as { kind?: string } | undefined)?.kind === 'water') water++;
      });
      expect(water).toBe(1);
      expect(m.collider.waterAt(-85, -85)).not.toBeNull();
      if (withTerrain) expect(m.ground.at(-85, -85)).toBeLessThan(m.collider.waterAt(-85, -85)!);
    }
  });
});

describe('site model underground', () => {
  it('cuts the terrain at a tunnel mouth, builds its walls, and the drone floor inside is the tunnel floor', () => {
    const s = spec();
    s.buildings = [];
    s.structures = [];
    s.terrain = { cell: 1, half: { e: 120, n: 120 }, strokes: [{ op: 'hill', pts: [{ x: 0, z: -60 }], radius: 35, strength: 10 }] };
    const outline = [{ x: -45, z: -62 }, { x: 45, z: -62 }, { x: 45, z: -58 }, { x: -45, z: -58 }];
    const flatTris = (): number => {
      let n = 0;
      buildSiteFromSpec(s).group.traverse((o) => {
        if (o instanceof THREE.Mesh && o.geometry.getAttribute('color') && o.geometry.index) n = o.geometry.index.count;
      });
      return n;
    };
    const before = flatTris();
    s.underground = [{ id: 'u', name: 'Tunnel', outline, floor: -0.5, ceiling: 3, shape: 'box', wall: 0.4 }];
    const m = buildSiteFromSpec(s);
    expect(flatTris()).toBeLessThan(before); // the portals are holes in the ground
    let found = false;
    m.group.traverse((o) => {
      if ((o.userData['pick'] as { kind?: string } | undefined)?.kind === 'underground') found = true;
    });
    expect(found).toBe(true);
    expect(m.collider.groundAt(0, -60)).toBeGreaterThan(8); // on top of the hill
    expect(m.collider.groundAt(0, -60, 1)).toBeCloseTo(-0.5); // inside the tunnel
    expect(m.collider.hit(new Vec3(0.3, 1.5, -58))).toBe(true); // its wall
    expect(m.collider.hit(new Vec3(0.3, 1.5, -60))).toBe(false); // its inside
  });
});
