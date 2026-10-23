import { describe, expect, it } from 'vitest';
import { sanitizeLayers } from './layers';
import type { UndergroundSpec } from './site-spec';
import { buildHeights, emptyGrid, heightAt } from './terrain';
import { basementVolume, cutCellsPath, cutMask, floorUnder, newRoom, newTunnel, sectionDrawing, sectionProfile, tunnelAxis, tunnelOutline, volumeSolids } from './underground';

const hill = () => buildHeights({ cell: 1, half: { e: 80, n: 80 }, strokes: [{ op: 'hill', pts: [{ x: 0, z: 0 }], radius: 35, strength: 10 }] }).grid;
const tunnel = (): UndergroundSpec => ({ id: 't', name: 'T', outline: tunnelOutline({ x: -45, z: 0 }, { x: 45, z: 0 }, 4), floor: -0.5, ceiling: 3, shape: 'box', wall: 0.4 });

describe('underground volumes', () => {
  it('cuts the ground only where it passes through the inside: the portals open, the hill stays over the tunnel', () => {
    const g = hill(), v = tunnel();
    const m = cutMask(g, [v]);
    const at = (x: number, z: number): number => m[(z + 80) * g.nx + (x + 80)]!;
    expect(at(-44, 0)).toBe(1); // the west mouth: the ground is between floor and ceiling
    expect(at(44, 0)).toBe(1);
    expect(at(0, 0)).toBe(0); // under the top of the hill: covered
    expect(at(0, 10)).toBe(0); // beside the tunnel: never cut
  });

  it('a point inside the tunnel stands on its floor, above the ceiling it does not', () => {
    const v = tunnel();
    expect(floorUnder([v], 0, 0, 1)).toBe(-0.5);
    expect(floorUnder([v], 0, 0, 5)).toBeNull();
    expect(floorUnder([v], 0, 5, 1)).toBeNull();
    expect(floorUnder([{ ...v, water: 0.3 }], 0, 0, 1)).toBeCloseTo(-0.2);
  });

  it('builds wall and slab boxes around the inside, none across it', () => {
    const v = tunnel();
    const boxes = volumeSolids(v);
    expect(boxes.length).toBeGreaterThan(100);
    const inside = (x: number, y: number, z: number): boolean => boxes.some((b) => x > b[0] && x < b[1] && y > b[2] && y < b[3] && z > b[4] && z < b[5]);
    expect(inside(0, 1.5, 0)).toBe(false); // the inside is free
    expect(inside(0.3, 1.5, 2.1)).toBe(true); // the side wall
    expect(inside(0.5, 3.2, 0.5)).toBe(true); // the ceiling slab
    expect(inside(0.5, -0.7, 0.5)).toBe(true); // the floor slab
  });

  it('makes a tunnel below the ground at its start and finds its axis back; stored values are checked', () => {
    const g = hill();
    const t = newTunnel(g, { x: -45, z: 0 }, { x: 45, z: 0 }, { width: 4, height: 3.5, depth: 1, shape: 'pipe', id: 'n', name: 'New' });
    expect(t.floor).toBeCloseTo(-1, 1);
    expect(t.ceiling - t.floor).toBeCloseTo(3.5);
    const ax = tunnelAxis(t)!;
    expect(ax.width).toBeCloseTo(4);
    expect(ax.a.x).toBeCloseTo(-45);
    const l = sanitizeLayers({ underground: [{ ...t, ceiling: t.floor - 5, shape: 'cave' as never, wall: 99 }, { ...t, outline: [] }] });
    expect(l.underground).toHaveLength(1);
    expect(l.underground![0]!.ceiling).toBeCloseTo(t.floor + 0.8);
    expect(l.underground![0]!.shape).toBe('box');
    expect(l.underground![0]!.wall).toBe(3);
  });
});

describe('side view and basements', () => {
  it('samples the ground along a tunnel, a little past its ends', () => {
    const g = hill();
    const p = sectionProfile(tunnel(), (x, z) => heightAt(g, x, z), 40);
    expect(p.ground).toHaveLength(41);
    expect(Math.max(...p.ground)).toBeGreaterThan(8); // the hill over the middle
    expect(p.ground[0]).toBeLessThan(1); // flat before the mouth
    expect(p.len).toBeGreaterThan(90);
    const room = sectionProfile({ ...tunnel(), outline: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 20 }, { x: 0, z: 20 }] }, () => 0, 10);
    expect(room.len).toBeGreaterThan(20); // along its long side
  });

  it('a basement is a volume from its depth up to the pad', () => {
    const b = { id: 'b', name: 'Hall', pos: { x: 0, z: 0 }, rotDeg: 0, length: 10, width: 6, levels: [], basement: { height: 3 } };
    const v = basementVolume(b, [{ x: -5, z: -3 }, { x: 5, z: -3 }, { x: 5, z: 3 }, { x: -5, z: 3 }], 2)!;
    expect([v.floor, v.ceiling]).toEqual([-1, 2]);
    expect(basementVolume({ ...b, basement: undefined }, [], 0)).toBeNull();
  });
});

describe('editor drawings of underground volumes', () => {
  it('a room sits its depth under the lower corner', () => {
    const r = newRoom({ x: 0, z: 0 }, { x: 10, z: 6 }, (x) => (x > 5 ? 2 : 1), { height: 3, depth: 1, id: 'r', name: 'Room 1' });
    expect(r.floor).toBe(-3);
    expect(r.ceiling).toBe(0);
    expect(r.outline).toHaveLength(4);
  });
  it('the section drawing fits its box and the cut cells make one path', () => {
    const t = newTunnel(null, { x: 0, z: 0 }, { x: 30, z: 0 }, { width: 4, height: 3, depth: 1, shape: 'box', id: 't', name: 'T' });
    const d = sectionDrawing(t, () => 0);
    expect(d.ground.startsWith('M4.0,')).toBe(true);
    expect(d.x0).toBeGreaterThan(4);
    expect(d.x1).toBeLessThan(256);
    expect(d.floor).toBeGreaterThan(d.ceil);
    const g = emptyGrid({ cell: 2, half: { e: 6, n: 6 } });
    const cut = new Uint8Array(g.nx * g.nz);
    cut[1] = 1;
    expect(cutCellsPath(g, cut)).toBe(`M${g.x0 + g.cell - g.cell / 2} ${g.z0 - g.cell / 2}h${g.cell}v${g.cell}h${-g.cell}Z`);
    expect(cutCellsPath(g, null)).toBe('');
  });
});
