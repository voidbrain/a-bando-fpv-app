import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Flight } from '../core/models';
import { clamp } from '../core/math';

/** Speed colour: blue (slow) -> red (fast). */
const heat = (t: number): THREE.Color => new THREE.Color().setHSL((1 - clamp(t, 0, 1)) * 0.62, 1, 0.5);
const MAX_POINTS = 1500;
/** Width of the flown part, screen pixels. */
const FLOWN_WIDTH = 4;

/** The part still ahead: the speed colour washed out towards a light grey, so the flown part stands out. */
export function aheadColor(r: number, g: number, b: number): [number, number, number] {
  const grey = 0.3 * r + 0.59 * g + 0.11 * b;
  const wash = (c: number): number => (c + (grey - c) * 0.75) * 0.55 + 0.7 * 0.45;
  return [wash(r), wash(g), wash(b)];
}

/**
 * The flight paths in the 3D scene: the whole path as a thin washed-out line + points, the part already flown on top of
 * it as a thick line in the speed colours (blue slow → red fast), ground shadow, drop lines, start (green) / end (red).
 */
export class PathRenderer {
  readonly group = new THREE.Group();
  /** Per flight: the thick flown line, drawn up to the playhead. */
  private readonly tracks: { flight: Flight; step: number; flown: LineGeometry; segments: number; shown: number }[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  rebuild(flights: readonly Flight[], speedMax: number): void {
    this.clear();
    this.tracks.length = 0;
    for (const f of flights) {
      const n = f.loc.length;
      if (!n) continue;
      const step = Math.ceil(n / MAX_POINTS);
      const pos: number[] = [], col: number[] = [], gnd: number[] = [], drop: number[] = [];
      for (let i = 0; i < n; i += step) {
        const p = f.loc[i]!;
        const c = heat((f.spd[i] ?? 0) / speedMax);
        pos.push(p.x, p.y, p.z);
        col.push(c.r, c.g, c.b);
        gnd.push(p.x, 0.12, p.z);
        if ((i / step) % 8 === 0) drop.push(p.x, 0.12, p.z, p.x, p.y, p.z);
      }
      const ahead: number[] = [];
      for (let k = 0; k < col.length; k += 3) ahead.push(...aheadColor(col[k]!, col[k + 1]!, col[k + 2]!));
      const line = new THREE.BufferGeometry();
      line.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      line.setAttribute('color', new THREE.Float32BufferAttribute(ahead, 3));
      const flown = new LineGeometry();
      if (pos.length >= 6) {
        flown.setPositions(pos);
        flown.setColors(col);
      }
      flown.instanceCount = 0;
      this.tracks.push({ flight: f, step, flown, segments: Math.max(0, pos.length / 3 - 1), shown: -1 });
      const shadow = new THREE.BufferGeometry();
      shadow.setAttribute('position', new THREE.Float32BufferAttribute(gnd, 3));
      const drops = new THREE.BufferGeometry();
      drops.setAttribute('position', new THREE.Float32BufferAttribute(drop, 3));
      this.group.add(
        new THREE.Line(line, new THREE.LineBasicMaterial({ vertexColors: true })),
        new THREE.Points(line, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true })),
        new THREE.Line(shadow, new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.4 })),
        new THREE.LineSegments(drops, new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.2 })),
        new Line2(flown, new LineMaterial({ vertexColors: true, linewidth: FLOWN_WIDTH, worldUnits: false })),
      );
      for (const [p, c] of [[f.loc[0]!, 0x2ecc40], [f.loc[n - 1]!, 0xff3b30]] as const) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ color: c }));
        m.position.set(p.x, p.y, p.z);
        this.group.add(m);
      }
    }
  }

  /** Draw the thick flown line up to the playhead. Cheap: only the number of drawn segments changes. */
  setProgress(): void {
    for (const t of this.tracks) {
      const idx = Math.min(t.segments, Math.max(0, Math.floor(t.flight.cursor / t.step)));
      if (idx === t.shown) continue;
      t.flown.instanceCount = idx;
      t.shown = idx;
    }
  }

  /** Segments of the flown line drawn now (per flight, for tests). */
  flownSegments(): number[] {
    return this.tracks.map((t) => t.flown.instanceCount);
  }

  private clear(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose();
    });
    this.group.clear();
  }

  dispose(): void {
    this.clear();
  }
}
