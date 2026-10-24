import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Quat, Vec3 } from '../core/math3d';
import { createOrbitState, orbitFromCamera, orbitPan, placeCamera } from './camera-rig';

const opts = { orbitFollow: true, calRotDeg: 0, fpvTiltDeg: 0 };

describe('leaving the chase camera to look around', () => {
  it('the orbit starts from exactly where the chase camera was', () => {
    const drone = { p: new Vec3(12, 5, -30), q: new Quat() };
    const cam = new THREE.PerspectiveCamera();
    const at = new THREE.Vector3(18, 7.5, -24);
    const st = createOrbitState();
    st.manual = true;
    orbitFromCamera(st, at, drone.p);
    expect(st.manual).toBe(false); // it follows the drone again
    placeCamera(cam, 'orbit', st, drone, opts, 0);
    expect(cam.position.distanceTo(at)).toBeLessThan(1e-6);
  });

  it('a pan stops the follow; handing it back glides to the drone instead of jumping', () => {
    const drone = { p: new Vec3(0, 0, 0), q: new Quat() };
    const cam = new THREE.PerspectiveCamera();
    const st = createOrbitState();
    st.tg.set(0, 0, 0);
    orbitPan(st, 300, 0, 'orbit', 0);
    const away = st.tg.clone();
    placeCamera(cam, 'orbit', st, drone, opts, 1 / 60);
    expect(st.tg.distanceTo(away)).toBe(0); // panned: not pulled back
    st.manual = false;
    placeCamera(cam, 'orbit', st, drone, opts, 1 / 60);
    const d = st.tg.length();
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(away.length()); // on its way back, not there in one frame
  });
});
