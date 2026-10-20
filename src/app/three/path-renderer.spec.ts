import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Vec3 } from '../core/math3d';
import type { Flight } from '../core/models';
import { PathRenderer } from './path-renderer';

const flight = (): Flight => ({
  id: 'f', name: 'f', pts: [], tel: null, live: false, att: null, dur: 10, cursor: 0,
  loc: Array.from({ length: 10 }, (_, i) => new Vec3(i, 2, 0)),
  spd: [0, 2, 4, 6, 8, 10, 10, 8, 6, 4],
} as unknown as Flight);

describe('path progress', () => {
  it('dims the part already flown and restores it when the playhead goes back', () => {
    const f = flight();
    const pr = new PathRenderer(new THREE.Scene());
    pr.rebuild([f], 10);
    const line = pr.group.children[0] as THREE.Line;
    const col = line.geometry.getAttribute('color');
    const base = [col.getX(7), col.getY(7), col.getZ(7)];
    const sat = (i: number): number => Math.max(col.getX(i), col.getY(i), col.getZ(i)) - Math.min(col.getX(i), col.getY(i), col.getZ(i));

    f.cursor = 5;
    pr.setProgress();
    expect(sat(2)).toBeLessThan(sat(7) * 0.4); // flown: nearly grey
    expect(col.getX(2) + col.getY(2) + col.getZ(2)).toBeLessThan(base[0]! + base[1]! + base[2]!); // and darker than the ahead part
    expect([col.getX(7), col.getY(7), col.getZ(7)]).toEqual(base); // ahead: untouched

    f.cursor = 1;
    pr.setProgress();
    expect(sat(3)).toBeCloseTo(sat(7) > 0 ? sat(3) : 0, 5); // 3 is ahead again: full colour
    expect(sat(3)).toBeGreaterThan(0.3);
  });
});
