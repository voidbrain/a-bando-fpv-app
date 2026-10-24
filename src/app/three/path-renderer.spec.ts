import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Vec3 } from '../core/math3d';
import type { Flight } from '../core/models';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { PathRenderer, aheadColor } from './path-renderer';

const flight = (): Flight => ({
  id: 'f', name: 'f', pts: [], tel: null, live: false, att: null, dur: 10, cursor: 0,
  loc: Array.from({ length: 10 }, (_, i) => new Vec3(i, 2, 0)),
  spd: [0, 2, 4, 6, 8, 10, 10, 8, 6, 4],
} as unknown as Flight);

describe('path progress', () => {
  it('washes out the path ahead and draws the flown part thick, up to the playhead and back', () => {
    const f = flight();
    const pr = new PathRenderer(new THREE.Scene());
    pr.rebuild([f], 10);
    const line = pr.group.children[0] as THREE.Line;
    const col = line.geometry.getAttribute('color');
    const sat = (i: number): number => Math.max(col.getX(i), col.getY(i), col.getZ(i)) - Math.min(col.getX(i), col.getY(i), col.getZ(i));
    expect(sat(5)).toBeLessThan(0.3); // ahead: pale, nearly grey
    expect(pr.group.children.some((o) => o instanceof Line2)).toBe(true);
    expect(pr.flownSegments()).toEqual([0]);

    f.cursor = 5;
    pr.setProgress();
    expect(pr.flownSegments()).toEqual([5]);
    f.cursor = 1;
    pr.setProgress();
    expect(pr.flownSegments()).toEqual([1]);
    f.cursor = 99;
    pr.setProgress();
    expect(pr.flownSegments()).toEqual([9]); // never past the last segment
  });

  it('the washed-out colour is lighter and greyer than the speed colour', () => {
    const [r, g, b] = aheadColor(1, 0, 0);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.3);
    expect(r).toBeGreaterThan(g);
  });
});
