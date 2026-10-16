import * as THREE from 'three';
import type { SiteModel, TreeKind } from './site-model';

interface Faded {
  original: THREE.Material | THREE.Material[];
  faded: THREE.Material;
  value: number;
  castShadow: boolean;
}

/** Distance of point p from the segment a-b. */
export function segmentDistance(a: THREE.Vector3, b: THREE.Vector3, px: number, py: number, pz: number): number {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const l = dx * dx + dy * dy + dz * dz;
  let t = l ? ((px - a.x) * dx + (py - a.y) * dy + (pz - a.z) * dz) / l : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(a.x + dx * t - px, a.y + dy * t - py, a.z + dz * t - pz);
}

/**
 * X-ray: whatever sits between the camera and a tracked drone fades to 12 % opacity (walls, roofs, houses, shrubs) or
 * disappears (trees), and returns when it no longer hides the drone. Three rays per drone (centre and +-1.4 m) so a
 * drone half behind a wall is still revealed. The expensive search runs every second frame; the fade every frame.
 */
export class XRay {
  enabled = true;
  private frame = 0;
  private wanted = new Set<THREE.Mesh>();
  private readonly faded = new Map<THREE.Mesh, Faded>();
  private readonly hiddenTrees = new Set<string>();
  private readonly raycaster = new THREE.Raycaster();

  constructor(private readonly site: SiteModel) {}

  /** `targets` are world positions of drones that must stay visible; `modelScale` is the site's scale. */
  step(dt: number, camera: THREE.Camera, targets: readonly THREE.Vector3[], modelScale: number): void {
    const tg = this.enabled ? targets : [];
    if (++this.frame % 2 === 0) this.search(camera.position, tg, modelScale);
    this.faded.forEach((st, mesh) => {
      const want = this.wanted.has(mesh);
      st.value += ((want ? 0.12 : 1) - st.value) * Math.min(1, dt * 10);
      st.faded.opacity = st.value;
      if (!want && st.value > 0.97) {
        mesh.material = st.original;
        mesh.castShadow = st.castShadow;
        st.faded.dispose();
        this.faded.delete(mesh);
      }
    });
    for (const m of this.wanted) {
      if (this.faded.has(m)) continue;
      const original = m.material;
      const faded = (Array.isArray(original) ? (original[0] as THREE.Material) : original).clone();
      faded.transparent = true;
      faded.depthWrite = false;
      this.faded.set(m, { original, faded, value: 1, castShadow: m.castShadow });
      m.material = faded;
      m.castShadow = false;
    }
  }

  /** Back to normal (x-ray switched off, or the scene is being torn down). */
  reset(): void {
    this.wanted.clear();
    this.faded.forEach((st, m) => {
      m.material = st.original;
      m.castShadow = st.castShadow;
      st.faded.dispose();
    });
    this.faded.clear();
    for (const key of this.hiddenTrees) this.site.trees.setHidden(key[0] as TreeKind, +key.slice(1), false);
    this.hiddenTrees.clear();
  }

  private search(cam: THREE.Vector3, targets: readonly THREE.Vector3[], k: number): void {
    const want = new Set<THREE.Mesh>();
    const wantTrees = new Set<string>();
    for (const T of targets) {
      const dir = T.clone().sub(cam);
      const dist = dir.length();
      if (dist < 2) continue;
      dir.divideScalar(dist);
      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
      if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
      right.normalize();
      for (const o of [0, 1.4, -1.4]) {
        const d2 = T.clone().addScaledVector(right, o).sub(cam);
        const len = d2.length();
        this.raycaster.set(cam, d2.normalize());
        this.raycaster.far = Math.max(0, len - 0.8);
        for (const h of this.raycaster.intersectObjects(this.site.occluders, false)) want.add(h.object as THREE.Mesh);
      }
      const check = (kind: TreeKind, trees: ReadonlyArray<readonly [number, number, number, number]>): void => {
        trees.forEach(([x, z, h, r], i) => {
          const cy = (kind === 'd' ? h * 0.4 + r * 0.7 : h * 0.5) * k;
          const rho = ((kind === 'd' ? r * 1.1 : Math.max(r * 0.9, h * 0.4)) + 0.6) * k;
          if (segmentDistance(cam, T, x * k, cy, z * k) < rho) wantTrees.add(kind + i);
        });
      };
      check('d', this.site.trees.dec);
      check('c', this.site.trees.con);
    }
    this.wanted = want;
    for (const key of wantTrees) {
      if (this.hiddenTrees.has(key)) continue;
      this.hiddenTrees.add(key);
      this.site.trees.setHidden(key[0] as TreeKind, +key.slice(1), true);
    }
    for (const key of [...this.hiddenTrees]) {
      if (wantTrees.has(key)) continue;
      this.hiddenTrees.delete(key);
      this.site.trees.setHidden(key[0] as TreeKind, +key.slice(1), false);
    }
  }
}
