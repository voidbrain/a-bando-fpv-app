import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildPreviewGroup } from './element-preview';
import { addOpening, listOpenings } from '../core/openings';
import type { BuildingSpec } from '../core/site-spec';

const b = (): BuildingSpec => ({
  id: 'b', name: 'B', pos: { x: 200, z: -50 }, rotDeg: 37, length: 20, width: 10,
  levels: [
    { baseY: 0, height: 4, sides: { n: true, s: true, e: true, w: true }, doors: {}, partitions: [[{ x: 10, z: 0 }, { x: 10, z: 10 }]], roof: 'none', roofRise: 0 },
    { baseY: 4, height: 4, sides: { n: true, s: true, e: true, w: true }, doors: {}, partitions: [], roof: 'gable', roofRise: 2 },
  ],
});

const opacities = (g: THREE.Object3D): number[] => {
  const o: number[] = [];
  g.traverse((x) => {
    const m = x as THREE.Mesh;
    if (m.isMesh) o.push((m.material as THREE.Material).opacity);
  });
  return o;
};

describe('inspector 3D preview', () => {
  it('shows a selected building opaque, centred and unrotated', () => {
    const g = buildPreviewGroup({ kind: 'building', b: b() });
    expect(Math.min(...opacities(g))).toBe(1);
    const box = new THREE.Box3().setFromObject(g);
    expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(0, 0);
    expect(box.max.y).toBeGreaterThan(8); // two floors + roof
  });

  it('shows a wall of floor 2 in place, with the rest of the building semi-transparent', () => {
    const bd = b();
    bd.levels[1]!.partitions.push([{ x: 0, z: 5 }, { x: 20, z: 5 }]);
    const g = buildPreviewGroup({ kind: 'part', b: bd, li: 1, part: { t: 'wall', a: { x: 0, z: 5 }, c: { x: 20, z: 5 } } });
    const ops = opacities(g);
    expect(ops.filter((o) => o < 0.3).length).toBeGreaterThan(5); // the ghosted building
    expect(ops.filter((o) => o === 1).length).toBe(1); // the highlighted wall only
    // the highlight stands on floor 2 (y between 4 and 8)
    const hi = g.children[1]!;
    const box = new THREE.Box3().setFromObject(hi);
    expect(box.min.y).toBeGreaterThanOrEqual(3.99);
    expect(box.max.y).toBeLessThanOrEqual(8.01);
  });

  it('shows a window where it is on its wall', () => {
    const bd = b();
    const id = addOpening(bd, 0, { x: 0, z: 5 }, 'window', 2)!;
    const seg = listOpenings(bd, 0).find((o) => o.id === id)!;
    const g = buildPreviewGroup({ kind: 'part', b: bd, li: 0, part: { t: 'opening', seg } });
    const box = new THREE.Box3().setFromObject(g.children[1]!);
    expect(box.getCenter(new THREE.Vector3()).z).toBeCloseTo(5, 1);
    expect(box.min.y).toBeGreaterThan(0.2); // a window sits above the floor
  });

  it('shows a tower or bridge on its own, and a greenhouse frame like any building', () => {
    const tower = buildPreviewGroup({ kind: 'structure', s: { id: 's', kind: 'chimney', name: 'C', x: 300, z: 300, rotDeg: 40, height: 35, size: 1.8 } });
    const tb = new THREE.Box3().setFromObject(tower);
    expect(tb.max.y).toBeCloseTo(35, 0);
    expect(tb.getCenter(new THREE.Vector3()).x).toBeCloseTo(0, 0); // shown at the origin, not at its site position
    const bridge = buildPreviewGroup({ kind: 'structure', s: { id: 'b', kind: 'bridge', name: 'B', x: 0, z: 0, rotDeg: 0, height: 6, size: 8, length: 40, style: 'arch' } });
    expect(new THREE.Box3().setFromObject(bridge).getSize(new THREE.Vector3()).x).toBeGreaterThan(39);
    const gh: BuildingSpec = { id: 'g', name: 'Greenhouse', pos: { x: 5, z: 5 }, rotDeg: 20, length: 30, width: 9, frame: 'greenhouse', levels: [{ baseY: 0, height: 2.4, sides: { n: false, s: false, e: false, w: false }, doors: {}, partitions: [], roof: 'vault', roofRise: 0, vaultK: 0.7 }] };
    const g = new THREE.Box3().setFromObject(buildPreviewGroup({ kind: 'building', b: gh }));
    expect(g.max.y).toBeGreaterThan(3); // the arch rises above the 2.4 m base
    expect(g.getSize(new THREE.Vector3()).x).toBeGreaterThan(29);
  });

  it('shows trees and fences on their own', () => {
    expect(buildPreviewGroup({ kind: 'tree', t: { x: 0, z: 0, h: 9, r: 2, kind: 'd' } }).children.length).toBe(1);
    const f = buildPreviewGroup({ kind: 'fence', w: { a: { x: 0, z: 0 }, b: { x: 10, z: 0 }, height: 2.2, thick: 0.3 } });
    expect(new THREE.Box3().setFromObject(f).getSize(new THREE.Vector3()).x).toBeCloseTo(10, 1);
  });
});
