import * as THREE from 'three';
import type { Flight } from '../core/models';
import { clamp } from '../core/math';

/** Speed colour: blue (slow) -> red (fast). */
const heat = (t: number): THREE.Color => new THREE.Color().setHSL((1 - clamp(t, 0, 1)) * 0.62, 1, 0.5);
const MAX_POINTS = 1500;

/** The flight paths in the 3D scene: speed-coloured line + points, ground shadow, drop lines, start (green) / end (red). */
export class PathRenderer {
  readonly group = new THREE.Group();
  /** Per flight: what is needed to dim the part already flown as the playhead moves. */
  private readonly tracks: { flight: Flight; step: number; base: Float32Array; attr: THREE.BufferAttribute; shown: number }[] = [];

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
      const line = new THREE.BufferGeometry();
      line.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const colAttr = new THREE.Float32BufferAttribute(col, 3);
      line.setAttribute('color', colAttr);
      this.tracks.push({ flight: f, step, base: new Float32Array(col), attr: colAttr, shown: -1 });
      const shadow = new THREE.BufferGeometry();
      shadow.setAttribute('position', new THREE.Float32BufferAttribute(gnd, 3));
      const drops = new THREE.BufferGeometry();
      drops.setAttribute('position', new THREE.Float32BufferAttribute(drop, 3));
      this.group.add(
        new THREE.Line(line, new THREE.LineBasicMaterial({ vertexColors: true })),
        new THREE.Points(line, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true })),
        new THREE.Line(shadow, new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.4 })),
        new THREE.LineSegments(drops, new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.2 })),
      );
      for (const [p, c] of [[f.loc[0]!, 0x2ecc40], [f.loc[n - 1]!, 0xff3b30]] as const) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ color: c }));
        m.position.set(p.x, p.y, p.z);
        this.group.add(m);
      }
    }
  }

  /**
   * Dim the part of each path that has already been flown (desaturated and darker), so the speed colours stay on what
   * is still ahead and the playhead is easy to find. Cheap: only the vertices between the old and new position change.
   */
  setProgress(): void {
    for (const t of this.tracks) {
      const n = t.base.length / 3;
      const idx = Math.min(n - 1, Math.max(-1, Math.floor(t.flight.cursor / t.step)));
      if (idx === t.shown) continue;
      const from = Math.max(0, Math.min(idx, t.shown < 0 ? 0 : t.shown)), to = Math.max(idx, t.shown, 0);
      const arr = t.attr.array as Float32Array;
      for (let k = from; k <= Math.min(n - 1, to); k++) {
        const r = t.base[k * 3]!, g = t.base[k * 3 + 1]!, b = t.base[k * 3 + 2]!;
        if (k <= idx) {
          const grey = 0.3 * r + 0.59 * g + 0.11 * b;
          arr[k * 3] = (r + (grey - r) * 0.85) * 0.5;
          arr[k * 3 + 1] = (g + (grey - g) * 0.85) * 0.5;
          arr[k * 3 + 2] = (b + (grey - b) * 0.85) * 0.5;
        } else {
          arr[k * 3] = r;
          arr[k * 3 + 1] = g;
          arr[k * 3 + 2] = b;
        }
      }
      t.attr.needsUpdate = true;
      t.shown = idx;
    }
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
